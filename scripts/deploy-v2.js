const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  const [deployer] = signers;
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║    AIWork v2 — Full Contract Deployment            ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  const treasury = deployer.address;
  const validatorPool = deployer.address;

  // ─── 1. AIWork Token ──────────────────────────────────────────
  const AIWorkToken = await hre.ethers.getContractFactory("AIWorkToken");
  const token = await AIWorkToken.deploy(treasury, validatorPool);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ AIWorkToken:       ", tokenAddr);

  // ─── 2. Agent Registry ────────────────────────────────────────
  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(tokenAddr);
  await agentRegistry.waitForDeployment();
  const registryAddr = await agentRegistry.getAddress();
  console.log("✅ AgentRegistry:     ", registryAddr);

  // ─── 3. Escrow Vault ──────────────────────────────────────────
  const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
  const escrowVault = await EscrowVault.deploy(treasury, validatorPool);
  await escrowVault.waitForDeployment();
  const escrowAddr = await escrowVault.getAddress();
  console.log("✅ EscrowVault:       ", escrowAddr);

  // ─── 4. Complexity Oracle ─────────────────────────────────────
  const ComplexityOracle = await hre.ethers.getContractFactory("ComplexityOracle");
  const oracle = await ComplexityOracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("✅ ComplexityOracle:  ", oracleAddr);

  // ─── 5. TaskManager v1 (legacy, for existing references) ─────
  const TaskManager = await hre.ethers.getContractFactory("TaskManager");
  const taskManager = await TaskManager.deploy(registryAddr, escrowAddr, oracleAddr);
  await taskManager.waitForDeployment();
  const tmAddr = await taskManager.getAddress();
  console.log("✅ TaskManager (v1):  ", tmAddr);

  const localNetwork = ["hardhat", "localhost"].includes(hre.network.name);
  const verifierQuorum = Number(process.env.VERIFIER_QUORUM || (localNetwork ? "1" : "3"));
  await taskManager.setVerificationQuorum(verifierQuorum);
  const VERIFIER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("VERIFIER_ROLE"));
  const verifierAddresses = (process.env.VERIFIER_ADDRESSES || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!localNetwork && new Set([deployer.address, ...verifierAddresses].map((value) => value.toLowerCase())).size < verifierQuorum) {
    throw new Error(`VERIFIER_ADDRESSES must provide at least ${verifierQuorum - 1} independent verifier wallets`);
  }
  for (const verifier of verifierAddresses) await taskManager.grantRole(VERIFIER_ROLE, verifier);
  console.log(`✅ Verification quorum: ${verifierQuorum}`);

  const DisputeResolution = await hre.ethers.getContractFactory("DisputeResolution");
  const disputeResolution = await DisputeResolution.deploy(tokenAddr, escrowAddr, treasury);
  await disputeResolution.waitForDeployment();
  const disputeAddr = await disputeResolution.getAddress();
  await disputeResolution.configureTaskManager(tmAddr);
  await taskManager.configureDisputeResolution(disputeAddr);
  const ARBITRATION_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ARBITRATION_ROLE"));
  await escrowVault.grantRole(ARBITRATION_ROLE, disputeAddr);
  console.log("✅ DisputeResolution:  ", disputeAddr);

  const ARBITER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ARBITER_ROLE"));
  let arbiterAddresses = (process.env.ARBITER_ADDRESSES || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (localNetwork && arbiterAddresses.length === 0) {
    arbiterAddresses = signers.slice(4, 7).map((signer) => signer.address);
  }
  if (!localNetwork && new Set(arbiterAddresses.map((value) => value.toLowerCase())).size < 3) {
    throw new Error("ARBITER_ADDRESSES must provide at least three distinct independent wallets");
  }
  for (const arbiterAddress of arbiterAddresses) {
    await disputeResolution.grantRole(ARBITER_ROLE, arbiterAddress);
    if (localNetwork) {
      const arbiterSigner = signers.find((signer) => signer.address.toLowerCase() === arbiterAddress.toLowerCase());
      if (!arbiterSigner) throw new Error(`No local signer for arbiter ${arbiterAddress}`);
      const stake = hre.ethers.parseEther("500");
      await token.mint(arbiterAddress, stake);
      await token.connect(arbiterSigner).approve(disputeAddr, stake);
      await disputeResolution.connect(arbiterSigner).stakeAsArbiter(stake);
    }
  }
  console.log(`✅ Bonded arbiter pool: ${arbiterAddresses.length}`);

  // ─── 6. BiddingEngine (NEW in v2) ─────────────────────────────
  const BiddingEngine = await hre.ethers.getContractFactory("BiddingEngine");
  const biddingEngine = await BiddingEngine.deploy();
  await biddingEngine.waitForDeployment();
  const bidAddr = await biddingEngine.getAddress();
  console.log("✅ BiddingEngine:     ", bidAddr);

  // ─── 7. TaskManagerV2 (NEW in v2) ─────────────────────────────
  const TaskManagerV2 = await hre.ethers.getContractFactory("TaskManagerV2");
  const taskManagerV2 = await TaskManagerV2.deploy(
    registryAddr,
    escrowAddr,
    oracleAddr,
    bidAddr
  );
  await taskManagerV2.waitForDeployment();
  const tmV2Addr = await taskManagerV2.getAddress();
  console.log("✅ TaskManagerV2:     ", tmV2Addr);

  // ─── 8. Grant Roles ───────────────────────────────────────────
  console.log("\n  Configuring roles...");
  const PLATFORM_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("PLATFORM_ROLE"));

  // TaskManager v1 roles
  await agentRegistry.grantRole(PLATFORM_ROLE, tmAddr);
  await escrowVault.grantRole(PLATFORM_ROLE, tmAddr);
  await oracle.grantRole(PLATFORM_ROLE, tmAddr);

  // TaskManagerV2 roles
  await agentRegistry.grantRole(PLATFORM_ROLE, tmV2Addr);
  await escrowVault.grantRole(PLATFORM_ROLE, tmV2Addr);
  await oracle.grantRole(PLATFORM_ROLE, tmV2Addr);

  // BiddingEngine roles
  await agentRegistry.grantRole(PLATFORM_ROLE, bidAddr);
  await biddingEngine.grantRole(PLATFORM_ROLE, tmV2Addr);

  console.log("  ✅ PLATFORM_ROLE granted to TaskManager, TaskManagerV2, BiddingEngine");

  // ─── 9. Mint Initial Tokens ───────────────────────────────────
  const mintAmount = hre.ethers.parseEther("100000000"); // 100M AIWK
  await token.mint(deployer.address, mintAmount);
  console.log("  ✅ Minted 100M AIWK tokens\n");

  // ─── Summary ──────────────────────────────────────────────────
  const contracts = {
    AIWorkToken: tokenAddr,
    AgentRegistry: registryAddr,
    EscrowVault: escrowAddr,
    ComplexityOracle: oracleAddr,
    "TaskManager (v1)": tmAddr,
    BiddingEngine: bidAddr,
    "TaskManagerV2": tmV2Addr,
    DisputeResolution: disputeAddr,
  };

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║         AIWork v2 — Deployment Complete           ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  for (const [name, addr] of Object.entries(contracts)) {
    console.log(`║  ${name.padEnd(20)} ${addr}  ║`);
  }
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // Write addresses to .env-friendly format
  console.log("# Add these to your .env file:");
  console.log(`TOKEN_ADDRESS=${tokenAddr}`);
  console.log(`AGENT_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`ESCROW_VAULT_ADDRESS=${escrowAddr}`);
  console.log(`COMPLEXITY_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`TASK_MANAGER_ADDRESS=${tmAddr}`);
  console.log(`BIDDING_ENGINE_ADDRESS=${bidAddr}`);
  console.log(`TASK_MANAGER_V2_ADDRESS=${tmV2Addr}`);
  console.log(`DISPUTE_RESOLUTION_ADDRESS=${disputeAddr}`);
  console.log(`ARBITER_ADDRESSES=${arbiterAddresses.join(",")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
