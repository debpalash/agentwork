// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title EscrowVault
 * @notice Holds poster funds (USDC/stablecoin) locked per task.
 *         Supports full release, step-based release, quality adjustments,
 *         platform bonus injection, auto-approval after timeout, and refunds.
 */
contract EscrowVault is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    // Fee config (basis points)
    uint256 public constant PLATFORM_FEE_BPS = 250;     // 2.5%
    uint256 public constant VALIDATOR_FEE_BPS = 100;     // 1.0%
    uint256 public constant CANCEL_FEE_BPS = 100;        // 1.0%
    uint256 public constant MAX_QUALITY_ADJUST_BPS = 2000; // ±20%

    // ─── Structs ───────────────────────────────────────────────────
    struct EscrowAccount {
        bytes32 taskId;
        address poster;
        IERC20 paymentToken;         // USDC or similar stablecoin
        uint256 totalLocked;
        uint256 released;
        uint256 remaining;
        uint256 platformBonusAdded;
        bool isActive;
        uint256 lockedAt;
    }

    struct ReleaseRecord {
        uint256 amount;
        address recipient;
        string agentId;
        uint256 stepNumber;          // 0 = full payment
        uint256 qualityScore;
        uint256 releasedAt;
    }

    // ─── State ─────────────────────────────────────────────────────
    mapping(bytes32 => EscrowAccount) public escrows;
    mapping(bytes32 => ReleaseRecord[]) public releaseHistory;
    mapping(address => uint256) public totalLockedByPoster;

    address public treasury;
    address public validatorPool;

    // ─── Events ────────────────────────────────────────────────────
    event FundsLocked(bytes32 indexed taskId, address indexed poster, address token, uint256 amount);
    event FundsReleased(bytes32 indexed taskId, string agentId, uint256 agentAmount, uint256 step);
    event FundsRefunded(bytes32 indexed taskId, address indexed poster, uint256 amount);
    event BonusAdded(bytes32 indexed taskId, uint256 amount, string reason);

    // ─── Errors ────────────────────────────────────────────────────
    error EscrowAlreadyExists();
    error NoActiveEscrow();
    error InsufficientEscrow();
    error ZeroAmount();

    constructor(address _treasury, address _validatorPool) {
        treasury = _treasury;
        validatorPool = _validatorPool;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    // ─── Lock Funds ────────────────────────────────────────────────
    /**
     * @notice Lock poster funds when a task is created.
     *         Poster must have approved this contract for `amount`.
     */
    function lockFunds(
        bytes32 taskId,
        address poster,
        address paymentToken,
        uint256 amount
    ) external onlyRole(PLATFORM_ROLE) {
        if (escrows[taskId].isActive) revert EscrowAlreadyExists();
        if (amount == 0) revert ZeroAmount();

        IERC20 token = IERC20(paymentToken);
        token.safeTransferFrom(poster, address(this), amount);

        escrows[taskId] = EscrowAccount({
            taskId: taskId,
            poster: poster,
            paymentToken: token,
            totalLocked: amount,
            released: 0,
            remaining: amount,
            platformBonusAdded: 0,
            isActive: true,
            lockedAt: block.timestamp
        });

        totalLockedByPoster[poster] += amount;
        emit FundsLocked(taskId, poster, paymentToken, amount);
    }

    // ─── Release Step Payment ──────────────────────────────────────
    /**
     * @notice Release a step's payment to the agent.
     * @param stepPercentageBPS Step reward as BPS of total escrow (out of 10000)
     * @param qualityScore Poster quality rating 0-100
     */
    function releaseStepPayment(
        bytes32 taskId,
        string calldata agentId,
        address agentPaymentAddress,
        uint256 stepNumber,
        uint256 stepPercentageBPS,
        uint256 qualityScore
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 agentPayment) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();

        // Calculate base step payment
        uint256 stepPayment = (esc.totalLocked * stepPercentageBPS) / 10000;

        // Apply quality adjustment (±20%)
        stepPayment = _applyQualityAdjustment(stepPayment, qualityScore);

        // Cap at available funds
        if (stepPayment > esc.remaining) stepPayment = esc.remaining;

        if (stepPayment > esc.remaining) revert InsufficientEscrow();

        // Deduct fees
        uint256 platformFee = (stepPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 validatorFee = (stepPayment * VALIDATOR_FEE_BPS) / 10000;
        agentPayment = stepPayment - platformFee - validatorFee;

        // Update state
        esc.released += stepPayment;
        esc.remaining -= stepPayment;

        // Record
        releaseHistory[taskId].push(ReleaseRecord({
            amount: agentPayment,
            recipient: agentPaymentAddress,
            agentId: agentId,
            stepNumber: stepNumber,
            qualityScore: qualityScore,
            releasedAt: block.timestamp
        }));

        // Transfer
        esc.paymentToken.safeTransfer(agentPaymentAddress, agentPayment);
        esc.paymentToken.safeTransfer(treasury, platformFee);
        esc.paymentToken.safeTransfer(validatorPool, validatorFee);

        emit FundsReleased(taskId, agentId, agentPayment, stepNumber);
    }

    // ─── Release Full Payment ──────────────────────────────────────
    function releaseFullPayment(
        bytes32 taskId,
        string calldata agentId,
        address agentPaymentAddress,
        uint256 qualityScore
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 agentPayment) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();

        uint256 totalPayment = esc.remaining;
        totalPayment = _applyQualityAdjustment(totalPayment, qualityScore);
        // Cap at available funds (quality bonus can't exceed escrow)
        if (totalPayment > esc.remaining) totalPayment = esc.remaining;

        uint256 platformFee = (totalPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 validatorFee = (totalPayment * VALIDATOR_FEE_BPS) / 10000;
        agentPayment = totalPayment - platformFee - validatorFee;

        esc.released += totalPayment;
        esc.remaining -= totalPayment;
        esc.isActive = false;

        releaseHistory[taskId].push(ReleaseRecord({
            amount: agentPayment,
            recipient: agentPaymentAddress,
            agentId: agentId,
            stepNumber: 0,
            qualityScore: qualityScore,
            releasedAt: block.timestamp
        }));

        esc.paymentToken.safeTransfer(agentPaymentAddress, agentPayment);
        esc.paymentToken.safeTransfer(treasury, platformFee);
        esc.paymentToken.safeTransfer(validatorPool, validatorFee);

        emit FundsReleased(taskId, agentId, agentPayment, 0);
    }

    // ─── Add Platform Bonus ────────────────────────────────────────
    /**
     * @notice Platform injects bonus funds (e.g. after failure-triggered reward bump).
     *         Funds come from platform treasury.
     */
    function addPlatformBonus(
        bytes32 taskId,
        uint256 amount,
        string calldata reason
    ) external onlyRole(PLATFORM_ROLE) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();

        esc.paymentToken.safeTransferFrom(treasury, address(this), amount);
        esc.totalLocked += amount;
        esc.remaining += amount;
        esc.platformBonusAdded += amount;

        emit BonusAdded(taskId, amount, reason);
    }

    // ─── Refund Poster ─────────────────────────────────────────────
    function refundPoster(
        bytes32 taskId
    ) external onlyRole(PLATFORM_ROLE) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();

        uint256 refundAmount = esc.remaining;
        uint256 cancelFee = (refundAmount * CANCEL_FEE_BPS) / 10000;
        uint256 refund = refundAmount - cancelFee;

        esc.remaining = 0;
        esc.isActive = false;

        totalLockedByPoster[esc.poster] -= esc.totalLocked;

        esc.paymentToken.safeTransfer(esc.poster, refund);
        esc.paymentToken.safeTransfer(treasury, cancelFee);

        emit FundsRefunded(taskId, esc.poster, refund);
    }

    /// @notice Alias for refundPoster — used by TaskManagerV2 on cancellation
    function cancelAndRefund(bytes32 taskId) external onlyRole(PLATFORM_ROLE) {
        this.refundPoster(taskId);
    }

    // ─── Quality Adjustment ────────────────────────────────────────
    function _applyQualityAdjustment(
        uint256 baseAmount,
        uint256 qualityScore
    ) internal pure returns (uint256) {
        // qualityScore 0-100. Score of 50 = no change.
        // Above 50: bonus (max +20% at score=100)
        // Below 50: penalty (max -20% at score=0)
        if (qualityScore >= 50) {
            uint256 bonusBPS = (qualityScore - 50) * (MAX_QUALITY_ADJUST_BPS / 50);
            return baseAmount + (baseAmount * bonusBPS) / 10000;
        } else {
            uint256 penaltyBPS = (50 - qualityScore) * (MAX_QUALITY_ADJUST_BPS / 50);
            return baseAmount - (baseAmount * penaltyBPS) / 10000;
        }
    }

    // ─── View ──────────────────────────────────────────────────────
    function getEscrow(
        bytes32 taskId
    ) external view returns (EscrowAccount memory) {
        return escrows[taskId];
    }

    function getReleaseHistory(
        bytes32 taskId
    ) external view returns (ReleaseRecord[] memory) {
        return releaseHistory[taskId];
    }
}
