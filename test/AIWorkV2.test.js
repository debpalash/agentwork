const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AIWork v2 — BiddingEngine + TaskManagerV2", function () {
  let token, agentRegistry, escrowVault, complexityOracle;
  let biddingEngine, taskManagerV2;
  let deployer, treasury, validatorPool, employer, worker1, worker2, worker3;
  let mockUSDC;

  const PLATFORM_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ROLE"));

  beforeEach(async function () {
    [deployer, treasury, validatorPool, employer, worker1, worker2, worker3] =
      await ethers.getSigners();

    // Deploy base contracts
    const AIWorkToken = await ethers.getContractFactory("AIWorkToken");
    token = await AIWorkToken.deploy(treasury.address, validatorPool.address);
    await token.waitForDeployment();

    mockUSDC = await AIWorkToken.deploy(treasury.address, validatorPool.address);
    await mockUSDC.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy(await token.getAddress());
    await agentRegistry.waitForDeployment();

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(treasury.address, validatorPool.address);
    await escrowVault.waitForDeployment();
    await escrowVault.setPaymentToken(await mockUSDC.getAddress(), true);

    const ComplexityOracle = await ethers.getContractFactory("ComplexityOracle");
    complexityOracle = await ComplexityOracle.deploy();
    await complexityOracle.waitForDeployment();

    // Deploy v2 — BiddingEngine has NO constructor args
    const BiddingEngine = await ethers.getContractFactory("BiddingEngine");
    biddingEngine = await BiddingEngine.deploy();
    await biddingEngine.waitForDeployment();

    // TaskManagerV2 constructor — check actual params
    const TaskManagerV2 = await ethers.getContractFactory("TaskManagerV2");
    taskManagerV2 = await TaskManagerV2.deploy(
      await agentRegistry.getAddress(),
      await escrowVault.getAddress(),
      await complexityOracle.getAddress(),
      await biddingEngine.getAddress()
    );
    await taskManagerV2.waitForDeployment();

    // Grant roles
    await agentRegistry.grantRole(PLATFORM_ROLE, await taskManagerV2.getAddress());
    await agentRegistry.grantRole(PLATFORM_ROLE, await biddingEngine.getAddress());
    await escrowVault.grantRole(PLATFORM_ROLE, await taskManagerV2.getAddress());
    await complexityOracle.grantRole(PLATFORM_ROLE, await taskManagerV2.getAddress());
    await biddingEngine.grantRole(PLATFORM_ROLE, await taskManagerV2.getAddress());
    await biddingEngine.grantRole(PLATFORM_ROLE, deployer.address);
    await escrowVault.grantRole(PLATFORM_ROLE, deployer.address);
    await complexityOracle.grantRole(PLATFORM_ROLE, deployer.address);

    // Mint tokens
    await token.mint(deployer.address, ethers.parseEther("10000000"));
    await mockUSDC.mint(employer.address, ethers.parseEther("100000"));
    await token.mint(worker1.address, ethers.parseEther("10000"));
    await token.mint(worker2.address, ethers.parseEther("10000"));
    await token.mint(worker3.address, ethers.parseEther("10000"));

    // Register and activate agents
    for (const [wallet, category] of [
      [worker1, 2], // CODE
      [worker2, 2], // CODE
      [worker3, 0], // NLP
    ]) {
      await agentRegistry.registerAgent(
        wallet.address, wallet.address, category, ["typescript", "python"]
      );
      const id = await agentRegistry.addressToAgentId(wallet.address);
      await agentRegistry.activateAgent(id);
    }

    // Set min stake to 0 for testing ease
    await biddingEngine.setMinBidStake(0);
  });

  async function getAgentId(wallet) {
    return agentRegistry.addressToAgentId(wallet.address);
  }

  // ═══════════════════════════════════════════════════════════════
  //  BIDDING ENGINE TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("BiddingEngine", function () {
    let taskId;

    beforeEach(async function () {
      taskId = ethers.keccak256(ethers.toUtf8Bytes("bid-test-" + Date.now()));
    });

    it("should open bidding for a task", async function () {
      // openBidding(taskId, durationHours)
      await biddingEngine.openBidding(taskId, 1); // 1 hour

      const deadline = await biddingEngine.getBiddingDeadline(taskId);
      expect(deadline).to.be.gt(0);
      expect(await biddingEngine.isBiddingOpen(taskId)).to.be.true;
    });

    it("should accept bids from agents", async function () {
      await biddingEngine.openBidding(taskId, 1);

      const agentId1 = await getAgentId(worker1);

      // submitBid(taskId, agentId, bidPrice, estimatedHours, modelScore) + ETH
      await biddingEngine.connect(worker1).submitBid(
        taskId, agentId1,
        ethers.parseEther("1500"),
        24,    // ETA hours
        85,    // model score
        { value: ethers.parseEther("0.1") } // stake via msg.value
      );

      const count = await biddingEngine.getBidCount(taskId);
      expect(count).to.equal(1);

      const bid = await biddingEngine.getBid(taskId, 0);
      expect(bid.bidPrice).to.equal(ethers.parseEther("1500"));
      expect(bid.estimatedHours).to.equal(24);
      expect(bid.modelScore).to.equal(85);
    });

    it("should reject duplicate bids from same agent", async function () {
      await biddingEngine.openBidding(taskId, 1);
      const agentId1 = await getAgentId(worker1);

      await biddingEngine.connect(worker1).submitBid(
        taskId, agentId1, ethers.parseEther("1000"), 12, 50
      );

      await expect(
        biddingEngine.connect(worker1).submitBid(
          taskId, agentId1, ethers.parseEther("900"), 10, 60
        )
      ).to.be.revertedWithCustomError(biddingEngine, "AlreadyBid");
    });

    it("should support multiple competing bids", async function () {
      await biddingEngine.openBidding(taskId, 1);

      const id1 = await getAgentId(worker1);
      const id2 = await getAgentId(worker2);

      await biddingEngine.connect(worker1).submitBid(
        taskId, id1, ethers.parseEther("1500"), 18, 85,
        { value: ethers.parseEther("0.1") }
      );
      await biddingEngine.connect(worker2).submitBid(
        taskId, id2, ethers.parseEther("1200"), 24, 75,
        { value: ethers.parseEther("0.2") }
      );

      expect(await biddingEngine.getBidCount(taskId)).to.equal(2);
    });

    it("should award to highest scorer and refund losers", async function () {
      await biddingEngine.openBidding(taskId, 1);

      const id1 = await getAgentId(worker1);
      const id2 = await getAgentId(worker2);

      const stake = ethers.parseEther("0.1");
      await biddingEngine.connect(worker1).submitBid(
        taskId, id1, ethers.parseEther("1500"), 18, 85,
        { value: stake }
      );
      await biddingEngine.connect(worker2).submitBid(
        taskId, id2, ethers.parseEther("1200"), 24, 75,
        { value: stake }
      );

      // Fast-forward past bidding deadline
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      const worker2Before = await ethers.provider.getBalance(worker2.address);

      // Award: reputationScores, categoryExperience, maxBudget, maxHours
      await biddingEngine.awardTask(
        taskId,
        [5000, 5000],  // reputation scores
        [3, 2],        // category experience
        ethers.parseEther("2000"),  // maxBudget
        48             // maxHours
      );

      // One agent should be awarded
      const awarded = await biddingEngine.getAwardedAgent(taskId);
      expect(awarded.length).to.be.gt(0);

      const losingWorker = awarded === id1 ? worker2 : worker1;
      expect(await biddingEngine.withdrawableStake(losingWorker.address)).to.equal(stake);
      await biddingEngine.connect(losingWorker).withdrawStake();
      expect(await biddingEngine.withdrawableStake(losingWorker.address)).to.equal(0n);

      // Bidding should be closed
      expect(await biddingEngine.isBiddingOpen(taskId)).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  TASK MANAGER V2 TESTS
  // ═══════════════════════════════════════════════════════════════
  describe("TaskManagerV2", function () {
    it("should post a task and open bidding", async function () {
      const reward = ethers.parseEther("2000");
      const employerAgentId = "employer-agent-01";

      await mockUSDC.connect(employer).approve(await escrowVault.getAddress(), reward);

      // postTask(title, category, employerAgentId, paymentModel, paymentToken, maxBudget, bonusPool, deadlineHours, specHash, biddingHours)
      const tx = await taskManagerV2.connect(employer).postTask(
        "Build API server",
        "CODE",
        employerAgentId,
        1,   // STEP_BASED
        await mockUSDC.getAddress(),
        reward,
        0,   // no bonus
        24,  // 24 hour deadline
        ethers.keccak256(ethers.toUtf8Bytes("api-spec")),
        1    // 1 hour bidding window
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find((l) => {
        try { return taskManagerV2.interface.parseLog(l)?.name === "TaskPosted"; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const taskId = taskManagerV2.interface.parseLog(event).args.taskId;
      const task = await taskManagerV2.getTask(taskId);
      expect(task.phase).to.equal(1); // BIDDING
    });

    it("should define chunks for a task", async function () {
      const reward = ethers.parseEther("1000");
      await mockUSDC.connect(employer).approve(await escrowVault.getAddress(), reward);

      const tx = await taskManagerV2.connect(employer).postTask(
        "Chunk test", "CODE", "emp-01", 1,
        await mockUSDC.getAddress(), reward, 0, 24,
        ethers.keccak256(ethers.toUtf8Bytes("x")), 1
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((l) => {
        try { return taskManagerV2.interface.parseLog(l)?.name === "TaskPosted"; }
        catch { return false; }
      });
      const taskId = taskManagerV2.interface.parseLog(event).args.taskId;

      // Define 3 chunks (platform role)
      await taskManagerV2.defineChunks(
        taskId,
        ["Setup", "Build", "Test"],
        [3000, 4000, 3000]  // 30%, 40%, 30% = 100%
      );

      const chunks = await taskManagerV2.getTaskChunks(taskId);
      expect(chunks.length).to.equal(3);

      const task = await taskManagerV2.getTask(taskId);
      expect(task.totalChunks).to.equal(3);
    });

    it("should cancel through TaskManagerV2 and refund escrow", async function () {
      const reward = ethers.parseEther("1000");
      await mockUSDC.connect(employer).approve(await escrowVault.getAddress(), reward);

      const tx = await taskManagerV2.connect(employer).postTask(
        "Cancelled task", "CODE", "emp-01", 0,
        await mockUSDC.getAddress(), reward, 0, 24,
        ethers.keccak256(ethers.toUtf8Bytes("cancel")), 1
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((l) => {
        try { return taskManagerV2.interface.parseLog(l)?.name === "TaskPosted"; }
        catch { return false; }
      });
      const taskId = taskManagerV2.interface.parseLog(event).args.taskId;

      const before = await mockUSDC.balanceOf(employer.address);
      await taskManagerV2.connect(employer).cancelTask(taskId);
      const after = await mockUSDC.balanceOf(employer.address);
      const escrow = await escrowVault.getEscrow(taskId);
      expect(after - before).to.equal(reward - (reward * 100n) / 10000n);
      expect(escrow.isActive).to.be.false;
    });

    it("should bind the winning bid price and bidder identity", async function () {
      const reward = ethers.parseEther("2000");
      const bidPrice = ethers.parseEther("1200");
      const workerId = await getAgentId(worker1);
      await mockUSDC.connect(employer).approve(await escrowVault.getAddress(), reward);

      const tx = await taskManagerV2.connect(employer).postTask(
        "Awarded task", "CODE", "emp-01", 0,
        await mockUSDC.getAddress(), reward, 0, 24,
        ethers.keccak256(ethers.toUtf8Bytes("award")), 1
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((l) => {
        try { return taskManagerV2.interface.parseLog(l)?.name === "TaskPosted"; }
        catch { return false; }
      });
      const taskId = taskManagerV2.interface.parseLog(event).args.taskId;

      await biddingEngine.connect(worker1).submitBid(taskId, workerId, bidPrice, 12, 90);
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);
      await biddingEngine.awardTask(taskId, [7000], [5], reward, 24);
      await taskManagerV2.awardToWinner(taskId, "aiwork/task-awarded");

      const task = await taskManagerV2.getTask(taskId);
      expect(task.workerAgentId).to.equal(workerId);
      expect(task.awardedPrice).to.equal(bidPrice);
      expect(task.phase).to.equal(3n); // IN_PROGRESS
    });
  });
});
