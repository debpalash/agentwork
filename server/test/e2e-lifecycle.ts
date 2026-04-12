/**
 * AIWork E2E Lifecycle Test — DB-only mode
 * 
 * Tests the complete verification + lifecycle flow using direct DB operations:
 *   1. Insert task → 2. Insert bid → 3. Award → 4. Submit → 5. Verify (sandbox) → 6. Complete
 * 
 * Run: bun run test/e2e-lifecycle.ts
 *      With Daytona: DAYTONA_API_KEY=xxx bun run test/e2e-lifecycle.ts
 */

import { pool, upsertAgent } from "../src/db";
import { verifySandbox, recordVerification } from "../src/services/sandbox";

const DIVIDER = "═".repeat(60);

function log(step: string, data: any) {
  console.log(`\n${DIVIDER}`);
  console.log(`  ✦ ${step}`);
  console.log(DIVIDER);
  console.log(JSON.stringify(data, null, 2));
}

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); }

async function main() {
  console.log("\n🚀 AIWork E2E Lifecycle Test (DB-only)");
  console.log(`   Daytona: ${process.env.DAYTONA_API_KEY ? "ENABLED (real sandbox)" : "SIMULATED"}`);
  console.log(DIVIDER);

  const ts = Date.now();
  const taskId = `0x${ts.toString(16)}${"0".repeat(50)}`.slice(0, 66);
  const agentId = `e2e-agent-${ts}`;
  const agentWallet = `0x${"a".repeat(38)}01`;
  const employerWallet = `0x${"b".repeat(38)}02`;

  // ─── 1. Register Agent ──────────────────────────────────────
  try {
    await upsertAgent({
      agentId,
      walletAddress: agentWallet,
      paymentAddress: agentWallet,
      category: "CODE",
      status: "ACTIVE",
      reputation: 500,
      tasksCompleted: 0, tasksFailed: 0,
      currentStreak: 0, bestStreak: 0,
      avgQuality: 0, totalEarned: "0", stakedAmount: "0",
      skills: ["typescript", "testing"],
    });
    log("1. REGISTER AGENT", { agentId, wallet: agentWallet });
    pass("Agent registered");
  } catch (err: any) { fail(`Agent: ${err.message}`); }

  // ─── 2. Create Task (use actual schema columns) ─────────────
  try {
    await pool.query(
      `INSERT INTO tasks (task_id, title, description, category, max_budget, deadline, employer, phase, total_chunks, verified_chunks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + interval '24 hours', $6, 'BIDDING', 2, 0, NOW(), NOW())
       ON CONFLICT (task_id) DO NOTHING`,
      [taskId, "E2E: Calculator", "Build calculator + tests", "CODE", 3000, employerWallet]
    );
    // Insert chunks (percentage_bps = 5000 each = 50%)
    for (let i = 0; i < 2; i++) {
      await pool.query(
        `INSERT INTO chunks (task_id, chunk_index, description, percentage_bps, submitted, verified, created_at)
         VALUES ($1, $2, $3, 5000, false, false, NOW())
         ON CONFLICT (task_id, chunk_index) DO NOTHING`,
        [taskId, i, i === 0 ? "Implement calculator.ts" : "Write calculator.test.ts"]
      );
    }
    log("2. CREATE TASK", { taskId: taskId.slice(0, 20) + "...", chunks: 2, phase: "BIDDING" });
    pass("Task + 2 chunks created");
  } catch (err: any) { fail(`Task: ${err.message}`); }

  // ─── 3. Submit Bid ──────────────────────────────────────────
  try {
    await pool.query(
      `INSERT INTO bids (task_id, agent_id, bidder_address, bid_price, estimated_hours, model_score, composite_score, submitted_at)
       VALUES ($1, $2, $3, 2500, 8, 90, 85, NOW())
       ON CONFLICT (task_id, agent_id) DO NOTHING`,
      [taskId, agentId, agentWallet]
    );
    log("3. SUBMIT BID", { agent: agentId, price: 2500, modelScore: 90 });
    pass("Bid submitted");
  } catch (err: any) { fail(`Bid: ${err.message}`); }

  // ─── 4. Award Task ─────────────────────────────────────────
  try {
    // Award to highest composite score bid
    const { rows: bids } = await pool.query(
      "SELECT agent_id, bid_price FROM bids WHERE task_id = $1 ORDER BY composite_score DESC LIMIT 1",
      [taskId]
    );
    if (bids.length > 0) {
      const winner = bids[0];
      await pool.query(
        `UPDATE tasks SET phase = 'AWARDED', worker_agent = $1, awarded_price = $2, awarded_at = NOW(), updated_at = NOW() WHERE task_id = $3`,
        [winner.agent_id, winner.bid_price, taskId]
      );
      await pool.query(
        "UPDATE bids SET is_awarded = true WHERE task_id = $1 AND agent_id = $2",
        [taskId, winner.agent_id]
      );
      log("4. AWARD TASK", { winner: winner.agent_id, price: winner.bid_price });
      pass(`🏆 Awarded to ${winner.agent_id}`);
    } else {
      fail("No bids found");
    }
  } catch (err: any) { fail(`Award: ${err.message}`); }

  // ─── 5. Verify phase ───────────────────────────────────────
  {
    const { rows } = await pool.query("SELECT phase, worker_agent, awarded_price FROM tasks WHERE task_id = $1", [taskId]);
    log("5. TASK STATUS", rows[0]);
    pass(`Phase = ${rows[0]?.phase}`);
  }

  // ─── 6. Submit + Verify Chunk 0 ────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("  ⚙️  Running sandbox verification (chunk 0)...");
  console.log(`${"─".repeat(60)}`);

  try {
    const r0 = await verifySandbox(taskId, 0);
    await recordVerification(taskId, 0, r0);

    if (r0.qualityScore >= 70) {
      await pool.query(
        "UPDATE chunks SET submitted = true, verified = true, quality_score = $1, submitted_at = NOW(), verified_at = NOW() WHERE task_id = $2 AND chunk_index = 0",
        [r0.qualityScore, taskId]
      );
      await pool.query("UPDATE tasks SET verified_chunks = verified_chunks + 1, updated_at = NOW() WHERE task_id = $1", [taskId]);
    }
    log("6. VERIFY CHUNK 0", { mode: r0.mode, test: r0.testPassed, lint: r0.lintPassed, score: r0.qualityScore, time: `${r0.executionTimeMs}ms` });
    pass(`Chunk 0: score=${r0.qualityScore} (${r0.mode})`);
  } catch (err: any) { fail(`Chunk 0: ${err.message}`); }

  // ─── 7. Submit + Verify Chunk 1 ────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("  ⚙️  Running sandbox verification (chunk 1)...");
  console.log(`${"─".repeat(60)}`);

  try {
    const r1 = await verifySandbox(taskId, 1);
    await recordVerification(taskId, 1, r1);

    if (r1.qualityScore >= 70) {
      await pool.query(
        "UPDATE chunks SET submitted = true, verified = true, quality_score = $1, submitted_at = NOW(), verified_at = NOW() WHERE task_id = $2 AND chunk_index = 1",
        [r1.qualityScore, taskId]
      );
      await pool.query("UPDATE tasks SET verified_chunks = verified_chunks + 1, updated_at = NOW() WHERE task_id = $1", [taskId]);
    }
    log("7. VERIFY CHUNK 1", { mode: r1.mode, test: r1.testPassed, lint: r1.lintPassed, score: r1.qualityScore, time: `${r1.executionTimeMs}ms` });
    pass(`Chunk 1: score=${r1.qualityScore} (${r1.mode})`);
  } catch (err: any) { fail(`Chunk 1: ${err.message}`); }

  // ─── 8. Check completion ───────────────────────────────────
  {
    const { rows } = await pool.query("SELECT phase, total_chunks, verified_chunks FROM tasks WHERE task_id = $1", [taskId]);
    const t = rows[0];
    if (t && t.verified_chunks >= t.total_chunks) {
      await pool.query("UPDATE tasks SET phase = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE task_id = $1", [taskId]);
      t.phase = "COMPLETED";
    }
    log("8. FINAL STATUS", t);
    if (t?.phase === "COMPLETED") {
      pass("🎉 TASK COMPLETED! Full lifecycle verified.");
    } else {
      console.log(`   ℹ️  ${t?.verified_chunks}/${t?.total_chunks} chunks verified`);
    }
  }

  // ─── 9. Verify DB records ──────────────────────────────────
  {
    const { rows } = await pool.query(
      "SELECT chunk_index, status, quality_score, test_passed, lint_passed, duration_ms FROM verification_jobs WHERE task_id = $1 ORDER BY chunk_index",
      [taskId]
    );
    log("9. VERIFICATION RECORDS", rows);
    pass(`${rows.length} verification record(s) persisted`);
  }

  // ─── Summary ───────────────────────────────────────────────
  console.log(`\n${DIVIDER}`);
  console.log("  🏁 E2E LIFECYCLE TEST COMPLETE");
  console.log("  Register → Post → Bid → Award → Verify×2 → Complete ✅");
  console.log(`  Mode: ${process.env.DAYTONA_API_KEY ? "DAYTONA (real sandbox)" : "SIMULATED"}`);
  console.log(DIVIDER);

  await pool.end();
}

main().catch((err) => { console.error("💥 Crashed:", err.message); pool.end(); process.exit(1); });
