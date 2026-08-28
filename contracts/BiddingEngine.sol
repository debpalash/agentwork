// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BiddingEngine
 * @notice Competitive bidding system for AIWork tasks.
 *         Worker agents submit bids with price, ETA, stake, and model info.
 *         Platform scores bids and awards to the best agent.
 */
contract BiddingEngine is AccessControl, ReentrancyGuard {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    // ─── Structs ────────────────────────────────────────────────
    struct Bid {
        bytes32 taskId;
        string agentId;
        address bidder;
        uint256 bidPrice;         // How much agent wants (in wei)
        uint256 estimatedHours;   // ETA in hours
        uint256 stakedAmount;     // Tokens staked as commitment
        uint256 modelScore;       // Benchmark score (0-100)
        uint256 submittedAt;
        uint256 compositeScore;   // Computed by platform
        bool isAwarded;
        bool isRefunded;
        bool isForfeited;
    }

    // ─── State ──────────────────────────────────────────────────
    mapping(bytes32 => Bid[]) public taskBids;           // taskId => bids
    mapping(bytes32 => uint256) public biddingDeadline;   // taskId => deadline
    mapping(bytes32 => bool) public biddingClosed;        // taskId => closed
    mapping(bytes32 => string) public awardedAgent;       // taskId => winning agentId
    mapping(bytes32 => mapping(string => bool)) public hasBid; // taskId => agentId => bool
    mapping(address => uint256) public withdrawableStake;
    address public treasury;

    uint256 public defaultBiddingDuration = 4 hours;
    uint256 public minBidStake = 0.001 ether;             // Minimum stake to prevent spam

    // ─── Scoring Weights (out of 1000) ──────────────────────────
    uint256 public constant W_REPUTATION    = 300;
    uint256 public constant W_PRICE         = 200;
    uint256 public constant W_SPEED         = 150;
    uint256 public constant W_STAKE         = 150;
    uint256 public constant W_MODEL         = 100;
    uint256 public constant W_EXPERIENCE    = 100;

    // ─── Events ─────────────────────────────────────────────────
    event BidSubmitted(bytes32 indexed taskId, string agentId, uint256 bidPrice, uint256 estimatedHours, uint256 stake);
    event TaskAwarded(bytes32 indexed taskId, string agentId, uint256 compositeScore);
    event BidRefunded(bytes32 indexed taskId, string agentId, uint256 amount);
    event BidForfeited(bytes32 indexed taskId, string agentId, uint256 slashedAmount);
    event BiddingOpened(bytes32 indexed taskId, uint256 deadline);
    event StakeWithdrawalCredited(address indexed account, uint256 amount);
    event StakeWithdrawn(address indexed account, uint256 amount);

    // ─── Errors ─────────────────────────────────────────────────
    error BiddingNotOpen();
    error BiddingStillOpen();
    error AlreadyBid();
    error InsufficientStake();
    error NoBids();
    error AlreadyAwarded();
    error NotAwarded();
    error InvalidScoreInputs();
    error NothingToWithdraw();
    error WithdrawalFailed();

    constructor() {
        treasury = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    // ─── Open Bidding ───────────────────────────────────────────
    function openBidding(bytes32 taskId, uint256 durationHours) external onlyRole(PLATFORM_ROLE) {
        uint256 duration = durationHours > 0 ? durationHours * 1 hours : defaultBiddingDuration;
        biddingDeadline[taskId] = block.timestamp + duration;
        biddingClosed[taskId] = false;

        emit BiddingOpened(taskId, biddingDeadline[taskId]);
    }

    // ─── Submit Bid ─────────────────────────────────────────────
    function submitBid(
        bytes32 taskId,
        string calldata agentId,
        uint256 bidPrice,
        uint256 estimatedHours,
        uint256 modelScore
    ) external payable nonReentrant {
        if (block.timestamp > biddingDeadline[taskId] || biddingClosed[taskId])
            revert BiddingNotOpen();
        if (hasBid[taskId][agentId]) revert AlreadyBid();
        if (msg.value < minBidStake) revert InsufficientStake();

        taskBids[taskId].push(Bid({
            taskId: taskId,
            agentId: agentId,
            bidder: msg.sender,
            bidPrice: bidPrice,
            estimatedHours: estimatedHours,
            stakedAmount: msg.value,
            modelScore: modelScore > 100 ? 100 : modelScore,
            submittedAt: block.timestamp,
            compositeScore: 0,
            isAwarded: false,
            isRefunded: false,
            isForfeited: false
        }));

        hasBid[taskId][agentId] = true;

        emit BidSubmitted(taskId, agentId, bidPrice, estimatedHours, msg.value);
    }

    // ─── Award Task ─────────────────────────────────────────────
    /**
     * @notice Platform scores all bids and awards to the highest scorer.
     * @param taskId The task being awarded
     * @param reputationScores Array of reputation scores (0-10000) per bid, same order as taskBids
     * @param categoryExperience Array of category task counts per bid
     * @param maxBudget The employer's max budget (for price normalization)
     * @param maxHours The max deadline hours (for speed normalization)
     */
    function awardTask(
        bytes32 taskId,
        uint256[] calldata reputationScores,
        uint256[] calldata categoryExperience,
        uint256 maxBudget,
        uint256 maxHours
    ) external onlyRole(PLATFORM_ROLE) nonReentrant {
        Bid[] storage bids = taskBids[taskId];
        if (bids.length == 0) revert NoBids();
        if (bytes(awardedAgent[taskId]).length > 0) revert AlreadyAwarded();
        if (block.timestamp <= biddingDeadline[taskId]) revert BiddingStillOpen();
        if (reputationScores.length != bids.length || categoryExperience.length != bids.length)
            revert InvalidScoreInputs();

        uint256 bestScore = 0;
        uint256 bestIndex = 0;

        for (uint256 i = 0; i < bids.length; i++) {
            uint256 score = _computeScore(
                bids[i],
                reputationScores[i],
                categoryExperience[i],
                maxBudget,
                maxHours
            );
            bids[i].compositeScore = score;

            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        // Award winner
        bids[bestIndex].isAwarded = true;
        awardedAgent[taskId] = bids[bestIndex].agentId;
        biddingClosed[taskId] = true;

        // Credit non-winners. Recipients withdraw themselves so a contract
        // wallet with a reverting receive hook cannot block the whole award.
        for (uint256 i = 0; i < bids.length; i++) {
            if (i != bestIndex && !bids[i].isRefunded) {
                bids[i].isRefunded = true;
                withdrawableStake[bids[i].bidder] += bids[i].stakedAmount;
                emit StakeWithdrawalCredited(bids[i].bidder, bids[i].stakedAmount);
                emit BidRefunded(taskId, bids[i].agentId, bids[i].stakedAmount);
            }
        }

        emit TaskAwarded(taskId, bids[bestIndex].agentId, bestScore);
    }

    // ─── Forfeit ────────────────────────────────────────────────
    /**
     * @notice Slash an awarded agent's stake if they abandon the task
     */
    function forfeitBid(bytes32 taskId, string calldata agentId) external onlyRole(PLATFORM_ROLE) nonReentrant {
        Bid[] storage bids = taskBids[taskId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (keccak256(bytes(bids[i].agentId)) == keccak256(bytes(agentId)) && bids[i].isAwarded && !bids[i].isForfeited && !bids[i].isRefunded) {
                bids[i].isForfeited = true;
                withdrawableStake[treasury] += bids[i].stakedAmount;
                emit StakeWithdrawalCredited(treasury, bids[i].stakedAmount);
                emit BidForfeited(taskId, agentId, bids[i].stakedAmount);
                return;
            }
        }
        revert NotAwarded();
    }

    // ─── Refund Winner Stake (on successful completion) ─────────
    function refundWinnerStake(bytes32 taskId) external onlyRole(PLATFORM_ROLE) nonReentrant {
        Bid[] storage bids = taskBids[taskId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].isAwarded && !bids[i].isRefunded && !bids[i].isForfeited) {
                bids[i].isRefunded = true;
                withdrawableStake[bids[i].bidder] += bids[i].stakedAmount;
                emit StakeWithdrawalCredited(bids[i].bidder, bids[i].stakedAmount);
                emit BidRefunded(taskId, bids[i].agentId, bids[i].stakedAmount);
                return;
            }
        }
    }

    function withdrawStake() external nonReentrant {
        uint256 amount = withdrawableStake[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawableStake[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert WithdrawalFailed();
        emit StakeWithdrawn(msg.sender, amount);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    // ─── View Functions ─────────────────────────────────────────
    function getBidCount(bytes32 taskId) external view returns (uint256) {
        return taskBids[taskId].length;
    }

    function getBid(bytes32 taskId, uint256 index) external view returns (Bid memory) {
        return taskBids[taskId][index];
    }

    function getBiddingDeadline(bytes32 taskId) external view returns (uint256) {
        return biddingDeadline[taskId];
    }

    function isBiddingOpen(bytes32 taskId) external view returns (bool) {
        return !biddingClosed[taskId] && block.timestamp <= biddingDeadline[taskId];
    }

    function getAwardedAgent(bytes32 taskId) external view returns (string memory) {
        return awardedAgent[taskId];
    }

    function getAwardedBid(bytes32 taskId) external view returns (Bid memory) {
        Bid[] storage bids = taskBids[taskId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].isAwarded) return bids[i];
        }
        revert NotAwarded();
    }

    // ─── Internal Scoring ───────────────────────────────────────
    function _computeScore(
        Bid memory bid,
        uint256 reputation,    // 0-10000
        uint256 catExp,        // raw count
        uint256 maxBudget,
        uint256 maxHours
    ) internal pure returns (uint256) {
        uint256 score = 0;

        // Reputation (300pts) — rep / 10000 * 300
        score += (reputation * W_REPUTATION) / 10000;

        // Price (200pts) — lower bid relative to budget = higher score
        if (maxBudget > 0 && bid.bidPrice <= maxBudget) {
            uint256 priceRatio = ((maxBudget - bid.bidPrice) * W_PRICE) / maxBudget;
            score += priceRatio;
        }

        // Speed (150pts) — faster ETA = higher score
        if (maxHours > 0 && bid.estimatedHours <= maxHours) {
            uint256 speedRatio = ((maxHours - bid.estimatedHours) * W_SPEED) / maxHours;
            score += speedRatio;
        }

        // Stake (150pts) — more stake relative to bid price
        if (bid.bidPrice > 0) {
            uint256 stakeRatio = (bid.stakedAmount * W_STAKE) / bid.bidPrice;
            score += stakeRatio > W_STAKE ? W_STAKE : stakeRatio;
        }

        // Model quality (100pts) — benchmark / 100 * 100
        score += (bid.modelScore * W_MODEL) / 100;

        // Category experience (100pts) — capped at 50 tasks
        uint256 expCapped = catExp > 50 ? 50 : catExp;
        score += (expCapped * W_EXPERIENCE) / 50;

        return score;
    }

    // ─── Admin ──────────────────────────────────────────────────
    function setDefaultBiddingDuration(uint256 hours_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultBiddingDuration = hours_ * 1 hours;
    }

    function setMinBidStake(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minBidStake = amount;
    }

    receive() external payable {}
}
