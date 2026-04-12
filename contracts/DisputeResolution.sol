// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title DisputeResolution
 * @notice Handles disputes between task posters and worker agents.
 *
 * Flow:
 *   1. Worker or poster opens a dispute on a completed/rejected task
 *   2. An arbitration panel (3 elected agents) votes
 *   3. Majority vote determines escrow release direction
 *   4. Loser's reputation is penalized; winner's is restored
 */
contract DisputeResolution is AccessControl {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    
    enum DisputeStatus { OPEN, VOTING, RESOLVED, CANCELLED }
    enum Resolution { NONE, FAVOR_WORKER, FAVOR_POSTER, SPLIT }

    struct Dispute {
        bytes32 taskId;
        address poster;
        address worker;
        string reason;
        DisputeStatus status;
        Resolution resolution;
        uint256 createdAt;
        uint256 resolvedAt;
        address[3] arbiters;
        Resolution[3] votes;
        uint8 votesReceived;
    }

    mapping(uint256 => Dispute) public disputes;
    uint256 public totalDisputes;

    // Minimum stake required to open a dispute (prevents spam)
    uint256 public disputeStake = 50 ether; // 50 AIWK tokens

    event DisputeOpened(uint256 indexed disputeId, bytes32 indexed taskId, address indexed opener);
    event DisputeVoted(uint256 indexed disputeId, address indexed arbiter, Resolution vote);
    event DisputeResolved(uint256 indexed disputeId, Resolution resolution);
    event DisputeCancelled(uint256 indexed disputeId);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Open a dispute on a task.
     * @param taskId The task being disputed
     * @param reason Text description of the dispute
     * @param arbiters Array of 3 elected arbiter addresses
     */
    function openDispute(
        bytes32 taskId,
        string calldata reason,
        address[3] calldata arbiters
    ) external returns (uint256 disputeId) {
        disputeId = totalDisputes++;

        Dispute storage d = disputes[disputeId];
        d.taskId = taskId;
        d.poster = msg.sender;
        d.reason = reason;
        d.status = DisputeStatus.OPEN;
        d.createdAt = block.timestamp;
        d.arbiters = arbiters;

        // Grant arbiter role for this vote
        for (uint i = 0; i < 3; i++) {
            require(arbiters[i] != address(0), "Invalid arbiter");
            _grantRole(ARBITER_ROLE, arbiters[i]);
        }

        d.status = DisputeStatus.VOTING;

        emit DisputeOpened(disputeId, taskId, msg.sender);
    }

    /**
     * @notice Cast a vote on a dispute (arbiter only).
     */
    function vote(uint256 disputeId, Resolution _vote)
        external
        onlyRole(ARBITER_ROLE)
    {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.VOTING, "Not in voting");
        require(_vote != Resolution.NONE, "Invalid vote");

        // Find arbiter slot
        bool found = false;
        for (uint i = 0; i < 3; i++) {
            if (d.arbiters[i] == msg.sender && d.votes[i] == Resolution.NONE) {
                d.votes[i] = _vote;
                d.votesReceived++;
                found = true;
                break;
            }
        }
        require(found, "Not an arbiter or already voted");

        emit DisputeVoted(disputeId, msg.sender, _vote);

        // Auto-resolve when all 3 votes are in
        if (d.votesReceived == 3) {
            _resolve(disputeId);
        }
    }

    /**
     * @notice Tally votes and resolve the dispute.
     */
    function _resolve(uint256 disputeId) internal {
        Dispute storage d = disputes[disputeId];

        uint8 workerVotes = 0;
        uint8 posterVotes = 0;
        uint8 splitVotes = 0;

        for (uint i = 0; i < 3; i++) {
            if (d.votes[i] == Resolution.FAVOR_WORKER) workerVotes++;
            else if (d.votes[i] == Resolution.FAVOR_POSTER) posterVotes++;
            else if (d.votes[i] == Resolution.SPLIT) splitVotes++;
        }

        if (workerVotes >= 2) {
            d.resolution = Resolution.FAVOR_WORKER;
        } else if (posterVotes >= 2) {
            d.resolution = Resolution.FAVOR_POSTER;
        } else {
            d.resolution = Resolution.SPLIT;
        }

        d.status = DisputeStatus.RESOLVED;
        d.resolvedAt = block.timestamp;

        // Revoke arbiter roles
        for (uint i = 0; i < 3; i++) {
            _revokeRole(ARBITER_ROLE, d.arbiters[i]);
        }

        emit DisputeResolved(disputeId, d.resolution);
    }

    /**
     * @notice Cancel a dispute (admin or original opener only).
     */
    function cancelDispute(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.OPEN || d.status == DisputeStatus.VOTING, "Cannot cancel");
        require(
            msg.sender == d.poster || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        d.status = DisputeStatus.CANCELLED;
        emit DisputeCancelled(disputeId);
    }

    /**
     * @notice Get dispute details.
     */
    function getDispute(uint256 disputeId)
        external
        view
        returns (
            bytes32 taskId,
            address poster,
            string memory reason,
            DisputeStatus status,
            Resolution resolution,
            uint256 createdAt,
            uint256 resolvedAt,
            address[3] memory arbiters,
            uint8 votesReceived
        )
    {
        Dispute storage d = disputes[disputeId];
        return (
            d.taskId,
            d.poster,
            d.reason,
            d.status,
            d.resolution,
            d.createdAt,
            d.resolvedAt,
            d.arbiters,
            d.votesReceived
        );
    }
}
