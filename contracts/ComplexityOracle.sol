// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ComplexityOracle
 * @notice Assesses and reconciles task complexity between poster claims
 *         and platform evaluation. Uses off-chain validator consensus
 *         with on-chain trimmed mean finalization.
 *
 *         Key features:
 *         - 7 weighted complexity factors
 *         - Validator consensus (min 3 validators, trimmed mean)
 *         - Historical calibration per category (rolling 100-task average)
 *         - Complexity correction when poster underestimates
 */
contract ComplexityOracle is AccessControl {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    uint256 public constant MAX_COMPLEXITY = 15;
    uint256 public constant MIN_VALIDATORS = 3;

    // ─── Structs ───────────────────────────────────────────────────
    struct ComplexityFactors {
        uint256 technicalDepth;       // 1-15: How technical
        uint256 domainSpecificity;    // 1-15: Niche knowledge needed
        uint256 outputVolume;         // 1-15: Size of expected output
        uint256 multiStepReasoning;   // 1-15: Chain-of-thought depth
        uint256 creativityRequired;   // 1-15: Novel generation needed
        uint256 verifiability;        // 1-15: How hard to verify
        uint256 timeConstraint;       // 1-15: Urgency factor
    }

    struct Assessment {
        bytes32 taskId;
        uint256 posterClaim;
        uint256 platformScore;       // Computed from factors
        uint256 validatorConsensus;  // From validator voting
        uint256 finalScore;          // Reconciled score
        uint256 failureAdjustment;   // Added due to agent failures
        uint256 timestamp;
        bool isFinalized;
        bool posterOverridden;       // Platform disagreed with poster
    }

    // ─── State ─────────────────────────────────────────────────────
    mapping(bytes32 => Assessment) public assessments;
    mapping(bytes32 => mapping(address => uint256)) public validatorVotes;
    mapping(bytes32 => address[]) public taskValidators;
    mapping(bytes32 => uint256) public voteCount;

    // Historical calibration
    mapping(string => uint256[]) public categoryHistory;
    mapping(string => uint256) public categoryBaseline;

    // ─── Events ────────────────────────────────────────────────────
    event AssessmentCreated(bytes32 indexed taskId, uint256 posterClaim, uint256 platformScore);
    event ValidatorVoted(bytes32 indexed taskId, address indexed validator, uint256 score);
    event AssessmentFinalized(bytes32 indexed taskId, uint256 finalScore, bool posterOverridden);
    event ComplexityBumped(bytes32 indexed taskId, uint256 oldLevel, uint256 newLevel, uint256 failureCount);
    event CategoryBaselineUpdated(string category, uint256 newBaseline);

    // ─── Errors ────────────────────────────────────────────────────
    error InvalidComplexity();
    error AlreadyVoted();
    error AlreadyFinalized();
    error InsufficientVotes();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    // ─── Create Assessment ─────────────────────────────────────────
    /**
     * @notice Platform creates an assessment when a task is posted.
     *         Computes complexity from weighted factors and compares
     *         against poster's claim.
     */
    function createAssessment(
        bytes32 taskId,
        uint256 posterClaim,
        ComplexityFactors calldata factors
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 platformScore) {
        if (posterClaim < 1 || posterClaim > MAX_COMPLEXITY) revert InvalidComplexity();

        platformScore = computeComplexity(factors);

        assessments[taskId] = Assessment({
            taskId: taskId,
            posterClaim: posterClaim,
            platformScore: platformScore,
            validatorConsensus: 0,
            finalScore: 0,
            failureAdjustment: 0,
            timestamp: block.timestamp,
            isFinalized: false,
            posterOverridden: false
        });

        emit AssessmentCreated(taskId, posterClaim, platformScore);
    }

    // ─── Compute Complexity Score ──────────────────────────────────
    /**
     * @notice Weighted scoring of 7 factors.
     *         Weights: technical(25%) + domain(20%) + reasoning(20%)
     *                + creativity(15%) + volume(10%) + verifiability(10%)
     *         Plus urgency multiplier.
     */
    function computeComplexity(
        ComplexityFactors calldata f
    ) public pure returns (uint256) {
        uint256 score = (
            (f.technicalDepth * 25) +
            (f.domainSpecificity * 20) +
            (f.multiStepReasoning * 20) +
            (f.creativityRequired * 15) +
            (f.outputVolume * 10) +
            (f.verifiability * 10)
        ) / 100;

        // Urgency multiplier
        if (f.timeConstraint >= 12) {
            score = (score * 130) / 100; // +30%
        } else if (f.timeConstraint >= 8) {
            score = (score * 115) / 100; // +15%
        }

        // Clamp to 1-15
        if (score < 1) score = 1;
        if (score > MAX_COMPLEXITY) score = MAX_COMPLEXITY;
        return score;
    }

    // ─── Validator Voting ──────────────────────────────────────────
    function submitVote(
        bytes32 taskId,
        uint256 score
    ) external onlyRole(VALIDATOR_ROLE) {
        if (score < 1 || score > MAX_COMPLEXITY) revert InvalidComplexity();
        if (validatorVotes[taskId][msg.sender] != 0) revert AlreadyVoted();
        if (assessments[taskId].isFinalized) revert AlreadyFinalized();

        validatorVotes[taskId][msg.sender] = score;
        taskValidators[taskId].push(msg.sender);
        voteCount[taskId]++;

        emit ValidatorVoted(taskId, msg.sender, score);
    }

    // ─── Finalize Assessment ───────────────────────────────────────
    /**
     * @notice Finalize with trimmed mean of validator scores,
     *         then reconcile with poster claim.
     */
    function finalizeAssessment(
        bytes32 taskId
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 finalScore) {
        Assessment storage a = assessments[taskId];
        if (a.isFinalized) revert AlreadyFinalized();
        if (voteCount[taskId] < MIN_VALIDATORS) revert InsufficientVotes();

        // Collect validator scores
        uint256[] memory scores = new uint256[](voteCount[taskId]);
        for (uint256 i = 0; i < taskValidators[taskId].length; i++) {
            scores[i] = validatorVotes[taskId][taskValidators[taskId][i]];
        }

        // Trimmed mean (remove highest and lowest, average rest)
        a.validatorConsensus = _trimmedMean(scores);

        // Reconcile: poster claim vs platform + validator consensus
        uint256 expertScore = (a.platformScore + a.validatorConsensus) / 2;
        finalScore = _reconcile(a.posterClaim, expertScore);

        a.finalScore = finalScore;
        a.isFinalized = true;
        a.posterOverridden = (finalScore != a.posterClaim);

        emit AssessmentFinalized(taskId, finalScore, a.posterOverridden);
    }

    /**
     * @notice Quick-finalize without validators (platform-only assessment).
     *         Used for low-value tasks or when validators aren't available.
     */
    function quickFinalize(
        bytes32 taskId
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 finalScore) {
        Assessment storage a = assessments[taskId];
        if (a.isFinalized) revert AlreadyFinalized();

        finalScore = _reconcile(a.posterClaim, a.platformScore);

        a.finalScore = finalScore;
        a.validatorConsensus = a.platformScore;
        a.isFinalized = true;
        a.posterOverridden = (finalScore != a.posterClaim);

        emit AssessmentFinalized(taskId, finalScore, a.posterOverridden);
    }

    // ─── Failure-Based Complexity Bump ─────────────────────────────
    /**
     * @notice Increase complexity after multiple agent failures.
     *         +1 level per 3 failures (capped at MAX_COMPLEXITY).
     */
    function bumpComplexity(
        bytes32 taskId,
        uint256 failureCount
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 newLevel) {
        Assessment storage a = assessments[taskId];
        uint256 oldLevel = a.finalScore;

        uint256 bump = failureCount / 3; // +1 per 3 failures
        if (bump == 0) bump = 1;

        newLevel = oldLevel + bump;
        if (newLevel > MAX_COMPLEXITY) newLevel = MAX_COMPLEXITY;

        a.finalScore = newLevel;
        a.failureAdjustment += bump;

        emit ComplexityBumped(taskId, oldLevel, newLevel, failureCount);
    }

    // ─── Historical Calibration ────────────────────────────────────
    function recordComplexityOutcome(
        string calldata category,
        uint256 actualComplexity
    ) external onlyRole(PLATFORM_ROLE) {
        categoryHistory[category].push(actualComplexity);

        // Rolling average of last 100 tasks
        uint256[] storage history = categoryHistory[category];
        uint256 start = history.length > 100 ? history.length - 100 : 0;
        uint256 sum = 0;

        for (uint256 i = start; i < history.length; i++) {
            sum += history[i];
        }

        categoryBaseline[category] = sum / (history.length - start);
        emit CategoryBaselineUpdated(category, categoryBaseline[category]);
    }

    // ─── Internal Helpers ──────────────────────────────────────────
    function _reconcile(
        uint256 posterClaim,
        uint256 expertScore
    ) internal pure returns (uint256) {
        uint256 diff = posterClaim > expertScore
            ? posterClaim - expertScore
            : expertScore - posterClaim;

        // Within 2 levels: average
        if (diff <= 2) {
            return (posterClaim + expertScore) / 2;
        }

        // Poster claims way easier than experts: trust experts
        if (posterClaim < expertScore && diff > 3) {
            return expertScore;
        }

        // Poster claims way harder: weighted toward experts
        return (posterClaim + (expertScore * 2)) / 3;
    }

    function _trimmedMean(
        uint256[] memory scores
    ) internal pure returns (uint256) {
        // Sort
        for (uint256 i = 0; i < scores.length; i++) {
            for (uint256 j = i + 1; j < scores.length; j++) {
                if (scores[j] < scores[i]) {
                    (scores[i], scores[j]) = (scores[j], scores[i]);
                }
            }
        }

        // If 3 or fewer, just average all
        if (scores.length <= 3) {
            uint256 totalSum = 0;
            for (uint256 i = 0; i < scores.length; i++) totalSum += scores[i];
            return totalSum / scores.length;
        }

        // Remove highest and lowest, average rest
        uint256 sum = 0;
        for (uint256 i = 1; i < scores.length - 1; i++) {
            sum += scores[i];
        }
        return sum / (scores.length - 2);
    }

    // ─── View ──────────────────────────────────────────────────────
    function getAssessment(
        bytes32 taskId
    ) external view returns (Assessment memory) {
        return assessments[taskId];
    }
}
