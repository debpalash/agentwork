const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║      AIWork v2 — Seeding Demo Data                ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // ─── Contract Addresses ───────────────────────────────────────
  const TOKEN_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const REGISTRY_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const ESCROW_ADDR = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  const ORACLE_ADDR = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
  const TM_ADDR = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  const BID_ADDR = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

  // ─── Attach Contracts ─────────────────────────────────────────
  const token = await hre.ethers.getContractAt("AIWorkToken", TOKEN_ADDR);
  const registry = await hre.ethers.getContractAt("AgentRegistry", REGISTRY_ADDR);
  const taskManager = await hre.ethers.getContractAt("TaskManager", TM_ADDR);
  const escrow = await hre.ethers.getContractAt("EscrowVault", ESCROW_ADDR);

  // ═══════════════════════════════════════════════════════════════
  // 1. REGISTER 5 DEMO AGENTS
  // ═══════════════════════════════════════════════════════════════
  const agents = [
    { signer: signers[1], category: 2, skills: ["solidity", "rust", "smart-contracts"] },        // CODE
    { signer: signers[2], category: 0, skills: ["translation", "summarization", "sentiment"] },  // NLP
    { signer: signers[3], category: 3, skills: ["pandas", "sql", "visualization"] },              // DATA
    { signer: signers[4], category: 5, skills: ["planning", "logic", "analysis"] },               // REASONING
    { signer: signers[5], category: 4, skills: ["copywriting", "design", "branding"] },           // CREATIVE
  ];

  console.log("📦 Registering agents...");
  for (const a of agents) {
    try {
      const tx = await registry.registerAgent(
        a.signer.address,
        a.signer.address,
        a.category,
        a.skills
      );
      const receipt = await tx.wait();
      // Find the AgentRegistered event to get the agentId
      const event = receipt.logs.find(l => {
        try { return registry.interface.parseLog(l)?.name === "AgentRegistered"; }
        catch { return false; }
      });
      const parsed = event ? registry.interface.parseLog(event) : null;
      const agentId = parsed ? parsed.args[0] : "unknown";
      console.log(`  ✅ Agent ${agentId} → ${a.signer.address}`);

      // Activate agent
      await registry.activateAgent(agentId);
    } catch (err) {
      console.log(`  ⚠️  Agent for ${a.signer.address}: ${err.message?.slice(0, 80)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. FUND ACCOUNTS WITH AIWK TOKENS (for posting tasks)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n💰 Distributing AIWK tokens...");
  const fundAmount = hre.ethers.parseEther("100000"); // 100k AIWK each
  for (let i = 1; i <= 9; i++) {
    await token.transfer(signers[i].address, fundAmount);
  }
  console.log("  ✅ Sent 100k AIWK to accounts 1-9");

  // ═══════════════════════════════════════════════════════════════
  // 3. POST 6 DEMO TASKS
  // ═══════════════════════════════════════════════════════════════
  const tasks = [
    {
      title: "Smart Contract Security Audit",
      category: "CODE",
      complexity: 8,
      reward: "500",
      poster: signers[6],
      steps: ["Review contract code", "Run static analysis", "Write audit report"],
      stepPcts: [3000, 4000, 3000],
    },
    {
      title: "Translate Product Docs to Spanish",
      category: "NLP",
      complexity: 3,
      reward: "150",
      poster: signers[7],
      steps: ["Translate main docs", "Review terminology"],
      stepPcts: [7000, 3000],
    },
    {
      title: "Build Analytics Dashboard from CSV Data",
      category: "DATA",
      complexity: 6,
      reward: "350",
      poster: signers[8],
      steps: ["Parse and clean data", "Create visualizations", "Deploy dashboard"],
      stepPcts: [2500, 5000, 2500],
    },
    {
      title: "Design Token Economics Model",
      category: "REASONING",
      complexity: 10,
      reward: "1000",
      poster: signers[9],
      steps: ["Research comparable models", "Design emission schedule", "Simulate scenarios", "Write whitepaper section"],
      stepPcts: [2000, 3000, 3000, 2000],
    },
    {
      title: "Create Brand Identity Package",
      category: "CREATIVE",
      complexity: 5,
      reward: "250",
      poster: signers[6],
      steps: ["Logo concepts", "Color palette", "Brand guidelines doc"],
      stepPcts: [4000, 2000, 4000],
    },
    {
      title: "Implement ERC-4337 Account Abstraction",
      category: "CODE",
      complexity: 13,
      reward: "2000",
      poster: signers[7],
      steps: ["Design architecture", "Implement bundler", "Write paymaster", "Integration tests"],
      stepPcts: [2000, 3000, 3000, 2000],
    },
  ];

  console.log("\n📝 Posting tasks...");
  for (const t of tasks) {
    try {
      // Approve EscrowVault (not TaskManager) to spend poster's tokens  
      const rewardWei = hre.ethers.parseEther(t.reward);
      const bonusWei = hre.ethers.parseEther("0");
      const totalWei = rewardWei + bonusWei;

      // EscrowVault does transferFrom(poster, this, amount), so poster approves EscrowVault
      await token.connect(t.poster).approve(ESCROW_ADDR, totalWei);

      const requirementsHash = hre.ethers.keccak256(
        hre.ethers.toUtf8Bytes(t.title + " requirements")
      );

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days

      // postTask(title, category, paymentModel, paymentToken, baseReward, bonusPool, complexityClaim, deadline, requirementsHash, stepDescriptions, stepPercentages)
      const tx = await taskManager.connect(t.poster).postTask(
        t.title,
        t.category,
        1, // STEP_BASED payment model
        TOKEN_ADDR,  // paymentToken = AIWK token
        rewardWei,
        bonusWei,
        t.complexity,
        deadline,
        requirementsHash,
        t.steps,
        t.stepPcts
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return taskManager.interface.parseLog(l)?.name === "TaskPosted"; }
        catch { return false; }
      });
      const parsed = event ? taskManager.interface.parseLog(event) : null;
      const taskId = parsed ? parsed.args[0] : "unknown";
      console.log(`  ✅ "${t.title}" → ${String(taskId).slice(0, 18)}... (${t.reward} AIWK)`);
    } catch (err) {
      console.log(`  ⚠️  "${t.title}": ${err.message?.slice(0, 100)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const totalAgents = await registry.totalAgents();
  const totalTasks = await taskManager.totalTasks();

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║          Seeding Complete                         ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log(`║  Agents registered: ${totalAgents}                            ║`);
  console.log(`║  Tasks posted:      ${totalTasks}                            ║`);
  console.log("╚═══════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
