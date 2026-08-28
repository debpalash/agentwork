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
    bytes32 public constant ARBITRATION_ROLE = keccak256("ARBITRATION_ROLE");

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
    mapping(address => bool) public allowedPaymentTokens;

    address public treasury;
    address public validatorPool;

    // ─── Events ────────────────────────────────────────────────────
    event FundsLocked(bytes32 indexed taskId, address indexed poster, address token, uint256 amount);
    event FundsReleased(bytes32 indexed taskId, string agentId, uint256 agentAmount, uint256 step);
    event FundsRefunded(bytes32 indexed taskId, address indexed poster, uint256 amount);
    event BonusAdded(bytes32 indexed taskId, uint256 amount, string reason);
    event PaymentTokenAllowed(address indexed token, bool allowed);
    event DisputeSettled(bytes32 indexed taskId, address indexed worker, uint256 workerGross, uint256 posterRefund, uint256 workerShareBPS);

    // ─── Errors ────────────────────────────────────────────────────
    error EscrowAlreadyExists();
    error NoActiveEscrow();
    error InsufficientEscrow();
    error ZeroAmount();
    error InvalidQualityScore();
    error PaymentTokenNotAllowed();
    error UnsupportedTokenBehavior();

    constructor(address _treasury, address _validatorPool) {
        treasury = _treasury;
        validatorPool = _validatorPool;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    // ─── Lock Funds ────────────────────────────────────────────────
    function setPaymentToken(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "Invalid token");
        allowedPaymentTokens[token] = allowed;
        emit PaymentTokenAllowed(token, allowed);
    }

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
        if (!allowedPaymentTokens[paymentToken]) revert PaymentTokenNotAllowed();

        IERC20 token = IERC20(paymentToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(poster, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert UnsupportedTokenBehavior();

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
        if (qualityScore > 100) revert InvalidQualityScore();

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
        if (qualityScore > 100) revert InvalidQualityScore();

        uint256 totalPayment = esc.remaining;
        totalPayment = _applyQualityAdjustment(totalPayment, qualityScore);
        // Cap at available funds (quality bonus can't exceed escrow)
        if (totalPayment > esc.remaining) totalPayment = esc.remaining;

        uint256 platformFee = (totalPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 validatorFee = (totalPayment * VALIDATOR_FEE_BPS) / 10000;
        agentPayment = totalPayment - platformFee - validatorFee;

        uint256 unused = esc.remaining - totalPayment;
        esc.released += totalPayment;
        esc.remaining = 0;
        esc.isActive = false;
        totalLockedByPoster[esc.poster] -= _posterPrincipal(esc);
        (uint256 employerRefund, uint256 platformBonusRefund) = _splitUnused(esc, unused);

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
        if (platformBonusRefund > 0) esc.paymentToken.safeTransfer(treasury, platformBonusRefund);
        if (employerRefund > 0) {
            esc.paymentToken.safeTransfer(esc.poster, employerRefund);
            emit FundsRefunded(taskId, esc.poster, employerRefund);
        }

        emit FundsReleased(taskId, agentId, agentPayment, 0);
    }

    /// @notice Release an awarded amount and refund unused budget atomically.
    /// Used by bidding-based task managers where the winning bid is below the
    /// employer's maximum escrowed budget.
    function releaseAwardedPayment(
        bytes32 taskId,
        string calldata agentId,
        address agentPaymentAddress,
        uint256 awardedAmount,
        uint256 qualityScore
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 agentPayment, uint256 employerRefund) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();
        if (awardedAmount == 0 || awardedAmount > esc.remaining) revert InsufficientEscrow();
        if (qualityScore > 100) revert InvalidQualityScore();

        uint256 totalPayment = _applyQualityAdjustment(awardedAmount, qualityScore);
        if (totalPayment > esc.remaining) totalPayment = esc.remaining;

        uint256 platformFee = (totalPayment * PLATFORM_FEE_BPS) / 10000;
        uint256 validatorFee = (totalPayment * VALIDATOR_FEE_BPS) / 10000;
        agentPayment = totalPayment - platformFee - validatorFee;
        uint256 unused = esc.remaining - totalPayment;

        esc.released += totalPayment;
        esc.remaining = 0;
        esc.isActive = false;
        totalLockedByPoster[esc.poster] -= _posterPrincipal(esc);
        uint256 platformBonusRefund;
        (employerRefund, platformBonusRefund) = _splitUnused(esc, unused);

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
        if (platformBonusRefund > 0) esc.paymentToken.safeTransfer(treasury, platformBonusRefund);
        if (employerRefund > 0) esc.paymentToken.safeTransfer(esc.poster, employerRefund);

        emit FundsReleased(taskId, agentId, agentPayment, 0);
        if (employerRefund > 0) emit FundsRefunded(taskId, esc.poster, employerRefund);
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

        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = esc.paymentToken.balanceOf(address(this));
        esc.paymentToken.safeTransferFrom(treasury, address(this), amount);
        if (esc.paymentToken.balanceOf(address(this)) - balanceBefore != amount) revert UnsupportedTokenBehavior();
        esc.totalLocked += amount;
        esc.remaining += amount;
        esc.platformBonusAdded += amount;

        emit BonusAdded(taskId, amount, reason);
    }

    /// @notice Close a completed step-based escrow and return funds not earned
    /// because of quality adjustments or rounding. No cancellation fee applies.
    function refundRemainder(bytes32 taskId) external onlyRole(PLATFORM_ROLE) returns (uint256 refund) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();
        uint256 unused = esc.remaining;
        esc.remaining = 0;
        esc.isActive = false;
        totalLockedByPoster[esc.poster] -= _posterPrincipal(esc);
        uint256 platformBonusRefund;
        (refund, platformBonusRefund) = _splitUnused(esc, unused);
        if (refund > 0) {
            esc.paymentToken.safeTransfer(esc.poster, refund);
            emit FundsRefunded(taskId, esc.poster, refund);
        }
        if (platformBonusRefund > 0) esc.paymentToken.safeTransfer(treasury, platformBonusRefund);
    }

    // ─── Refund Poster ─────────────────────────────────────────────
    function refundPoster(
        bytes32 taskId
    ) external onlyRole(PLATFORM_ROLE) {
        _refundPoster(taskId);
    }

    function _refundPoster(bytes32 taskId) internal {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();

        uint256 unused = esc.remaining;
        (uint256 posterUnused, uint256 platformBonusRefund) = _splitUnused(esc, unused);
        uint256 cancelFee = (posterUnused * CANCEL_FEE_BPS) / 10000;
        uint256 refund = posterUnused - cancelFee;

        esc.remaining = 0;
        esc.isActive = false;

        totalLockedByPoster[esc.poster] -= _posterPrincipal(esc);

        if (refund > 0) esc.paymentToken.safeTransfer(esc.poster, refund);
        if (cancelFee + platformBonusRefund > 0) {
            esc.paymentToken.safeTransfer(treasury, cancelFee + platformBonusRefund);
        }

        emit FundsRefunded(taskId, esc.poster, refund);
    }

    /// @notice Alias for refundPoster — used by TaskManagerV2 on cancellation
    function cancelAndRefund(bytes32 taskId) external onlyRole(PLATFORM_ROLE) {
        _refundPoster(taskId);
    }

    /// @notice Atomically enforce a final arbitration award. The worker share is
    /// paid under the normal fee schedule; the remaining employer principal is
    /// refunded without a cancellation fee and unused platform bonus is returned
    /// to treasury. State is closed before any external token transfer.
    function settleDispute(
        bytes32 taskId,
        string calldata agentId,
        address workerPaymentAddress,
        uint256 workerShareBPS
    ) external onlyRole(ARBITRATION_ROLE) returns (uint256 workerPayment, uint256 posterRefund) {
        EscrowAccount storage esc = escrows[taskId];
        if (!esc.isActive) revert NoActiveEscrow();
        if (workerShareBPS > 10000 || workerPaymentAddress == address(0)) revert InsufficientEscrow();

        uint256 available = esc.remaining;
        uint256 workerGross = (available * workerShareBPS) / 10000;
        uint256 unused = available - workerGross;
        uint256 platformFee = (workerGross * PLATFORM_FEE_BPS) / 10000;
        uint256 validatorFee = (workerGross * VALIDATOR_FEE_BPS) / 10000;
        workerPayment = workerGross - platformFee - validatorFee;
        uint256 platformBonusRefund;
        (posterRefund, platformBonusRefund) = _splitUnused(esc, unused);

        esc.released += workerGross;
        esc.remaining = 0;
        esc.isActive = false;
        totalLockedByPoster[esc.poster] -= _posterPrincipal(esc);

        if (workerGross > 0) {
            releaseHistory[taskId].push(ReleaseRecord({
                amount: workerPayment,
                recipient: workerPaymentAddress,
                agentId: agentId,
                stepNumber: 0,
                qualityScore: 0,
                releasedAt: block.timestamp
            }));
        }

        if (workerPayment > 0) esc.paymentToken.safeTransfer(workerPaymentAddress, workerPayment);
        if (platformFee + platformBonusRefund > 0) {
            esc.paymentToken.safeTransfer(treasury, platformFee + platformBonusRefund);
        }
        if (validatorFee > 0) esc.paymentToken.safeTransfer(validatorPool, validatorFee);
        if (posterRefund > 0) esc.paymentToken.safeTransfer(esc.poster, posterRefund);

        emit DisputeSettled(taskId, workerPaymentAddress, workerGross, posterRefund, workerShareBPS);
        if (workerGross > 0) emit FundsReleased(taskId, agentId, workerPayment, 0);
        if (posterRefund > 0) emit FundsRefunded(taskId, esc.poster, posterRefund);
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

    function _posterPrincipal(EscrowAccount storage esc) internal view returns (uint256) {
        return esc.totalLocked - esc.platformBonusAdded;
    }

    // Platform-funded failure bonuses are consumed after employer principal.
    // Any unused bonus returns to treasury rather than becoming an employer windfall.
    function _splitUnused(
        EscrowAccount storage esc,
        uint256 unused
    ) internal view returns (uint256 posterRefund, uint256 platformBonusRefund) {
        platformBonusRefund = unused < esc.platformBonusAdded ? unused : esc.platformBonusAdded;
        posterRefund = unused - platformBonusRefund;
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
