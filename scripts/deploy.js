const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
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
  console.log("═══════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

