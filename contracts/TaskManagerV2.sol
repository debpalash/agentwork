// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AgentRegistry.sol";
import "./EscrowVault.sol";
import "./ComplexityOracle.sol";
import "./BiddingEngine.sol";

/**
 * @title TaskManagerV2
 * @notice Restructured task lifecycle for AIWork v2.
 *
 *   Flow: Post → Bidding → Award → Chunked Work → System Verify → Employer Review → Pay
 *
 *   Key changes from v1:
 *   - Tasks go through a BIDDING phase before assignment
 *   - Work is broken into chunks with individual verification
 *   - System verifies each chunk (automated)
 *   - Employer reviews and approves/rejects final output
 *   - Partial payment for verified chunks even on rejection
 */
contract TaskManagerV2 is AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ─── Enums ─────────────────────────────────────────────────
    enum TaskPhase {
        POSTED,         // 0 — Task created, escrow locked
        BIDDING,        // 1 — Accepting bids from worker agents
        AWARDED,        // 2 — Winner selected, repo created
        IN_PROGRESS,    // 3 — Agent working on chunks
        REVIEW,         // 4 — All chunks done, employer reviewing
        COMPLETED,      // 5 — Employer approved, payment released
        REJECTED,       // 6 — Employer rejected final output
        DISPUTED,       // 7 — Under arbitration
        CANCELLED,      // 8 — Cancelled by employer (before award)
        EXPIRED         // 9 — Deadline passed
    }

    enum PaymentModel {
        FULL_COMPLETION,
        STEP_BASED,
        HYBRID
    }

    // ─── Structs ───────────────────────────────────────────────
    struct Chunk {
        string description;
        uint256 percentageBPS;     // Out of 10000
        bool submitted;
        bool verified;             // System-verified (tests pass)
        uint256 submittedAt;
        uint256 verifiedAt;
        bytes32 commitHash;        // Forgejo commit hash
        uint256 qualityScore;      // 0-100 from verifier
    }

    struct Task {
        bytes32 taskId;
        address employer;          // The employer agent's operator
        string employerAgentId;    // Employer's agent ID
        string workerAgentId;      // Awarded worker agent ID
        string title;
        string category;
        PaymentModel paymentModel;
        TaskPhase phase;
        // Reward
        uint256 maxBudget;         // Employer's max budget
        uint256 awardedPrice;      // Winner's bid price
        uint256 bonusPool;
        uint256 paidOut;
        // Timing
        uint256 postedAt;
        uint256 deadline;
        uint256 awardedAt;
        uint256 completedAt;
        // Chunks
        uint256 totalChunks;
        uint256 verifiedChunks;
        // Metadata
        bytes32 specHash;          // IPFS/Forgejo spec hash
        string repoSlug;          // Forgejo repo path: "aiwork/{taskId}"
        // Failure
        uint256 failedAttempts;
        bool employerApproved;
    }

    // ─── State ─────────────────────────────────────────────────
    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => Chunk[]) public taskChunks;
    mapping(address => bytes32[]) public employerTasks;
    mapping(string => bytes32[]) public workerTasks;

    uint256 public totalTasks;
    uint256 public constant AUTO_REVIEW_WINDOW = 48 hours;

    AgentRegistry public agentRegistry;
    EscrowVault public escrowVault;
    ComplexityOracle public complexityOracle;
    BiddingEngine public biddingEngine;

    // ─── Events ────────────────────────────────────────────────
    event TaskPosted(bytes32 indexed taskId, address indexed employer, string employerAgentId, uint256 maxBudget);
    event BiddingStarted(bytes32 indexed taskId, uint256 deadline);
    event TaskAwarded(bytes32 indexed taskId, string workerAgentId, uint256 awardedPrice);
    event ChunkDefined(bytes32 indexed taskId, uint256 chunkIndex, string description, uint256 percentageBPS);
    event ChunkSubmitted(bytes32 indexed taskId, uint256 chunkIndex, bytes32 commitHash);
    event ChunkVerified(bytes32 indexed taskId, uint256 chunkIndex, uint256 qualityScore);
    event TaskSubmittedForReview(bytes32 indexed taskId);
    event EmployerApproved(bytes32 indexed taskId, uint256 totalPaid);
    event EmployerRejected(bytes32 indexed taskId, string reason);
    event TaskCancelled(bytes32 indexed taskId);
    event ChunkPaymentReleased(bytes32 indexed taskId, uint256 chunkIndex, uint256 amount);

    // ─── Errors ────────────────────────────────────────────────
    error WrongPhase();
    error NotEmployer();
    error NotWorker();
    error InvalidChunks();
    error ChunkNotSubmitted();
    error ChunkAlreadyVerified();
    error AllChunksNotVerified();
    error DeadlinePassed();

    constructor(
        address _agentRegistry,
        address _escrowVault,
        address _complexityOracle,
        address _biddingEngine
    ) {
        agentRegistry = AgentRegistry(_agentRegistry);
        escrowVault = EscrowVault(_escrowVault);
        complexityOracle = ComplexityOracle(_complexityOracle);
        biddingEngine = BiddingEngine(payable(_biddingEngine));
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════
    // 1. POST TASK — Employer creates task, locks escrow
    // ═══════════════════════════════════════════════════════════
    function postTask(
        string calldata _title,
        string calldata _category,
        string calldata _employerAgentId,
        PaymentModel _paymentModel,
        address _paymentToken,
        uint256 _maxBudget,
        uint256 _bonusPool,
        uint256 _deadlineHours,
        bytes32 _specHash,
        uint256 _biddingHours
    ) external {
        totalTasks++;
        bytes32 taskId = keccak256(abi.encodePacked(
            msg.sender, block.timestamp, totalTasks, _title
        ));

        tasks[taskId] = Task({
            taskId: taskId,
            employer: msg.sender,
            employerAgentId: _employerAgentId,
            workerAgentId: "",
            title: _title,
            category: _category,
            paymentModel: _paymentModel,
            phase: TaskPhase.BIDDING,
            maxBudget: _maxBudget,
            awardedPrice: 0,
            bonusPool: _bonusPool,
            paidOut: 0,
            postedAt: block.timestamp,
            deadline: block.timestamp + (_deadlineHours * 1 hours),
            awardedAt: 0,
            completedAt: 0,
            totalChunks: 0,
            verifiedChunks: 0,
            specHash: _specHash,
            repoSlug: "",
            failedAttempts: 0,
            employerApproved: false
        });

        employerTasks[msg.sender].push(taskId);

        // Lock employer's funds in escrow (lockFunds does the safeTransferFrom)
        escrowVault.lockFunds(taskId, msg.sender, _paymentToken, _maxBudget + _bonusPool);

        // Open bidding
        biddingEngine.openBidding(taskId, _biddingHours);

        emit TaskPosted(taskId, msg.sender, _employerAgentId, _maxBudget);
        emit BiddingStarted(taskId, block.timestamp + (_biddingHours * 1 hours));
    }

    // ═══════════════════════════════════════════════════════════
    // 2. DEFINE CHUNKS — Platform breaks task into verifiable pieces
    // ═══════════════════════════════════════════════════════════
    function defineChunks(
        bytes32 taskId,
        string[] calldata descriptions,
        uint256[] calldata percentages
    ) external onlyRole(PLATFORM_ROLE) {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.BIDDING && task.phase != TaskPhase.AWARDED)
            revert WrongPhase();
        if (descriptions.length != percentages.length || descriptions.length == 0)
            revert InvalidChunks();

        // Validate percentages sum to 10000
        uint256 totalBPS = 0;
        for (uint256 i = 0; i < percentages.length; i++) {
            totalBPS += percentages[i];
        }
        require(totalBPS == 10000, "Chunks must sum to 10000 BPS");

        // Clear existing chunks and create new ones
        delete taskChunks[taskId];
        for (uint256 i = 0; i < descriptions.length; i++) {
            taskChunks[taskId].push(Chunk({
                description: descriptions[i],
                percentageBPS: percentages[i],
                submitted: false,
                verified: false,
                submittedAt: 0,
                verifiedAt: 0,
                commitHash: bytes32(0),
                qualityScore: 0
            }));
            emit ChunkDefined(taskId, i, descriptions[i], percentages[i]);
        }

        task.totalChunks = descriptions.length;
    }

    // ═══════════════════════════════════════════════════════════
    // 3. AWARD TASK — Platform assigns to winning bidder
    // ═══════════════════════════════════════════════════════════
    function awardToWinner(
        bytes32 taskId,
        string calldata repoSlug
    ) external onlyRole(PLATFORM_ROLE) {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.BIDDING) revert WrongPhase();

        BiddingEngine.Bid memory winningBid = biddingEngine.getAwardedBid(taskId);
        string memory winner = winningBid.agentId;
        require(bytes(winner).length > 0, "No winner awarded in bidding engine");
        require(agentRegistry.getWallet(winner) == winningBid.bidder, "Bidder does not own agent ID");

        task.workerAgentId = winner;
        task.awardedPrice = winningBid.bidPrice;
        task.repoSlug = repoSlug;
        task.phase = TaskPhase.IN_PROGRESS;
        task.awardedAt = block.timestamp;

        workerTasks[winner].push(taskId);

        emit TaskAwarded(taskId, winner, task.awardedPrice);
    }

    // ═══════════════════════════════════════════════════════════
    // 4. SUBMIT CHUNK — Worker pushes code, system records commit
    // ═══════════════════════════════════════════════════════════
    function submitChunk(
        bytes32 taskId,
        uint256 chunkIndex,
        bytes32 commitHash
    ) external onlyRole(PLATFORM_ROLE) {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.IN_PROGRESS) revert WrongPhase();

        Chunk storage chunk = taskChunks[taskId][chunkIndex];
        chunk.submitted = true;
        chunk.submittedAt = block.timestamp;
        chunk.commitHash = commitHash;

        emit ChunkSubmitted(taskId, chunkIndex, commitHash);
    }

    // ═══════════════════════════════════════════════════════════
    // 5. VERIFY CHUNK — System runs tests, scores quality
    // ═══════════════════════════════════════════════════════════
    function verifyChunk(
        bytes32 taskId,
        uint256 chunkIndex,
        uint256 qualityScore
    ) external onlyRole(VERIFIER_ROLE) {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.IN_PROGRESS) revert WrongPhase();

        Chunk storage chunk = taskChunks[taskId][chunkIndex];
        if (!chunk.submitted) revert ChunkNotSubmitted();
        if (chunk.verified) revert ChunkAlreadyVerified();

        chunk.verified = true;
        chunk.verifiedAt = block.timestamp;
        chunk.qualityScore = qualityScore > 100 ? 100 : qualityScore;
        task.verifiedChunks++;

        emit ChunkVerified(taskId, chunkIndex, qualityScore);

        // If all chunks verified, move to REVIEW
        if (task.verifiedChunks == task.totalChunks) {
            task.phase = TaskPhase.REVIEW;
            emit TaskSubmittedForReview(taskId);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 6. EMPLOYER APPROVE — Release full payment
    // ═══════════════════════════════════════════════════════════
    function employerApprove(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.REVIEW) revert WrongPhase();
        if (msg.sender != task.employer) revert NotEmployer();

        task.phase = TaskPhase.COMPLETED;
        task.completedAt = block.timestamp;
        task.employerApproved = true;

        // Calculate average quality score
        uint256 totalQuality = 0;
        Chunk[] storage chunks = taskChunks[taskId];
        for (uint256 i = 0; i < chunks.length; i++) {
            totalQuality += chunks[i].qualityScore;
        }
        uint256 avgQuality = totalQuality / chunks.length;

        // Get worker payment address and release escrow
        address payAddr = agentRegistry.getPaymentAddress(task.workerAgentId);
        escrowVault.releaseAwardedPayment(
            taskId,
            task.workerAgentId,
            payAddr,
            task.awardedPrice + task.bonusPool,
            avgQuality
        );

        // Refund winner's bid stake
        biddingEngine.refundWinnerStake(taskId);

        // Update agent reputation (success)
        agentRegistry.updateReputation(task.workerAgentId, true, false, 8, avgQuality);

        uint256 totalPaid = escrowVault.getEscrow(taskId).released;
        task.paidOut = totalPaid;

        emit EmployerApproved(taskId, totalPaid);
    }

    // ═══════════════════════════════════════════════════════════
    // 7. EMPLOYER REJECT — Freeze escrow for arbitration
    // ═══════════════════════════════════════════════════════════
    function employerReject(bytes32 taskId, string calldata reason) external {
        Task storage task = tasks[taskId];
        if (task.phase != TaskPhase.REVIEW) revert WrongPhase();
        if (msg.sender != task.employer) revert NotEmployer();

        // All chunks have already passed system verification when a task is in
        // REVIEW. A unilateral rejection must therefore freeze settlement for
        // arbitration; it must not silently strand funds or punish the worker.
        task.phase = TaskPhase.DISPUTED;
        task.failedAttempts++;

        emit EmployerRejected(taskId, reason);
    }

    // ═══════════════════════════════════════════════════════════
    // 8. CANCEL — Before award only
    // ═══════════════════════════════════════════════════════════
    function cancelTask(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.employer) revert NotEmployer();
        if (task.phase != TaskPhase.POSTED && task.phase != TaskPhase.BIDDING)
            revert WrongPhase();

        task.phase = TaskPhase.CANCELLED;
        escrowVault.cancelAndRefund(taskId);

        emit TaskCancelled(taskId);
    }

    // ═══════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getTaskChunks(bytes32 taskId) external view returns (Chunk[] memory) {
        return taskChunks[taskId];
    }

    function getChunk(bytes32 taskId, uint256 index) external view returns (Chunk memory) {
        return taskChunks[taskId][index];
    }

    function getEmployerTasks(address employer) external view returns (bytes32[] memory) {
        return employerTasks[employer];
    }

    function getWorkerTasks(string calldata agentId) external view returns (bytes32[] memory) {
        return workerTasks[agentId];
    }

    function getTaskProgress(bytes32 taskId) external view returns (
        uint256 total, uint256 verified, uint256 percentComplete
    ) {
        Task storage task = tasks[taskId];
        total = task.totalChunks;
        verified = task.verifiedChunks;
        percentComplete = total > 0 ? (verified * 100) / total : 0;
    }
}
