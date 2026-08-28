const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  const [deployer] = signers;
  console.log("Deploying AIWork contracts with:", deployer.address);
  console.log(
    "Balance:",
    hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address)
    )
  );

  // ─── 1. Deploy AIWork Token ────────────────────────────────────
  const treasury = deployer.address;
  const validatorPool = deployer.address;

  const AIWorkToken = await hre.ethers.getContractFactory("AIWorkToken");
  const token = await AIWorkToken.deploy(treasury, validatorPool);
  await token.waitForDeployment();
  console.log("✅ AIWorkToken deployed to:", await token.getAddress());

  // ─── 2. Deploy Agent Registry ──────────────────────────────────
  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(await token.getAddress());
  await agentRegistry.waitForDeployment();
  console.log("✅ AgentRegistry deployed to:", await agentRegistry.getAddress());

  // ─── 3. Deploy Escrow Vault ────────────────────────────────────
  const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
  const escrowVault = await EscrowVault.deploy(treasury, validatorPool);
  await escrowVault.waitForDeployment();
  console.log("✅ EscrowVault deployed to:", await escrowVault.getAddress());
  await escrowVault.setPaymentToken(await token.getAddress(), true);
  console.log("✅ Default payment token allowlisted");

  // ─── 4. Deploy Complexity Oracle ───────────────────────────────
  const ComplexityOracle =
    await hre.ethers.getContractFactory("ComplexityOracle");
  const complexityOracle = await ComplexityOracle.deploy();
  await complexityOracle.waitForDeployment();
  console.log(
    "✅ ComplexityOracle deployed to:",
    await complexityOracle.getAddress()
  );

  // ─── 5. Deploy Task Manager ────────────────────────────────────
  const TaskManager = await hre.ethers.getContractFactory("TaskManager");
  const taskManager = await TaskManager.deploy(
    await agentRegistry.getAddress(),
    await escrowVault.getAddress(),
    await complexityOracle.getAddress()
  );
  await taskManager.waitForDeployment();
  console.log("✅ TaskManager deployed to:", await taskManager.getAddress());

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
  console.log(`✅ Verification quorum configured: ${verifierQuorum}`);

  const DisputeResolution = await hre.ethers.getContractFactory("DisputeResolution");
  const disputeResolution = await DisputeResolution.deploy(
    await token.getAddress(), await escrowVault.getAddress(), treasury
  );
  await disputeResolution.waitForDeployment();
  await disputeResolution.configureTaskManager(await taskManager.getAddress());
  await taskManager.configureDisputeResolution(await disputeResolution.getAddress());
  const ARBITRATION_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ARBITRATION_ROLE"));
  await escrowVault.grantRole(ARBITRATION_ROLE, await disputeResolution.getAddress());
  console.log("✅ DisputeResolution deployed to:", await disputeResolution.getAddress());

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
      await token.connect(arbiterSigner).approve(await disputeResolution.getAddress(), stake);
      await disputeResolution.connect(arbiterSigner).stakeAsArbiter(stake);
    }
  }
  console.log(`✅ Bonded arbiter pool configured: ${arbiterAddresses.length}`);

  // ─── 6. Grant Roles ────────────────────────────────────────────
  const PLATFORM_ROLE = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes("PLATFORM_ROLE")
  );

  await agentRegistry.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
  await escrowVault.grantRole(PLATFORM_ROLE, await taskManager.getAddress());
  await complexityOracle.grantRole(
    PLATFORM_ROLE,
    await taskManager.getAddress()
  );
  console.log("✅ Roles granted to TaskManager");

  // ─── 6. Deploy Bidding Engine ──────────────────────────────────
  const BiddingEngine = await hre.ethers.getContractFactory("BiddingEngine");
  const biddingEngine = await BiddingEngine.deploy();
  await biddingEngine.waitForDeployment();
  console.log("✅ BiddingEngine deployed to:", await biddingEngine.getAddress());

  // Grant BiddingEngine the platform role and grant deployer on BiddingEngine
  await biddingEngine.grantRole(PLATFORM_ROLE, deployer.address);
  console.log("✅ Roles granted to BiddingEngine");

  // Mint initial token supply
  const initialMint = hre.ethers.parseEther("100000000"); // 100M tokens
  await token.mint(deployer.address, initialMint);
  console.log("✅ Minted 100M AIWK to deployer");

  // ─── Summary ───────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  AIWork Platform — Deployed Successfully");
  console.log("═══════════════════════════════════════════════");
  console.log("  Token:      ", await token.getAddress());
  console.log("  Agents:     ", await agentRegistry.getAddress());
  console.log("  Escrow:     ", await escrowVault.getAddress());
  console.log("  Complexity: ", await complexityOracle.getAddress());
  console.log("  Tasks:      ", await taskManager.getAddress());
  console.log("  Bidding:    ", await biddingEngine.getAddress());
  console.log("  Disputes:   ", await disputeResolution.getAddress());
  console.log("  Arbiters:   ", arbiterAddresses.join(","));
  console.log("═══════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
