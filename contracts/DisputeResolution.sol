// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./EscrowVault.sol";

interface ITaskDisputeSource {
    function getDisputeParties(bytes32 taskId) external view returns (
        address poster,
        address worker,
        address workerPaymentAddress,
        string memory agentId,
        bool eligible
    );

    function finalizeDispute(bytes32 taskId, uint256 workerShareBPS) external;
}

/**
 * @title DisputeResolution
 * @notice Bonded three-arbiter resolution with atomic escrow enforcement.
 * Task parties are read from TaskManager, panels cannot include either party,
 * arbiters cannot withdraw while assigned, and the majority result moves funds
 * in the same transaction that finalizes the decision.
 */
contract DisputeResolution is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant PANEL_MANAGER_ROLE = keccak256("PANEL_MANAGER_ROLE");
    bytes32 public constant TASK_MANAGER_ROLE = keccak256("TASK_MANAGER_ROLE");

    enum DisputeStatus { OPEN, VOTING, RESOLVED }
    enum Resolution { NONE, FAVOR_WORKER, FAVOR_POSTER, SPLIT }

    struct Dispute {
        bytes32 taskId;
        bytes32 reasonHash;
        address opener;
        address poster;
        address worker;
        address workerPaymentAddress;
        string agentId;
        DisputeStatus status;
        Resolution resolution;
        uint256 bond;
        uint256 createdAt;
        uint256 panelAssignedAt;
        uint256 resolvedAt;
        address[3] arbiters;
        Resolution[3] votes;
        uint8 votesReceived;
    }

    IERC20 public immutable bondToken;
    EscrowVault public immutable escrowVault;
    address public immutable treasury;
    ITaskDisputeSource public taskManager;
    uint256 public disputeBond = 50 ether;
    uint256 public minimumArbiterStake = 500 ether;
    uint256 public constant VOTING_WINDOW = 7 days;
    uint256 public totalDisputes;

    mapping(uint256 => Dispute) public disputes;
    mapping(bytes32 => uint256) public activeDisputePlusOne;
    mapping(address => uint256) public arbiterStake;
    mapping(address => uint256) public activeAssignments;

    event TaskManagerConfigured(address indexed taskManager);
    event DisputeOpened(uint256 indexed disputeId, bytes32 indexed taskId, address indexed opener, bytes32 reasonHash);
    event PanelAssigned(uint256 indexed disputeId, address[3] arbiters);
    event ArbiterReplaced(uint256 indexed disputeId, uint256 indexed panelIndex, address indexed previousArbiter, address newArbiter);
    event DisputeVoted(uint256 indexed disputeId, address indexed arbiter, Resolution vote);
    event DisputeResolved(uint256 indexed disputeId, Resolution resolution, uint256 workerShareBPS);
    event ArbiterStaked(address indexed arbiter, uint256 amount, uint256 totalStake);
    event ArbiterUnstaked(address indexed arbiter, uint256 amount, uint256 totalStake);
    event EconomicsConfigured(uint256 disputeBond, uint256 minimumArbiterStake);

    error NotTaskParty();
    error TaskNotDisputable();
    error ActiveDisputeExists();
    error PanelAlreadyAssigned();
    error InvalidPanel();
    error IneligibleArbiter();
    error AlreadyVoted();
    error ActiveAssignmentsExist();
    error VotingWindowActive();

    constructor(address _bondToken, address _escrowVault, address _treasury) {
        require(_bondToken != address(0) && _escrowVault != address(0) && _treasury != address(0), "zero address");
        bondToken = IERC20(_bondToken);
        escrowVault = EscrowVault(_escrowVault);
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PANEL_MANAGER_ROLE, msg.sender);
    }

    function configureTaskManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(manager != address(0), "zero address");
        address previous = address(taskManager);
        if (previous != address(0)) _revokeRole(TASK_MANAGER_ROLE, previous);
        taskManager = ITaskDisputeSource(manager);
        _grantRole(TASK_MANAGER_ROLE, manager);
        emit TaskManagerConfigured(manager);
    }

    function configureEconomics(uint256 newDisputeBond, uint256 newMinimumArbiterStake)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newDisputeBond > 0 && newMinimumArbiterStake > 0, "zero economics");
        disputeBond = newDisputeBond;
        minimumArbiterStake = newMinimumArbiterStake;
        emit EconomicsConfigured(newDisputeBond, newMinimumArbiterStake);
    }

    function stakeAsArbiter(uint256 amount) external onlyRole(ARBITER_ROLE) nonReentrant {
        require(amount > 0, "zero stake");
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        arbiterStake[msg.sender] += amount;
        emit ArbiterStaked(msg.sender, amount, arbiterStake[msg.sender]);
    }

    function unstakeAsArbiter(uint256 amount) external nonReentrant {
        if (activeAssignments[msg.sender] != 0) revert ActiveAssignmentsExist();
        require(amount > 0 && arbiterStake[msg.sender] >= amount, "invalid amount");
        arbiterStake[msg.sender] -= amount;
        bondToken.safeTransfer(msg.sender, amount);
        emit ArbiterUnstaked(msg.sender, amount, arbiterStake[msg.sender]);
    }

    function openDispute(bytes32 taskId, address opener, bytes32 reasonHash)
        external
        onlyRole(TASK_MANAGER_ROLE)
        nonReentrant
        returns (uint256 disputeId)
    {
        if (reasonHash == bytes32(0)) revert TaskNotDisputable();
        if (activeDisputePlusOne[taskId] != 0) revert ActiveDisputeExists();
        (address poster, address worker, address workerPaymentAddress, string memory agentId, bool eligible) =
            taskManager.getDisputeParties(taskId);
        if (!eligible) revert TaskNotDisputable();
        if (opener != poster && opener != worker) revert NotTaskParty();

        bondToken.safeTransferFrom(opener, address(this), disputeBond);
        disputeId = totalDisputes++;
        Dispute storage d = disputes[disputeId];
        d.taskId = taskId;
        d.reasonHash = reasonHash;
        d.opener = opener;
        d.poster = poster;
        d.worker = worker;
        d.workerPaymentAddress = workerPaymentAddress;
        d.agentId = agentId;
        d.status = DisputeStatus.OPEN;
        d.bond = disputeBond;
        d.createdAt = block.timestamp;
        activeDisputePlusOne[taskId] = disputeId + 1;
        emit DisputeOpened(disputeId, taskId, opener, reasonHash);
    }

    function assignPanel(uint256 disputeId, address[3] calldata arbiters)
        external
        onlyRole(PANEL_MANAGER_ROLE)
    {
        Dispute storage d = disputes[disputeId];
        if (d.status != DisputeStatus.OPEN) revert PanelAlreadyAssigned();
        for (uint256 i = 0; i < 3; i++) {
            address arbiter = arbiters[i];
            if (arbiter == address(0) || arbiter == d.poster || arbiter == d.worker) revert InvalidPanel();
            if (!hasRole(ARBITER_ROLE, arbiter) || arbiterStake[arbiter] < minimumArbiterStake) {
                revert IneligibleArbiter();
            }
            for (uint256 j = 0; j < i; j++) if (arbiters[j] == arbiter) revert InvalidPanel();
            d.arbiters[i] = arbiter;
            activeAssignments[arbiter]++;
        }
        d.status = DisputeStatus.VOTING;
        d.panelAssignedAt = block.timestamp;
        emit PanelAssigned(disputeId, arbiters);
    }

    /// @notice Replace a non-voting arbiter after the service window expires.
    /// The stake lock moves atomically so a stalled panel cannot freeze escrow.
    function replaceNonVotingArbiter(uint256 disputeId, uint256 panelIndex, address replacement)
        external
        onlyRole(PANEL_MANAGER_ROLE)
    {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.VOTING, "not voting");
        if (block.timestamp <= d.panelAssignedAt + VOTING_WINDOW) revert VotingWindowActive();
        if (panelIndex >= 3 || d.votes[panelIndex] != Resolution.NONE) revert InvalidPanel();
        if (replacement == address(0) || replacement == d.poster || replacement == d.worker) revert InvalidPanel();
        if (!hasRole(ARBITER_ROLE, replacement) || arbiterStake[replacement] < minimumArbiterStake) {
            revert IneligibleArbiter();
        }
        for (uint256 i = 0; i < 3; i++) {
            if (i != panelIndex && d.arbiters[i] == replacement) revert InvalidPanel();
        }
        address previous = d.arbiters[panelIndex];
        activeAssignments[previous]--;
        activeAssignments[replacement]++;
        d.arbiters[panelIndex] = replacement;
        d.panelAssignedAt = block.timestamp;
        emit ArbiterReplaced(disputeId, panelIndex, previous, replacement);
    }

    function vote(uint256 disputeId, Resolution decision) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.VOTING, "not voting");
        require(decision != Resolution.NONE, "invalid vote");
        bool assigned;
        for (uint256 i = 0; i < 3; i++) {
            if (d.arbiters[i] == msg.sender) {
                if (d.votes[i] != Resolution.NONE) revert AlreadyVoted();
                d.votes[i] = decision;
                d.votesReceived++;
                assigned = true;
                break;
            }
        }
        if (!assigned) revert IneligibleArbiter();
        emit DisputeVoted(disputeId, msg.sender, decision);
        uint8 matchingVotes;
        for (uint256 i = 0; i < 3; i++) if (d.votes[i] == decision) matchingVotes++;
        if (matchingVotes >= 2 || d.votesReceived == 3) _resolve(disputeId);
    }

    function getDisputeState(uint256 disputeId) external view returns (
        bytes32 taskId,
        DisputeStatus status,
        Resolution resolution,
        uint8 votesReceived,
        address[3] memory arbiters,
        Resolution[3] memory votes,
        uint256 resolvedAt
    ) {
        Dispute storage d = disputes[disputeId];
        return (d.taskId, d.status, d.resolution, d.votesReceived, d.arbiters, d.votes, d.resolvedAt);
    }

    function _resolve(uint256 disputeId) internal {
        Dispute storage d = disputes[disputeId];
        uint8 workerVotes;
        uint8 posterVotes;
        for (uint256 i = 0; i < 3; i++) {
            if (d.votes[i] == Resolution.FAVOR_WORKER) workerVotes++;
            else if (d.votes[i] == Resolution.FAVOR_POSTER) posterVotes++;
            activeAssignments[d.arbiters[i]]--;
        }
        if (workerVotes >= 2) d.resolution = Resolution.FAVOR_WORKER;
        else if (posterVotes >= 2) d.resolution = Resolution.FAVOR_POSTER;
        else d.resolution = Resolution.SPLIT;

        uint256 workerShareBPS = d.resolution == Resolution.FAVOR_WORKER
            ? 10000
            : d.resolution == Resolution.FAVOR_POSTER ? 0 : 5000;
        d.status = DisputeStatus.RESOLVED;
        d.resolvedAt = block.timestamp;
        activeDisputePlusOne[d.taskId] = 0;

        escrowVault.settleDispute(d.taskId, d.agentId, d.workerPaymentAddress, workerShareBPS);
        taskManager.finalizeDispute(d.taskId, workerShareBPS);

        bool openerWon = (d.opener == d.worker && d.resolution == Resolution.FAVOR_WORKER)
            || (d.opener == d.poster && d.resolution == Resolution.FAVOR_POSTER);
        uint256 refund = openerWon ? d.bond : d.resolution == Resolution.SPLIT ? d.bond / 2 : 0;
        if (refund > 0) bondToken.safeTransfer(d.opener, refund);
        if (d.bond > refund) bondToken.safeTransfer(treasury, d.bond - refund);
        emit DisputeResolved(disputeId, d.resolution, workerShareBPS);
    }
}
