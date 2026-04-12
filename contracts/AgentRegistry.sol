// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./AIWorkToken.sol";

/**
 * @title AgentRegistry
 * @notice On-chain identity layer for AI agents.
 *         Each agent gets a unique ID (AIWK-{chain}-{category}-{seq}-{checksum}),
 *         bound to a crypto wallet. Identity is soulbound (non-transferable).
 *
 *         Tracks reputation (0-10000 BPS), skills, staking tiers,
 *         and performance metrics.
 */
contract AgentRegistry is AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    // ─── Agent Categories ──────────────────────────────────────────
    enum AgentCategory {
        NLP,           // Natural Language Processing
        VISION,        // Computer Vision
        CODE,          // Code Generation / Review
        DATA,          // Data Analysis
        CREATIVE,      // Creative Tasks
        REASONING,     // Complex Reasoning
        MULTIMODAL,    // Multi-modal Tasks
        SPECIALIZED    // Domain Specific
    }

    enum AgentStatus {
        PENDING,       // Awaiting verification
        ACTIVE,        // Working and earning
        SUSPENDED,     // Temporarily suspended
        BANNED,        // Permanently banned
        RETIRED        // Voluntarily inactive
    }

    // ─── Agent Profile ─────────────────────────────────────────────
    struct AgentProfile {
        string agentId;               // Human-readable ID
        address walletAddress;        // Primary crypto wallet (soulbound)
        address paymentAddress;       // Can differ from wallet
        AgentCategory category;
        AgentStatus status;
        uint256 registrationTime;
        uint256 reputationScore;      // 0-10000 BPS (starts at 5000 = 50%)
        uint256 totalEarned;
        uint256 stakedAmount;
        bool isVerified;
        // Performance
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 tasksPartial;
        uint256 avgQualityScore;      // 0-100
        uint256 currentStreak;        // Consecutive successes
        uint256 bestStreak;
    }

    // ─── State ─────────────────────────────────────────────────────
    mapping(string => AgentProfile) public agents;
    mapping(address => string) public addressToAgentId;
    mapping(AgentCategory => uint256) public categoryCount;
    mapping(string => string[]) public agentSkills;       // agentId => skills

    uint256 public totalAgents;
    AIWorkToken public token;

    // Staking tiers
    uint256 public constant MIN_STAKE = 100 * 10 ** 18;        // 100 AIWK
    uint256 public constant TIER1_STAKE = 500 * 10 ** 18;      // Priority matching
    uint256 public constant TIER2_STAKE = 2_000 * 10 ** 18;    // Exclusive tasks
    uint256 public constant TIER3_STAKE = 10_000 * 10 ** 18;   // Enterprise tasks

    // Reputation thresholds (BPS) by complexity range
    uint256 public constant REP_THRESHOLD_LOW = 2000;      // Complexity 1-5
    uint256 public constant REP_THRESHOLD_MID = 4000;      // Complexity 6-10
    uint256 public constant REP_THRESHOLD_HIGH = 6500;     // Complexity 11-13
    uint256 public constant REP_THRESHOLD_ELITE = 8000;    // Complexity 14-15

    // ─── Events ────────────────────────────────────────────────────
    event AgentRegistered(string indexed agentId, address indexed wallet, AgentCategory category);
    event AgentVerified(string indexed agentId);
    event AgentStatusChanged(string indexed agentId, AgentStatus oldStatus, AgentStatus newStatus);
    event ReputationUpdated(string indexed agentId, uint256 oldScore, uint256 newScore);
    event AgentStaked(string indexed agentId, uint256 amount, uint256 totalStake);
    event AgentUnstaked(string indexed agentId, uint256 amount, uint256 totalStake);

    // ─── Errors ────────────────────────────────────────────────────
    error AddressAlreadyRegistered();
    error AgentNotFound();
    error AgentNotActive();
    error InsufficientReputation(uint256 required, uint256 actual);

    constructor(address _token) {
        token = AIWorkToken(_token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    // ─── Registration ──────────────────────────────────────────────
    function registerAgent(
        address _walletAddress,
        address _paymentAddress,
        AgentCategory _category,
        string[] calldata _skills
    ) external onlyRole(PLATFORM_ROLE) returns (string memory agentId) {
        if (bytes(addressToAgentId[_walletAddress]).length != 0)
            revert AddressAlreadyRegistered();

        agentId = _generateAgentId(_category);

        AgentProfile storage agent = agents[agentId];
        agent.agentId = agentId;
        agent.walletAddress = _walletAddress;
        agent.paymentAddress = _paymentAddress;
        agent.category = _category;
        agent.status = AgentStatus.PENDING;
        agent.registrationTime = block.timestamp;
        agent.reputationScore = 5000; // Start at 50%

        // Store skills
        for (uint i = 0; i < _skills.length; i++) {
            agentSkills[agentId].push(_skills[i]);
        }

        addressToAgentId[_walletAddress] = agentId;
        categoryCount[_category]++;
        totalAgents++;

        emit AgentRegistered(agentId, _walletAddress, _category);
        return agentId;
    }

    // ─── Activate Agent ────────────────────────────────────────────
    function activateAgent(
        string calldata agentId
    ) external onlyRole(PLATFORM_ROLE) {
        AgentProfile storage agent = agents[agentId];
        if (agent.walletAddress == address(0)) revert AgentNotFound();

        AgentStatus old = agent.status;
        agent.status = AgentStatus.ACTIVE;
        agent.isVerified = true;

        emit AgentVerified(agentId);
        emit AgentStatusChanged(agentId, old, AgentStatus.ACTIVE);
    }

    // ─── Reputation Update ─────────────────────────────────────────
    /**
     * @notice Update agent reputation after a task outcome.
     * @param taskSuccess  true if fully completed
     * @param taskPartial  true if partially completed
     * @param complexityLevel The final complexity of the task (1-15)
     * @param qualityScore Poster quality rating (0-100)
     */
    function updateReputation(
        string calldata agentId,
        bool taskSuccess,
        bool taskPartial,
        uint256 complexityLevel,
        uint256 qualityScore
    ) external onlyRole(PLATFORM_ROLE) {
        AgentProfile storage agent = agents[agentId];
        if (agent.walletAddress == address(0)) revert AgentNotFound();

        uint256 oldScore = agent.reputationScore;
        int256 delta;

        if (taskSuccess) {
            // Success: +50 base + complexity bonus
            delta = int256(50 + (complexityLevel * 10));
            agent.tasksCompleted++;
            agent.currentStreak++;
            if (agent.currentStreak > agent.bestStreak)
                agent.bestStreak = agent.currentStreak;
        } else if (taskPartial) {
            // Partial: smaller gain
            delta = int256(20 + (complexityLevel * 3));
            agent.tasksPartial++;
            agent.currentStreak = 0;
        } else {
            // Failure: penalty (less penalty for harder tasks)
            delta = -int256(80 - (complexityLevel * 5));
            agent.tasksFailed++;
            agent.currentStreak = 0;
        }

        // Quality score modifier: (qualityScore - 50) gives -50 to +50
        delta += (int256(qualityScore) - 50);

        // Apply with bounds
        int256 newScore = int256(agent.reputationScore) + delta;
        if (newScore < 0) newScore = 0;
        if (newScore > 10000) newScore = 10000;
        agent.reputationScore = uint256(newScore);

        // Update running average quality
        uint256 totalTasks = agent.tasksCompleted + agent.tasksFailed + agent.tasksPartial;
        if (totalTasks > 0) {
            agent.avgQualityScore = ((agent.avgQualityScore * (totalTasks - 1)) + qualityScore) / totalTasks;
        }

        emit ReputationUpdated(agentId, oldScore, agent.reputationScore);
    }

    // ─── Staking ───────────────────────────────────────────────────
    function stake(string calldata agentId, uint256 amount) external {
        AgentProfile storage agent = agents[agentId];
        if (agent.walletAddress == address(0)) revert AgentNotFound();
        require(msg.sender == agent.walletAddress, "Not agent owner");

        token.transferFrom(msg.sender, address(this), amount);
        agent.stakedAmount += amount;

        emit AgentStaked(agentId, amount, agent.stakedAmount);
    }

    function unstake(string calldata agentId, uint256 amount) external {
        AgentProfile storage agent = agents[agentId];
        if (agent.walletAddress == address(0)) revert AgentNotFound();
        require(msg.sender == agent.walletAddress, "Not agent owner");
        require(agent.stakedAmount >= amount, "Insufficient stake");

        agent.stakedAmount -= amount;
        token.transfer(msg.sender, amount);

        emit AgentUnstaked(agentId, amount, agent.stakedAmount);
    }

    // ─── View Functions ────────────────────────────────────────────
    function getAgent(
        string calldata agentId
    ) external view returns (AgentProfile memory) {
        if (agents[agentId].walletAddress == address(0)) revert AgentNotFound();
        return agents[agentId];
    }

    function getPaymentAddress(
        string calldata agentId
    ) external view returns (address) {
        return agents[agentId].paymentAddress;
    }

    function getWallet(
        string calldata agentId
    ) external view returns (address) {
        return agents[agentId].walletAddress;
    }

    function getMinReputation(
        uint256 complexityLevel
    ) public pure returns (uint256) {
        if (complexityLevel <= 5) return REP_THRESHOLD_LOW;
        if (complexityLevel <= 10) return REP_THRESHOLD_MID;
        if (complexityLevel <= 13) return REP_THRESHOLD_HIGH;
        return REP_THRESHOLD_ELITE;
    }

    function meetsReputation(
        string calldata agentId,
        uint256 complexityLevel
    ) external view returns (bool) {
        return agents[agentId].reputationScore >= getMinReputation(complexityLevel);
    }

    // ─── ID Generation ─────────────────────────────────────────────
    function _generateAgentId(
        AgentCategory _category
    ) internal view returns (string memory) {
        string memory catCode = _getCategoryCode(_category);
        uint256 seq = categoryCount[_category] + 1;

        uint256 chainId;
        assembly { chainId := chainid() }

        // Build base: AIWK-{chainId}-{cat}-{seq}
        string memory base = string(
            abi.encodePacked(
                "AIWK-",
                _uint2str(chainId),
                "-",
                catCode,
                "-",
                _padNumber(seq, 6)
            )
        );

        // Checksum: first 2 hex chars of hash
        bytes32 hash = keccak256(abi.encodePacked(base, block.timestamp));
        bytes memory checksum = new bytes(2);
        checksum[0] = _toHexChar(uint8(hash[0] >> 4));
        checksum[1] = _toHexChar(uint8(hash[0] & 0x0f));

        return string(abi.encodePacked(base, "-", string(checksum)));
    }

    function _getCategoryCode(
        AgentCategory _cat
    ) internal pure returns (string memory) {
        if (_cat == AgentCategory.NLP) return "NLP";
        if (_cat == AgentCategory.VISION) return "VIS";
        if (_cat == AgentCategory.CODE) return "COD";
        if (_cat == AgentCategory.DATA) return "DAT";
        if (_cat == AgentCategory.CREATIVE) return "CRE";
        if (_cat == AgentCategory.REASONING) return "RSN";
        if (_cat == AgentCategory.MULTIMODAL) return "MLT";
        return "SPC";
    }

    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 temp = _i;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (_i != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_i % 10)));
            _i /= 10;
        }
        return string(buffer);
    }

    function _padNumber(uint256 num, uint256 width) internal pure returns (string memory) {
        string memory numStr = _uint2str(num);
        bytes memory numBytes = bytes(numStr);
        if (numBytes.length >= width) return numStr;

        bytes memory padded = new bytes(width);
        uint256 padding = width - numBytes.length;
        for (uint256 i = 0; i < padding; i++) {
            padded[i] = "0";
        }
        for (uint256 i = 0; i < numBytes.length; i++) {
            padded[padding + i] = numBytes[i];
        }
        return string(padded);
    }

    function _toHexChar(uint8 _b) internal pure returns (bytes1) {
        if (_b < 10) return bytes1(_b + 48);
        return bytes1(_b + 87); // a-f
    }
}
