// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AgentRegistry.sol";
import "./EscrowVault.sol";
import "./ComplexityOracle.sol";

interface IDisputeResolution {
    function openDispute(bytes32 taskId, address opener, bytes32 reasonHash) external returns (uint256);
}

/**
 * @title TaskManager
 * @notice Core task lifecycle contract for AIWork.
 *         Handles task creation, assignment, step submissions,
 *         poster verification, failure tracking, and reward bumps.
 *
 *         Payment Models:
 *         - FULL_COMPLETION: all-or-nothing
 *         - STEP_BASED: milestones with BPS allocations
 *         - FRACTIONAL: micro-payments per output unit
 *         - HYBRID: steps + quality bonus
 */
contract TaskManager is AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ─── Enums ─────────────────────────────────────────────────────
    enum PaymentModel {
        FULL_COMPLETION,
        STEP_BASED,
        FRACTIONAL,
        HYBRID
    }

    enum TaskStatus {
        OPEN,
        ASSIGNED,
        IN_PROGRESS,
        STEP_REVIEW,
        COMPLETED,
        PARTIALLY_COMPLETED,
        DISPUTED,
        CANCELLED,
        EXPIRED
    }

    // ─── Structs ───────────────────────────────────────────────────
    struct TaskStep {
        string description;
        uint256 rewardPercentageBPS;   // Out of 10000
        bool isCompleted;
        bool isVerified;
        uint256 completedAt;
        bytes32 deliverableHash;
        uint256 qualityScore;          // 0-100
    }

    struct Task {
        bytes32 taskId;
        address poster;
        string assignedAgentId;
        string title;
        string category;
        PaymentModel paymentModel;
        TaskStatus status;
        // Reward
        uint256 baseReward;
        uint256 bonusPool;
        uint256 paidOut;
        // Timing
        uint256 postedAt;
        uint256 deadline;
        uint256 assignedAt;
        uint256 completedAt;
        // Steps
        uint256 currentStep;
        uint256 totalSteps;
        // Verification
        bytes32 requirementsHash;
        bytes32 deliverableHash;
        bool posterVerified;
        // Failure tracking
        uint256 failedAttempts;
        uint256 complexityBumps;
        // Auto-approval
        uint256 verificationDeadline; // Timestamp after which auto-approves
    }

    struct VerificationAttestation {
        bytes32 evidenceHash;
        uint256 qualityScore;
        uint256 recordedAt;
        bool passed;
    }

    struct VerificationRound {
        bytes32 evidenceHash;
        uint256 qualityTotal;
        uint16 required;
        uint16 received;
        uint16 approvals;
        bool finalized;
    }

    // ─── State ─────────────────────────────────────────────────────
    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => TaskStep[]) public taskSteps;
    mapping(bytes32 => address[]) public previousAgents; // Failed agents
    mapping(address => bytes32[]) public posterTasks;
    mapping(string => bytes32[]) public agentTasks;
    mapping(bytes32 => mapping(uint256 => VerificationAttestation)) public verificationAttestations;
    mapping(bytes32 => mapping(uint256 => VerificationRound)) public verificationRounds;
    mapping(bytes32 => mapping(uint256 => uint256)) public verificationRoundIds;
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => mapping(address => bool)))) public verifierVoted;

    uint256 public totalTasks;
    uint256 public constant MAX_COMPLEXITY = 15;
    uint256 public constant FAILURE_BUMP_THRESHOLD = 3;
    uint256 public constant VERIFICATION_WINDOW = 48 hours;
    uint256 public constant REWARD_BUMP_BPS = 1500; // +15% per bump
    uint16 public verificationQuorum = 1;

    AgentRegistry public agentRegistry;
    EscrowVault public escrowVault;
    ComplexityOracle public complexityOracle;
    IDisputeResolution public disputeResolution;

    // ─── Events ────────────────────────────────────────────────────
    event TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, PaymentModel model);
    event TaskAssigned(bytes32 indexed taskId, string agentId);
    event StepSubmitted(bytes32 indexed taskId, uint256 stepNumber, bytes32 deliverableHash);
    event StepVerified(bytes32 indexed taskId, uint256 stepNumber, bool approved, uint256 qualityScore);
    event TaskCompleted(bytes32 indexed taskId, string agentId, uint256 totalPaid);
    event TaskCancelled(bytes32 indexed taskId);
    event AgentFailed(bytes32 indexed taskId, string agentId, uint256 totalFailures);
    event RewardBumped(bytes32 indexed taskId, uint256 oldReward, uint256 newReward);
    event AutoApprovalTriggered(bytes32 indexed taskId, uint256 stepNumber);
    event VerificationAttested(bytes32 indexed taskId, uint256 indexed stepNumber, bytes32 indexed evidenceHash, bool passed, uint256 qualityScore);
    event VerificationVote(bytes32 indexed taskId, uint256 indexed stepNumber, uint256 indexed roundId, address verifier, bool passed, uint256 qualityScore);
    event VerificationQuorumChanged(uint16 oldQuorum, uint16 newQuorum);
    event DisputeResolutionConfigured(address indexed resolver);
    event TaskDisputed(bytes32 indexed taskId, uint256 indexed disputeId, address indexed opener, bytes32 reasonHash);
    event TaskDisputeFinalized(bytes32 indexed taskId, uint256 workerShareBPS, TaskStatus status);

    // ─── Errors ────────────────────────────────────────────────────
    error TaskNotOpen();
    error TaskNotInProgress();
    error TaskNotInReview();
    error NotPoster();
    error NotAssignedAgent();
    error AgentPreviouslyFailed();
    error InvalidStepPercentages();
    error WrongStep();
    error DeadlinePassed();
    error VerificationWindowActive();
    error VerificationRequired();
    error VerificationScoreMismatch();
    error VerifierAlreadyVoted();
    error EvidenceHashMismatch();
    error InvalidVerificationQuorum();
    error NotDisputeResolver();

    constructor(
        address _agentRegistry,
        address _escrowVault,
        address _complexityOracle
    ) {
        agentRegistry = AgentRegistry(_agentRegistry);
        escrowVault = EscrowVault(_escrowVault);
        complexityOracle = ComplexityOracle(_complexityOracle);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }

    /// @notice Configure an odd verifier quorum. A round snapshots this value on
    /// its first vote so governance changes cannot alter an active decision.
    function setVerificationQuorum(uint16 newQuorum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newQuorum == 0 || newQuorum > 15 || newQuorum % 2 == 0) revert InvalidVerificationQuorum();
        uint16 oldQuorum = verificationQuorum;
        verificationQuorum = newQuorum;
        emit VerificationQuorumChanged(oldQuorum, newQuorum);
    }

    function configureDisputeResolution(address resolver) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(resolver != address(0), "zero address");
        disputeResolution = IDisputeResolution(resolver);
        emit DisputeResolutionConfigured(resolver);
    }

    // ─── Post Task ─────────────────────────────────────────────────
    /**
     * @notice Create a new task. Poster's funds are locked in escrow.
     *         Platform assesses complexity and may override poster's claim.
     */
    function postTask(
        string calldata _title,
        string calldata _category,
        PaymentModel _paymentModel,
        address _paymentToken,
        uint256 _baseReward,
        uint256 _bonusPool,
        uint256 /* _complexityClaim */,
        uint256 _deadline,
        bytes32 _requirementsHash,
        string[] calldata _stepDescriptions,
        uint256[] calldata _stepPercentages
    ) external returns (bytes32 taskId) {
        require(_baseReward > 0, "Reward required");
        require(_deadline > block.timestamp, "Invalid deadline");

        // Validate steps for step-based models
        if (_paymentModel == PaymentModel.STEP_BASED || _paymentModel == PaymentModel.HYBRID) {
            if (_stepDescriptions.length == 0 || _stepDescriptions.length != _stepPercentages.length)
                revert InvalidStepPercentages();
            _validateStepPercentages(_stepPercentages);
        }

        // Generate task ID
        taskId = keccak256(abi.encodePacked(msg.sender, _title, block.timestamp, totalTasks));

        // Lock funds in escrow
        uint256 totalEscrow = _baseReward + _bonusPool;
        escrowVault.lockFunds(taskId, msg.sender, _paymentToken, totalEscrow);

        // Store task
        Task storage task = tasks[taskId];
        task.taskId = taskId;
        task.poster = msg.sender;
        task.title = _title;
        task.category = _category;
        task.paymentModel = _paymentModel;
        task.status = TaskStatus.OPEN;
        task.baseReward = _baseReward;
        task.bonusPool = _bonusPool;
        task.postedAt = block.timestamp;
        task.deadline = _deadline;
        task.requirementsHash = _requirementsHash;

        // Initialize steps
        if (_paymentModel == PaymentModel.STEP_BASED || _paymentModel == PaymentModel.HYBRID) {
            for (uint i = 0; i < _stepDescriptions.length; i++) {
                taskSteps[taskId].push(TaskStep({
                    description: _stepDescriptions[i],
                    rewardPercentageBPS: _stepPercentages[i],
                    isCompleted: false,
                    isVerified: false,
                    completedAt: 0,
                    deliverableHash: bytes32(0),
                    qualityScore: 0
                }));
            }
            task.totalSteps = _stepDescriptions.length;
        }

        posterTasks[msg.sender].push(taskId);
        totalTasks++;

        emit TaskPosted(taskId, msg.sender, _baseReward, _paymentModel);
        return taskId;
    }

    // ─── Assign Agent ──────────────────────────────────────────────
    function assignTask(
        bytes32 taskId,
        string calldata agentId
    ) external onlyRole(PLATFORM_ROLE) {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.OPEN) revert TaskNotOpen();
        if (block.timestamp > task.deadline) revert DeadlinePassed();

        AgentRegistry.AgentProfile memory agent = agentRegistry.getAgent(agentId);
        require(agent.status == AgentRegistry.AgentStatus.ACTIVE, "Agent not active");

        // Check agent hasn't failed this task before
        address agentWallet = agent.walletAddress;
        for (uint i = 0; i < previousAgents[taskId].length; i++) {
            if (previousAgents[taskId][i] == agentWallet)
                revert AgentPreviouslyFailed();
        }

        task.assignedAgentId = agentId;
        task.status = TaskStatus.IN_PROGRESS;
        task.assignedAt = block.timestamp;

        agentTasks[agentId].push(taskId);
        emit TaskAssigned(taskId, agentId);
    }

    // ─── Submit Step ───────────────────────────────────────────────
    function submitStep(
        bytes32 taskId,
        uint256 stepNumber,
        bytes32 deliverableHash
    ) external {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.IN_PROGRESS) revert TaskNotInProgress();
        if (block.timestamp > task.deadline) revert DeadlinePassed();
        if (stepNumber != task.currentStep) revert WrongStep();
        require(
            msg.sender == agentRegistry.getWallet(task.assignedAgentId),
            "Not assigned agent"
        );

        TaskStep storage step = taskSteps[taskId][stepNumber];
        delete verificationAttestations[taskId][stepNumber];
        delete verificationRounds[taskId][stepNumber];
        verificationRoundIds[taskId][stepNumber]++;
        step.deliverableHash = deliverableHash;
        step.completedAt = block.timestamp;

        task.status = TaskStatus.STEP_REVIEW;
        task.verificationDeadline = block.timestamp + VERIFICATION_WINDOW;

        emit StepSubmitted(taskId, stepNumber, deliverableHash);
    }

    // ─── Submit Full Completion ────────────────────────────────────
    function submitCompletion(
        bytes32 taskId,
        bytes32 deliverableHash
    ) external {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.IN_PROGRESS) revert TaskNotInProgress();
        if (block.timestamp > task.deadline) revert DeadlinePassed();
        require(
            msg.sender == agentRegistry.getWallet(task.assignedAgentId),
            "Not assigned agent"
        );

        delete verificationAttestations[taskId][0];
        delete verificationRounds[taskId][0];
        verificationRoundIds[taskId][0]++;
        task.deliverableHash = deliverableHash;
        task.status = TaskStatus.STEP_REVIEW;
        task.verificationDeadline = block.timestamp + VERIFICATION_WINDOW;

        emit StepSubmitted(taskId, 0, deliverableHash);
    }

    /**
     * @notice Vote on the exact submitted artifact. The first vote commits the
     *         round to a shared evidence digest and snapshots the configured
     *         quorum. Settlement stays locked until the full quorum participates.
     */
    function attestVerification(
        bytes32 taskId,
        uint256 stepNumber,
        bytes32 evidenceHash,
        bool passed,
        uint256 qualityScore
    ) external onlyRole(VERIFIER_ROLE) {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.STEP_REVIEW) revert TaskNotInReview();
        if (qualityScore > 100 || evidenceHash == bytes32(0)) revert VerificationRequired();
        if (task.paymentModel != PaymentModel.FULL_COMPLETION && stepNumber != task.currentStep) revert WrongStep();
        bytes32 submittedHash = task.paymentModel == PaymentModel.FULL_COMPLETION
            ? task.deliverableHash
            : taskSteps[taskId][stepNumber].deliverableHash;
        if (submittedHash == bytes32(0)) revert VerificationRequired();

        uint256 roundId = verificationRoundIds[taskId][stepNumber];
        if (verifierVoted[taskId][stepNumber][roundId][msg.sender]) revert VerifierAlreadyVoted();
        VerificationRound storage round = verificationRounds[taskId][stepNumber];
        if (round.required == 0) {
            round.required = verificationQuorum;
            round.evidenceHash = evidenceHash;
        } else if (round.evidenceHash != evidenceHash) {
            revert EvidenceHashMismatch();
        }

        verifierVoted[taskId][stepNumber][roundId][msg.sender] = true;
        round.received++;
        if (passed) {
            round.approvals++;
            round.qualityTotal += qualityScore;
        }
        emit VerificationVote(taskId, stepNumber, roundId, msg.sender, passed, qualityScore);

        if (round.received == round.required) {
            round.finalized = true;
            bool consensusPassed = round.approvals * 2 > round.required;
            uint256 consensusQuality = round.approvals == 0 ? 0 : round.qualityTotal / round.approvals;
            verificationAttestations[taskId][stepNumber] = VerificationAttestation({
                evidenceHash: evidenceHash,
                qualityScore: consensusQuality,
                recordedAt: block.timestamp,
                passed: consensusPassed
            });
            emit VerificationAttested(taskId, stepNumber, evidenceHash, consensusPassed, consensusQuality);
        }
    }

    // ─── Poster Verify Step ────────────────────────────────────────
    function verifyStep(
        bytes32 taskId,
        uint256 stepNumber,
        bool approved,
        uint256 qualityScore
    ) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.poster) revert NotPoster();
        if (task.status != TaskStatus.STEP_REVIEW) revert TaskNotInReview();
        if (stepNumber != task.currentStep) revert WrongStep();
        require(qualityScore <= 100, "Invalid quality score");

        if (approved) {
            VerificationAttestation memory attestation = verificationAttestations[taskId][stepNumber];
            if (!attestation.passed) revert VerificationRequired();
            if (qualityScore != attestation.qualityScore) revert VerificationScoreMismatch();
            TaskStep storage step = taskSteps[taskId][stepNumber];
            step.isCompleted = true;
            step.isVerified = true;
            step.completedAt = block.timestamp;
            step.qualityScore = qualityScore;

            // Release step payment
            escrowVault.releaseStepPayment(
                taskId,
                task.assignedAgentId,
                agentRegistry.getPaymentAddress(task.assignedAgentId),
                stepNumber,
                step.rewardPercentageBPS,
                qualityScore
            );
            task.paidOut = escrowVault.getEscrow(taskId).released;

            // Update agent reputation
            agentRegistry.updateReputation(
                task.assignedAgentId,
                true,
                false,
                complexityOracle.getAssessment(taskId).finalScore,
                qualityScore
            );

            task.currentStep++;

            // Check if all steps done
            if (task.currentStep >= task.totalSteps) {
                escrowVault.refundRemainder(taskId);
                task.status = TaskStatus.COMPLETED;
                task.completedAt = block.timestamp;
                task.posterVerified = true;
                emit TaskCompleted(taskId, task.assignedAgentId, task.paidOut);
            } else {
                task.status = TaskStatus.IN_PROGRESS;
            }

            emit StepVerified(taskId, stepNumber, true, qualityScore);
        } else {
            VerificationAttestation memory rejectionAttestation = verificationAttestations[taskId][stepNumber];
            if (rejectionAttestation.recordedAt == 0 || rejectionAttestation.passed) revert VerificationRequired();
            // Rejection → record failure
            _recordFailure(taskId, task.assignedAgentId);
            emit StepVerified(taskId, stepNumber, false, qualityScore);
        }
    }

    // ─── Verify Full Completion ────────────────────────────────────
    function verifyCompletion(
        bytes32 taskId,
        bool approved,
        uint256 qualityScore
    ) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.poster) revert NotPoster();
        if (task.status != TaskStatus.STEP_REVIEW) revert TaskNotInReview();
        require(qualityScore <= 100, "Invalid quality score");

        if (approved) {
            VerificationAttestation memory attestation = verificationAttestations[taskId][0];
            if (!attestation.passed) revert VerificationRequired();
            if (qualityScore != attestation.qualityScore) revert VerificationScoreMismatch();
            // Release full payment
            escrowVault.releaseFullPayment(
                taskId,
                task.assignedAgentId,
                agentRegistry.getPaymentAddress(task.assignedAgentId),
                qualityScore
            );
            task.paidOut = escrowVault.getEscrow(taskId).released;

            agentRegistry.updateReputation(
                task.assignedAgentId,
                true,
                false,
                complexityOracle.getAssessment(taskId).finalScore,
                qualityScore
            );

            task.status = TaskStatus.COMPLETED;
            task.completedAt = block.timestamp;
            task.posterVerified = true;

            emit TaskCompleted(taskId, task.assignedAgentId, task.paidOut);
        } else {
            VerificationAttestation memory rejectionAttestation = verificationAttestations[taskId][0];
            if (rejectionAttestation.recordedAt == 0 || rejectionAttestation.passed) revert VerificationRequired();
            _recordFailure(taskId, task.assignedAgentId);
        }
    }

    // ─── Auto-Approve After Timeout ────────────────────────────────
    /**
     * @notice If poster doesn't verify within 48 hours, the platform verifier
     *         may settle using the already-recorded passing verification score.
     */
    function triggerAutoApproval(bytes32 taskId) external onlyRole(PLATFORM_ROLE) {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.STEP_REVIEW) revert TaskNotInReview();
        if (block.timestamp < task.verificationDeadline) revert VerificationWindowActive();

        uint256 approvedStep = task.currentStep;
        uint256 attestationStep = task.paymentModel == PaymentModel.FULL_COMPLETION ? 0 : task.currentStep;
        VerificationAttestation memory attestation = verificationAttestations[taskId][attestationStep];
        if (!attestation.passed) revert VerificationRequired();
        uint256 verifiedQuality = attestation.qualityScore;

        if (task.paymentModel == PaymentModel.FULL_COMPLETION) {
            escrowVault.releaseFullPayment(
                taskId,
                task.assignedAgentId,
                agentRegistry.getPaymentAddress(task.assignedAgentId),
                verifiedQuality
            );
            task.paidOut = escrowVault.getEscrow(taskId).released;
            task.status = TaskStatus.COMPLETED;
            task.completedAt = block.timestamp;
            emit TaskCompleted(taskId, task.assignedAgentId, task.paidOut);
        } else {
            // Release current step
            TaskStep storage step = taskSteps[taskId][task.currentStep];
            step.isCompleted = true;
            step.isVerified = true;
            step.completedAt = block.timestamp;
            step.qualityScore = verifiedQuality;

            escrowVault.releaseStepPayment(
                taskId,
                task.assignedAgentId,
                agentRegistry.getPaymentAddress(task.assignedAgentId),
                task.currentStep,
                step.rewardPercentageBPS,
                verifiedQuality
            );
            task.paidOut = escrowVault.getEscrow(taskId).released;

            task.currentStep++;
            if (task.currentStep >= task.totalSteps) {
                escrowVault.refundRemainder(taskId);
                task.status = TaskStatus.COMPLETED;
                task.completedAt = block.timestamp;
                emit TaskCompleted(taskId, task.assignedAgentId, task.paidOut);
            } else {
                task.status = TaskStatus.IN_PROGRESS;
            }
        }

        agentRegistry.updateReputation(
            task.assignedAgentId,
            true,
            false,
            complexityOracle.getAssessment(taskId).finalScore,
            verifiedQuality
        );

        emit AutoApprovalTriggered(taskId, approvedStep);
    }

    // ─── Enforceable Disputes ─────────────────────────────────────
    function openDispute(bytes32 taskId, bytes32 reasonHash) external returns (uint256 disputeId) {
        Task storage task = tasks[taskId];
        address worker = bytes(task.assignedAgentId).length == 0
            ? address(0)
            : agentRegistry.getWallet(task.assignedAgentId);
        if (msg.sender != task.poster && msg.sender != worker) revert NotAssignedAgent();
        require(
            task.status == TaskStatus.IN_PROGRESS || task.status == TaskStatus.STEP_REVIEW,
            "Task not disputable"
        );
        require(address(disputeResolution) != address(0), "Disputes not configured");
        task.status = TaskStatus.DISPUTED;
        disputeId = disputeResolution.openDispute(taskId, msg.sender, reasonHash);
        emit TaskDisputed(taskId, disputeId, msg.sender, reasonHash);
    }

    function getDisputeParties(bytes32 taskId) external view returns (
        address poster,
        address worker,
        address workerPaymentAddress,
        string memory agentId,
        bool eligible
    ) {
        Task storage task = tasks[taskId];
        agentId = task.assignedAgentId;
        poster = task.poster;
        if (bytes(agentId).length != 0) {
            worker = agentRegistry.getWallet(agentId);
            workerPaymentAddress = agentRegistry.getPaymentAddress(agentId);
        }
        eligible = task.status == TaskStatus.DISPUTED && poster != address(0) && worker != address(0);
    }

    function finalizeDispute(bytes32 taskId, uint256 workerShareBPS) external {
        if (msg.sender != address(disputeResolution)) revert NotDisputeResolver();
        require(workerShareBPS <= 10000, "Invalid worker share");
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.DISPUTED, "Task not disputed");
        task.paidOut = escrowVault.getEscrow(taskId).released;
        task.completedAt = block.timestamp;
        if (workerShareBPS == 10000) {
            task.status = TaskStatus.COMPLETED;
            agentRegistry.updateReputation(
                task.assignedAgentId, true, false,
                complexityOracle.getAssessment(taskId).finalScore, 50
            );
        } else if (workerShareBPS == 0) {
            task.status = TaskStatus.CANCELLED;
            agentRegistry.updateReputation(
                task.assignedAgentId, false, false,
                complexityOracle.getAssessment(taskId).finalScore, 0
            );
        } else {
            task.status = TaskStatus.PARTIALLY_COMPLETED;
            agentRegistry.updateReputation(
                task.assignedAgentId, false, true,
                complexityOracle.getAssessment(taskId).finalScore, 50
            );
        }
        emit TaskDisputeFinalized(taskId, workerShareBPS, task.status);
    }

    // ─── Cancel Task ───────────────────────────────────────────────
    function cancelTask(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.poster) revert NotPoster();
        require(
            task.status == TaskStatus.OPEN || task.status == TaskStatus.ASSIGNED,
            "Cannot cancel in-progress task"
        );

        task.status = TaskStatus.CANCELLED;
        escrowVault.refundPoster(taskId);

        emit TaskCancelled(taskId);
    }

    // ─── Internal: Record Failure ──────────────────────────────────
    function _recordFailure(
        bytes32 taskId,
        string memory agentId
    ) internal {
        Task storage task = tasks[taskId];

        // Update agent reputation (failure)
        agentRegistry.updateReputation(
            agentId,
            false,
            false,
            complexityOracle.getAssessment(taskId).finalScore,
            0
        );

        // Track failure
        previousAgents[taskId].push(agentRegistry.getWallet(agentId));
        task.failedAttempts++;
        task.status = TaskStatus.OPEN;
        task.assignedAgentId = "";

        emit AgentFailed(taskId, agentId, task.failedAttempts);

        // Check if we need to bump complexity & reward
        if (task.failedAttempts >= FAILURE_BUMP_THRESHOLD &&
            task.failedAttempts % FAILURE_BUMP_THRESHOLD == 0)
        {
            _bumpReward(taskId);
        }
    }

    // ─── Internal: Bump Reward After Failures ──────────────────────
    function _bumpReward(bytes32 taskId) internal {
        Task storage task = tasks[taskId];
        uint256 oldReward = task.baseReward;

        // Bump complexity
        complexityOracle.bumpComplexity(taskId, task.failedAttempts);
        task.complexityBumps++;

        // Increase reward by 15%
        uint256 increase = (task.baseReward * REWARD_BUMP_BPS) / 10000;
        task.baseReward += increase;

        // Platform treasury funds the increase
        escrowVault.addPlatformBonus(
            taskId,
            increase,
            "Failure-triggered reward bump"
        );

        emit RewardBumped(taskId, oldReward, task.baseReward);
    }

    // ─── Validate Step Percentages ─────────────────────────────────
    function _validateStepPercentages(
        uint256[] calldata percentages
    ) internal pure {
        uint256 total = 0;
        for (uint i = 0; i < percentages.length; i++) {
            require(percentages[i] > 0, "Step percentage must be > 0");
            total += percentages[i];
        }
        if (total != 10000) revert InvalidStepPercentages();
    }

    // ─── View Functions ────────────────────────────────────────────
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getTaskSteps(bytes32 taskId) external view returns (TaskStep[] memory) {
        return taskSteps[taskId];
    }

    function getPosterTasks(address poster) external view returns (bytes32[] memory) {
        return posterTasks[poster];
    }

    function getAgentTasks(string calldata agentId) external view returns (bytes32[] memory) {
        return agentTasks[agentId];
    }

    function getFailedAgents(bytes32 taskId) external view returns (address[] memory) {
        return previousAgents[taskId];
    }
}
