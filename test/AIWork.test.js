const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AIWork Platform", function () {
  let token, agentRegistry, escrowVault, complexityOracle, taskManager;
  let deployer, treasury, validatorPool, poster, agentWallet, agentWallet2;
  let mockUSDC;

  const PLATFORM_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ROLE"));
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));

  beforeEach(async function () {
    [deployer, treasury, validatorPool, poster, agentWallet, agentWallet2] =
      await ethers.getSigners();

    // Deploy mock USDC (stablecoin for payments)
    const MockERC20 = await ethers.getContractFactory("AIWorkToken");
    mockUSDC = await MockERC20.deploy(treasury.address, validatorPool.address);
    await mockUSDC.waitForDeployment();

    // Deploy AIWork Token
    const AIWorkToken = await ethers.getContractFactory("AIWorkToken");
    token = await AIWorkToken.deploy(treasury.address, validatorPool.address);
    await token.waitForDeployment();

    // Deploy Agent Registry
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy(await token.getAddress());
    await agentRegistry.waitForDeployment();

    // Deploy Escrow Vault
    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(
      treasury.address,
      validatorPool.address
    );
    await escrowVault.waitForDeployment();

    // Deploy Complexity Oracle
    const ComplexityOracle =
      await ethers.getContractFactory("ComplexityOracle");
    complexityOracle = await ComplexityOracle.deploy();
    await complexityOracle.waitForDeployment();

    // Deploy Task Manager
    const TaskManager = await ethers.getContractFactory("TaskManager");
    taskManager = await TaskManager.deploy(
      await agentRegistry.getAddress(),
      await escrowVault.getAddress(),
      await complexityOracle.getAddress()
    );
    await taskManager.waitForDeployment();

    // Grant roles
    await agentRegistry.grantRole(
      PLATFORM_ROLE,
      await taskManager.getAddress()
    );
    await escrowVault.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
    await complexityOracle.grantRole(
      PLATFORM_ROLE,
      await taskManager.getAddress()
    );

    // Also grant deployer platform roles for direct testing
    await escrowVault.grantRole(PLATFORM_ROLE, deployer.address);
    await complexityOracle.grantRole(PLATFORM_ROLE, deployer.address);

    // Mint AIWK tokens for testing
    await token.mint(deployer.address, ethers.parseEther("1000000"));

    // Mint mock USDC and distribute
    await mockUSDC.mint(poster.address, ethers.parseEther("100000"));
    await mockUSDC.mint(treasury.address, ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════
  //  TOKEN TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("AIWorkToken", function () {
    it("should have correct name and symbol", async function () {
      expect(await token.name()).to.equal("AIWork Token");
      expect(await token.symbol()).to.equal("AIWK");
    });

    it("should mint tokens up to max supply", async function () {
      const balance = await token.balanceOf(deployer.address);
      expect(balance).to.equal(ethers.parseEther("1000000"));
    });

    it("should reject minting beyond max supply", async function () {
      await expect(
        token.mint(deployer.address, ethers.parseEther("999999999999"))
      ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
    });

    it("should distribute fees correctly", async function () {
      // Give deployer platform role and tokens
      const amount = ethers.parseEther("10000");
      const treasuryBefore = await token.balanceOf(treasury.address);

      await token.distributeFees(amount);

      const treasuryAfter = await token.balanceOf(treasury.address);
      const expectedPlatformFee = (amount * 250n) / 10000n; // 2.5%
      expect(treasuryAfter - treasuryBefore).to.equal(expectedPlatformFee);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  AGENT REGISTRY TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("AgentRegistry", function () {
    it("should register a new agent", async function () {
      const tx = await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0, // NLP category
        ["summarization", "translation"]
      );
      await tx.wait();

      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );
      expect(agentId).to.include("AIWK-");
      expect(agentId).to.include("-NLP-");

      const agent = await agentRegistry.getAgent(agentId);
      expect(agent.walletAddress).to.equal(agentWallet.address);
      expect(agent.reputationScore).to.equal(5000n); // 50% start
      expect(agent.status).to.equal(0); // PENDING
    });

    it("should reject duplicate registration", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0,
        ["skill1"]
      );

      await expect(
        agentRegistry.registerAgent(
          agentWallet.address,
          agentWallet.address,
          0,
          ["skill2"]
        )
      ).to.be.revertedWithCustomError(agentRegistry, "AddressAlreadyRegistered");
    });

    it("should activate agent and verify", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        2, // CODE
        ["python", "javascript"]
      );
      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );

      await agentRegistry.activateAgent(agentId);
      const agent = await agentRegistry.getAgent(agentId);
      expect(agent.status).to.equal(1); // ACTIVE
      expect(agent.isVerified).to.be.true;
    });

    it("should update reputation on success", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0,
        ["skill1"]
      );
      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );

      // Simulate successful task completion (complexity 5, quality 80)
      await agentRegistry.updateReputation(agentId, true, false, 5, 80);

      const agent = await agentRegistry.getAgent(agentId);
      // Base: 5000 + 50 + (5*10) + (80-50) = 5000 + 50 + 50 + 30 = 5130
      expect(agent.reputationScore).to.equal(5130n);
      expect(agent.tasksCompleted).to.equal(1n);
      expect(agent.currentStreak).to.equal(1n);
    });

    it("should decrease reputation on failure", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0,
        ["skill1"]
      );
      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );

      // Failure on complexity 3, quality 0
      await agentRegistry.updateReputation(agentId, false, false, 3, 0);

      const agent = await agentRegistry.getAgent(agentId);
      // 5000 + (-80 + 3*5) + (0-50) = 5000 - 65 - 50 = 4885
      expect(agent.reputationScore).to.equal(4885n);
      expect(agent.tasksFailed).to.equal(1n);
      expect(agent.currentStreak).to.equal(0n);
    });

    it("should handle staking", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0,
        ["skill1"]
      );
      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );

      // Transfer tokens to agent for staking
      const stakeAmount = ethers.parseEther("500");
      await token.transfer(agentWallet.address, stakeAmount);
      await token
        .connect(agentWallet)
        .approve(await agentRegistry.getAddress(), stakeAmount);

      await agentRegistry.connect(agentWallet).stake(agentId, stakeAmount);

      const agent = await agentRegistry.getAgent(agentId);
      expect(agent.stakedAmount).to.equal(stakeAmount);
    });

    it("should check reputation meets complexity requirement", async function () {
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        0,
        ["skill1"]
      );
      const agentId = await agentRegistry.addressToAgentId(
        agentWallet.address
      );

      // Default rep is 5000, complexity 1-5 needs 2000
      expect(await agentRegistry.meetsReputation(agentId, 3)).to.be.true;
      // Complexity 14+ needs 8000
      expect(await agentRegistry.meetsReputation(agentId, 14)).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  COMPLEXITY ORACLE TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("ComplexityOracle", function () {
    it("should compute complexity from factors", async function () {
      const factors = {
        technicalDepth: 10,
        domainSpecificity: 8,
        outputVolume: 5,
        multiStepReasoning: 12,
        creativityRequired: 6,
        verifiability: 4,
        timeConstraint: 5,
      };

      const score = await complexityOracle.computeComplexity(factors);
      // (10*25 + 8*20 + 12*20 + 6*15 + 5*10 + 4*10) / 100
      // = (250 + 160 + 240 + 90 + 50 + 40) / 100 = 830/100 = 8
      expect(score).to.equal(8n);
    });

    it("should apply urgency multiplier", async function () {
      const factors = {
        technicalDepth: 10,
        domainSpecificity: 8,
        outputVolume: 5,
        multiStepReasoning: 12,
        creativityRequired: 6,
        verifiability: 4,
        timeConstraint: 14, // Extreme urgency
      };

      const score = await complexityOracle.computeComplexity(factors);
      // Base 8 * 1.3 = 10.4 → 10
      expect(score).to.equal(10n);
    });

    it("should create and quick-finalize assessment", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("test-task-1"));
      const factors = {
        technicalDepth: 5,
        domainSpecificity: 5,
        outputVolume: 5,
        multiStepReasoning: 5,
        creativityRequired: 5,
        verifiability: 5,
        timeConstraint: 5,
      };

      await complexityOracle.createAssessment(taskId, 3, factors);
      await complexityOracle.quickFinalize(taskId);

      const assessment = await complexityOracle.getAssessment(taskId);
      expect(assessment.isFinalized).to.be.true;
      expect(assessment.finalScore).to.be.gt(0n);
    });

    it("should bump complexity after failures", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("test-task-2"));
      const factors = {
        technicalDepth: 5,
        domainSpecificity: 5,
        outputVolume: 5,
        multiStepReasoning: 5,
        creativityRequired: 5,
        verifiability: 5,
        timeConstraint: 5,
      };

      await complexityOracle.createAssessment(taskId, 5, factors);
      await complexityOracle.quickFinalize(taskId);

      const before = await complexityOracle.getAssessment(taskId);
      const oldLevel = before.finalScore;

      await complexityOracle.bumpComplexity(taskId, 6); // 6 failures → +2
      const after = await complexityOracle.getAssessment(taskId);

      expect(after.finalScore).to.be.gt(oldLevel);
      expect(after.failureAdjustment).to.equal(2n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  ESCROW VAULT TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("EscrowVault", function () {
    it("should lock funds on task creation", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("escrow-task-1"));
      const amount = ethers.parseEther("1000");

      await mockUSDC
        .connect(poster)
        .approve(await escrowVault.getAddress(), amount);
      await escrowVault.lockFunds(
        taskId,
        poster.address,
        await mockUSDC.getAddress(),
        amount
      );

      const escrow = await escrowVault.getEscrow(taskId);
      expect(escrow.totalLocked).to.equal(amount);
      expect(escrow.remaining).to.equal(amount);
      expect(escrow.isActive).to.be.true;
    });

    it("should refund poster with cancellation fee", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("escrow-task-2"));
      const amount = ethers.parseEther("1000");

      await mockUSDC
        .connect(poster)
        .approve(await escrowVault.getAddress(), amount);
      await escrowVault.lockFunds(
        taskId,
        poster.address,
        await mockUSDC.getAddress(),
        amount
      );

      const posterBefore = await mockUSDC.balanceOf(poster.address);
      await escrowVault.refundPoster(taskId);
      const posterAfter = await mockUSDC.balanceOf(poster.address);

      // Should get back 99% (1% cancel fee)
      const expectedRefund = amount - (amount * 100n) / 10000n;
      expect(posterAfter - posterBefore).to.equal(expectedRefund);
    });

    it("cancelAndRefund should refund (regression: no self-call role failure)", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("escrow-task-cancel"));
      const amount = ethers.parseEther("1000");

      await mockUSDC
        .connect(poster)
        .approve(await escrowVault.getAddress(), amount);
      await escrowVault.lockFunds(
        taskId,
        poster.address,
        await mockUSDC.getAddress(),
        amount
      );

      const posterBefore = await mockUSDC.balanceOf(poster.address);
      // Previously cancelAndRefund did `this.refundPoster()`, making msg.sender
      // the vault (which lacks PLATFORM_ROLE) → it always reverted and stranded
      // the escrow. This must succeed and refund the poster (minus cancel fee).
      await escrowVault.cancelAndRefund(taskId);
      const posterAfter = await mockUSDC.balanceOf(poster.address);

      const expectedRefund = amount - (amount * 100n) / 10000n;
      expect(posterAfter - posterBefore).to.equal(expectedRefund);

      const escrow = await escrowVault.getEscrow(taskId);
      expect(escrow.isActive).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  FULL INTEGRATION TEST
  // ═══════════════════════════════════════════════════════════════
  describe("Full Task Lifecycle", function () {
    let agentId;

    beforeEach(async function () {
      // Register and activate an agent
      await agentRegistry.registerAgent(
        agentWallet.address,
        agentWallet.address,
        2, // CODE
        ["javascript", "python"]
      );
      agentId = await agentRegistry.addressToAgentId(agentWallet.address);
      await agentRegistry.activateAgent(agentId);
    });

    it("should complete a full-completion task end-to-end", async function () {
      const reward = ethers.parseEther("500");

      // Poster approves USDC
      await mockUSDC
        .connect(poster)
        .approve(await escrowVault.getAddress(), reward);

      // Post task
      const tx = await taskManager.connect(poster).postTask(
        "Summarize this document",
        "NLP",
        0, // FULL_COMPLETION
        await mockUSDC.getAddress(),
        reward,
        0, // no bonus
        5, // complexity claim
        Math.floor(Date.now() / 1000) + 86400, // 24h deadline
        ethers.keccak256(ethers.toUtf8Bytes("requirements")),
        [], // no steps
        [] // no step percentages
      );
      const receipt = await tx.wait();

      // Get taskId from event
      const event = receipt.logs.find((l) => {
        try {
          return taskManager.interface.parseLog(l)?.name === "TaskPosted";
        } catch {
          return false;
        }
      });
      const taskId = taskManager.interface.parseLog(event).args.taskId;

      // Assign agent
      await taskManager.assignTask(taskId, agentId);

      // Agent submits completion
      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("my-output"));
      await taskManager
        .connect(agentWallet)
        .submitCompletion(taskId, deliverable);

      // Record agent balance before
      const agentBefore = await mockUSDC.balanceOf(agentWallet.address);

      // Create complexity assessment for the task
      const factors = {
        technicalDepth: 5,
        domainSpecificity: 3,
        outputVolume: 4,
        multiStepReasoning: 5,
        creativityRequired: 3,
        verifiability: 7,
        timeConstraint: 3,
      };
      await complexityOracle.createAssessment(taskId, 5, factors);
      await complexityOracle.quickFinalize(taskId);

      // Poster verifies with quality score 85
      await taskManager.connect(poster).verifyCompletion(taskId, true, 85);

      // Check agent got paid
      const agentAfter = await mockUSDC.balanceOf(agentWallet.address);
      expect(agentAfter).to.be.gt(agentBefore);

      // Check task is completed
      const task = await taskManager.getTask(taskId);
      expect(task.status).to.equal(4n); // COMPLETED
      expect(task.posterVerified).to.be.true;
    });

    it("should handle step-based task with milestone payments", async function () {
      const reward = ethers.parseEther("1000");

      await mockUSDC
        .connect(poster)
        .approve(await escrowVault.getAddress(), reward);

      // Post step-based task with 3 milestones
      const tx = await taskManager.connect(poster).postTask(
        "Build a website",
        "CODE",
        1, // STEP_BASED
        await mockUSDC.getAddress(),
        reward,
        0,
        7,
        Math.floor(Date.now() / 1000) + 604800, // 1 week
        ethers.keccak256(ethers.toUtf8Bytes("website-reqs")),
        ["Wireframe", "Frontend", "Backend"],
        [2000, 4000, 4000] // 20%, 40%, 40%
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((l) => {
        try {
          return taskManager.interface.parseLog(l)?.name === "TaskPosted";
        } catch {
          return false;
        }
      });
      const taskId = taskManager.interface.parseLog(event).args.taskId;

      // Set up complexity assessment
      const factors = {
        technicalDepth: 7,
        domainSpecificity: 5,
        outputVolume: 8,
        multiStepReasoning: 6,
        creativityRequired: 7,
        verifiability: 6,
        timeConstraint: 4,
      };
      await complexityOracle.createAssessment(taskId, 7, factors);
      await complexityOracle.quickFinalize(taskId);

      // Assign agent
      await taskManager.assignTask(taskId, agentId);

      // Complete step 1
      await taskManager
        .connect(agentWallet)
        .submitStep(taskId, 0, ethers.keccak256(ethers.toUtf8Bytes("step1")));

      const balanceAfterStep0Before = await mockUSDC.balanceOf(
        agentWallet.address
      );
      await taskManager.connect(poster).verifyStep(taskId, 0, true, 75);
      const balanceAfterStep0 = await mockUSDC.balanceOf(agentWallet.address);
      expect(balanceAfterStep0).to.be.gt(balanceAfterStep0Before);

      // Complete step 2
      await taskManager
        .connect(agentWallet)
        .submitStep(taskId, 1, ethers.keccak256(ethers.toUtf8Bytes("step2")));
      await taskManager.connect(poster).verifyStep(taskId, 1, true, 80);

      // Complete step 3
      await taskManager
        .connect(agentWallet)
        .submitStep(taskId, 2, ethers.keccak256(ethers.toUtf8Bytes("step3")));
      await taskManager.connect(poster).verifyStep(taskId, 2, true, 90);

      // Task should be completed
      const task = await taskManager.getTask(taskId);
      expect(task.status).to.equal(4n); // COMPLETED

      // Agent reputation should have increased 3 times
      const agent = await agentRegistry.getAgent(agentId);
      expect(agent.tasksCompleted).to.equal(3n);
      expect(agent.currentStreak).to.equal(3n);
    });
  });
});
