const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AIWork Governance and Settlement", function () {
  let token, registry, escrow, oracle, taskManager, disputes;
  let deployer, treasury, validatorPool, poster, worker, arbiter1, arbiter2, arbiter3;
  let agentId;

  const PLATFORM_ROLE = ethers.id("PLATFORM_ROLE");
  const ARBITRATION_ROLE = ethers.id("ARBITRATION_ROLE");
  const ARBITER_ROLE = ethers.id("ARBITER_ROLE");

  beforeEach(async function () {
    [deployer, treasury, validatorPool, poster, worker, arbiter1, arbiter2, arbiter3] =
      await ethers.getSigners();
    const Token = await ethers.getContractFactory("AIWorkToken");
    token = await Token.deploy(treasury.address, validatorPool.address);
    const Registry = await ethers.getContractFactory("AgentRegistry");
    registry = await Registry.deploy(await token.getAddress());
    const Escrow = await ethers.getContractFactory("EscrowVault");
    escrow = await Escrow.deploy(treasury.address, validatorPool.address);
    await escrow.setPaymentToken(await token.getAddress(), true);
    const Oracle = await ethers.getContractFactory("ComplexityOracle");
    oracle = await Oracle.deploy();
    const TaskManager = await ethers.getContractFactory("TaskManager");
    taskManager = await TaskManager.deploy(
      await registry.getAddress(), await escrow.getAddress(), await oracle.getAddress()
    );
    const Disputes = await ethers.getContractFactory("DisputeResolution");
    disputes = await Disputes.deploy(await token.getAddress(), await escrow.getAddress(), treasury.address);

    await registry.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
    await escrow.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
    await oracle.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
    await escrow.grantRole(ARBITRATION_ROLE, await disputes.getAddress());
    await disputes.configureTaskManager(await taskManager.getAddress());
    await taskManager.configureDisputeResolution(await disputes.getAddress());

    await registry.registerAgent(worker.address, worker.address, 2, ["verification"]);
    agentId = await registry.addressToAgentId(worker.address);
    await registry.activateAgent(agentId);

    const arbiterStake = ethers.parseEther("500");
    for (const arbiter of [arbiter1, arbiter2, arbiter3]) {
      await disputes.grantRole(ARBITER_ROLE, arbiter.address);
      await token.mint(arbiter.address, arbiterStake);
      await token.connect(arbiter).approve(await disputes.getAddress(), arbiterStake);
      await disputes.connect(arbiter).stakeAsArbiter(arbiterStake);
    }
  });

  it("atomically enforces a bonded majority award against escrow", async function () {
    const reward = ethers.parseEther("1000");
    const bond = ethers.parseEther("50");
    await token.mint(poster.address, reward + bond);
    await token.connect(poster).approve(await escrow.getAddress(), reward);
    await token.connect(poster).approve(await disputes.getAddress(), bond);

    const latest = await ethers.provider.getBlock("latest");
    const posted = await taskManager.connect(poster).postTask(
      "Disputable verified task", "CODE", 0, await token.getAddress(), reward, 0, 5,
      latest.timestamp + 86400, ethers.id("requirements"), [], []
    );
    const receipt = await posted.wait();
    const event = receipt.logs.find((log) => {
      try { return taskManager.interface.parseLog(log)?.name === "TaskPosted"; }
      catch { return false; }
    });
    const taskId = taskManager.interface.parseLog(event).args.taskId;
    const factors = {
      technicalDepth: 5, domainSpecificity: 5, outputVolume: 5,
      multiStepReasoning: 5, creativityRequired: 5, verifiability: 5,
      timeConstraint: 5,
    };
    await oracle.createAssessment(taskId, 5, factors);
    await oracle.quickFinalize(taskId);
    await taskManager.assignTask(taskId, agentId);
    await taskManager.connect(worker).submitCompletion(taskId, ethers.id("deliverable"));

    await expect(
      escrow.settleDispute(taskId, agentId, worker.address, 10000)
    ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");

    await taskManager.connect(poster).openDispute(taskId, ethers.id("reason document"));
    expect((await taskManager.getTask(taskId)).status).to.equal(6n); // DISPUTED
    await expect(
      disputes.assignPanel(0, [arbiter1.address, arbiter2.address, poster.address])
    ).to.be.revertedWithCustomError(disputes, "InvalidPanel");
    await disputes.assignPanel(0, [arbiter1.address, arbiter2.address, arbiter3.address]);
    await expect(
      disputes.connect(arbiter1).unstakeAsArbiter(ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(disputes, "ActiveAssignmentsExist");

    const workerBefore = await token.balanceOf(worker.address);
    await disputes.connect(arbiter1).vote(0, 1); // FAVOR_WORKER
    await expect(disputes.connect(arbiter1).vote(0, 1))
      .to.be.revertedWithCustomError(disputes, "AlreadyVoted");
    await disputes.connect(arbiter2).vote(0, 1);

    const dispute = await disputes.disputes(0);
    expect(dispute.status).to.equal(2n); // RESOLVED
    expect(dispute.resolution).to.equal(1n); // FAVOR_WORKER
    expect((await taskManager.getTask(taskId)).status).to.equal(4n); // COMPLETED
    expect((await escrow.getEscrow(taskId)).isActive).to.be.false;
    expect(await token.balanceOf(worker.address)).to.be.gt(workerBefore);
    expect(await escrow.totalLockedByPoster(poster.address)).to.equal(0n);
    expect(await disputes.activeAssignments(arbiter1.address)).to.equal(0n);
    await expect(disputes.connect(arbiter3).vote(0, 2)).to.be.revertedWith("not voting");
  });
});
