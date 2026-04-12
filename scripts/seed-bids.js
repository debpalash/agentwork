/**
 * Seed Bids — Opens bidding on tasks via BiddingEngine and submits demo bids
 * Uses the API to find tasks instead of querying events directly
 */
const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║      AIWork v2 — Seeding Bids & Activity          ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // ─── Fetch task IDs from API ──────────────────────────────────
  console.log("📡 Fetching tasks from API...");
  const resp = await fetch("http://localhost:3001/api/v1/tasks");
  const data = await resp.json();
  const tasks = data.tasks || [];
  console.log(`   Found ${tasks.length} tasks\n`);

  if (tasks.length === 0) {
    console.log("❌ No tasks found. Run seed.js first.");
    process.exit(1);
  }

  // ─── Attach to BiddingEngine ──────────────────────────────────
  const BID_ADDR = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
  const biddingEngine = await hre.ethers.getContractAt("BiddingEngine", BID_ADDR);

  // ─── Open Bidding on Each Task ────────────────────────────────
  console.log("🔓 Opening bidding windows...");
  const taskIds = [];
  for (const task of tasks) {
    const taskId = task.taskId || task.id;
    taskIds.push(taskId);
    try {
      await biddingEngine.openBidding(taskId, 48); // 48 hours
      console.log(`  ✅ Bidding opened: ${taskId.slice(0, 18)}... "${task.title}"`);
    } catch (err) {
      console.log(`  ⚠️  ${taskId.slice(0, 18)}: ${err.reason || err.message?.slice(0, 50)}`);
    }
  }

  // ─── Submit Demo Bids ─────────────────────────────────────────
  console.log("\n💰 Submitting demo bids...");

  const bidders = [
    { signer: signers[1], agentId: "agent-claude-7a", name: "Claude Agent" },
    { signer: signers[2], agentId: "agent-kimi-2b", name: "Kimi Agent" },
    { signer: signers[3], agentId: "agent-gpt-1x", name: "GPT Agent" },
    { signer: signers[4], agentId: "agent-gemini-4c", name: "Gemini Agent" },
  ];

  for (let t = 0; t < Math.min(taskIds.length, 6); t++) {
    const taskId = taskIds[t];
    const task = tasks[t];
    const reward = parseFloat(task.baseReward || task.reward || "500");
    console.log(`\n  Task: "${task.title}" (${reward} AIWK)`);

    const numBids = 2 + (t % 3); // 2-4 bids per task
    for (let b = 0; b < numBids && b < bidders.length; b++) {
      const bidder = bidders[b];
      const discount = 0.65 + (b * 0.10); // 65%, 75%, 85%, 95%
      const bidPrice = hre.ethers.parseEther(String(Math.round(reward * discount)));
      const hours = 12 + (b * 8);
      const modelScore = 60 + (b * 12);

      try {
        const tx = await biddingEngine.connect(bidder.signer).submitBid(
          taskId,
          bidder.agentId,
          bidPrice,
          hours,
          modelScore,
          { value: hre.ethers.parseEther("0.01") }
        );
        await tx.wait();
        console.log(`    ✅ ${bidder.name}: ${hre.ethers.formatEther(bidPrice)} AIWK | ${hours}h | score:${modelScore}`);
      } catch (err) {
        console.log(`    ⚠️  ${bidder.name}: ${err.reason || err.message?.slice(0, 50)}`);
      }
    }
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log("\n📊 Final Bid Counts:");
  for (const taskId of taskIds) {
    const count = await biddingEngine.getBidCount(taskId);
    const isOpen = await biddingEngine.isBiddingOpen(taskId);
    console.log(`  ${taskId.slice(0, 18)}... → ${count} bids | Open: ${isOpen}`);
  }

  // ─── Also seed bids into PostgreSQL via API ───────────────────
  console.log("\n📥 Syncing bids to database via API...");
  for (let t = 0; t < Math.min(taskIds.length, 6); t++) {
    const taskId = taskIds[t];
    const numBids = 2 + (t % 3);
    for (let b = 0; b < numBids && b < bidders.length; b++) {
      const bidder = bidders[b];
      const discount = 0.65 + (b * 0.10);
      const reward = parseFloat(tasks[t].baseReward || tasks[t].reward || "500");
      const bidAmount = Math.round(reward * discount);

      try {
        await fetch(`http://localhost:3001/api/v1/bids/${taskId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer aiwork-dev-key-001",
          },
          body: JSON.stringify({
            agentAddress: await bidder.signer.getAddress(),
            agentId: bidder.agentId,
            amount: bidAmount,
            estimatedHours: 12 + (b * 8),
            modelScore: 60 + (b * 12),
          }),
        });
      } catch (_) {}
    }
  }
  console.log("  ✅ Database synced");

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║          Bid Seeding Complete ✓                    ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
