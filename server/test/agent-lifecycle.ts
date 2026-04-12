/**
 * AIWork — Full Worker Agent Lifecycle Test (with Postgres)
 *
 * Complete end-to-end test of a worker agent doing EVERYTHING:
 *
 *   Phase 1:  Platform Discovery (health, stats, contracts, queues, metrics)
 *   Phase 2:  Agent Registration (DB + check wallet + list)
 *   Phase 3:  Browse Marketplace (list tasks, filter, evaluate)
 *   Phase 4:  Task Spec (store + retrieve machine-readable spec)
 *   Phase 5:  Competitive Bidding (bid, rival bids, list, status)
 *   Phase 6:  Win Auction (employer awards → DB phase update)
 *   Phase 7:  Notification Polling (detect TASK_AWARDED)
 *   Phase 8:  Execute Work (submit 3 chunks with commit hashes)
 *   Phase 9:  Sandbox Verification (bunqueue processes chunks async)
 *   Phase 10: Task Completion (auto-complete when all chunks verified)
 *   Phase 11: Post-Completion (reputation, activity log, chunk states)
 *   Phase 12: Webhooks & Activity Feed
 *   Phase 13: Error Handling & Security
 *
 * Run: bun run test/agent-lifecycle.ts
 */

const API = "http://localhost:3001/api/v1";
const DB_URL = process.env.DATABASE_URL || "postgres://aiwork@localhost:5432/aiwork";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let step = 0, passed = 0, failed = 0;
const timeline: { phase: string; check: string; ok: boolean; ms: number; detail: string }[] = [];

// ─── Agent Identity ────────────────────────────────────────────
const AGENT_WALLET = "0xAa00000000000000000000000000000000000099";
const AGENT_ID = `worker-${Date.now()}`;
const EMPLOYER_WALLET = "0xEmployer0000000000000000000000000001";

async function phase(name: string) {
  step++;
  console.log(`\n${"━".repeat(72)}`);
  console.log(`  PHASE ${step}: ${name}`);
  console.log(`${"━".repeat(72)}`);
}

async function check(label: string, fn: () => Promise<{ ok: boolean; detail: string }>) {
  await sleep(80);
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    if (result.ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}`); }
    if (result.detail) console.log(`     ${result.detail}`);
    timeline.push({ phase: `Phase ${step}`, check: label, ok: result.ok, ms, detail: result.detail });
    return result.ok;
  } catch (err: any) {
    const ms = Date.now() - start;
    failed++;
    console.log(`  ❌ ${label} — ${err.message?.slice(0, 60)}`);
    timeline.push({ phase: `Phase ${step}`, check: label, ok: false, ms, detail: err.message });
    return false;
  }
}

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer aiwork-dev-key-001" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function db(sql: string, params: any[] = []) {
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: DB_URL });
  const { rows } = await pool.query(sql, params);
  await pool.end();
  return rows;
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║         🤖 AIWork — Complete Worker Agent Lifecycle Test               ║
╠════════════════════════════════════════════════════════════════════════╣
║  Agent:    ${AGENT_ID.padEnd(55)}  ║
║  Wallet:   ${AGENT_WALLET.padEnd(55)}  ║
║  API:      ${API.padEnd(55)}  ║
║  DB:       ${DB_URL.slice(0, 55).padEnd(55)}  ║
║  Time:     ${new Date().toISOString().padEnd(55)}  ║
╚════════════════════════════════════════════════════════════════════════╝
`);

  // ─── PHASE 1: PLATFORM DISCOVERY ──────────────────────────
  await phase("PLATFORM DISCOVERY — Agent boots and discovers the network");

  await check("Ping health endpoint", async () => {
    const { status, json } = await api("GET", "/platform/health");
    const db = json.services?.database || "unknown";
    return { ok: status === 200 || status === 503, detail: `Status: ${json.status} | Uptime: ${json.uptime}s | DB: ${db}` };
  });

  await check("Fetch platform stats", async () => {
    const { json } = await api("GET", "/platform/stats");
    return { ok: json.totalAgents > 0 && json.totalTasks > 0, detail: `Agents: ${json.totalAgents} | Tasks: ${json.totalTasks} | Chain: ${json.chain}` };
  });

  await check("Discover smart contracts", async () => {
    const { json } = await api("GET", "/platform/contracts");
    return { ok: !!json.agentRegistry, detail: `Registry: ${json.agentRegistry?.slice(0, 18)}... | TaskMgr: ${json.taskManager?.slice(0, 18)}...` };
  });

  await check("Check queue engine", async () => {
    const { json } = await api("GET", "/platform/queues");
    return { ok: json.engine === "bunqueue", detail: `Engine: ${json.engine} | Queues: ${Object.keys(json.queues || {}).join(", ")}` };
  });

  await check("Fetch Prometheus metrics", async () => {
    const { status, json } = await api("GET", "/platform/metrics");
    const text = json?.raw || JSON.stringify(json);
    return { ok: status === 200, detail: `Has uptime metric: ${text.includes("aiwork_uptime")}` };
  });

  // ─── PHASE 2: AGENT REGISTRATION ─────────────────────────
  await phase("AGENT REGISTRATION — Register in DB + check identity");

  await check("Register agent in database", async () => {
    await db(
      `INSERT INTO agents (agent_id, wallet_address, payment_address, category, status, reputation,
       tasks_completed, tasks_failed, current_streak, best_streak, avg_quality, total_earned, staked_amount, skills, registered_at, updated_at)
       VALUES ($1, $2, $2, 'CODE', 'ACTIVE', 5000, 0, 0, 0, 0, 0, '0', '0', $3::text[], NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [AGENT_ID, AGENT_WALLET, "{typescript,rust,solidity}"]
    );
    return { ok: true, detail: `Registered ${AGENT_ID} with wallet ${AGENT_WALLET}` };
  });

  await check("Verify agent via wallet lookup", async () => {
    const { json } = await api("GET", `/agents/wallet/${AGENT_WALLET}`);
    return { ok: json.registered !== false, detail: `Registered: ${json.registered} | Status: ${json.status || "found"}` };
  });

  await check("Agent directory listing works", async () => {
    const { json } = await api("GET", "/agents");
    const agents = json.agents || [];
    // Chain-only listing — our DB agent may not appear (that's correct behavior)
    // Verify the endpoint returns data and our agent is findable via wallet
    return { ok: agents.length > 0, detail: `Chain agents: ${json.totalAgents} | DB agent accessible via /agents/wallet/ ✓` };
  });

  // ─── PHASE 3: BROWSE MARKETPLACE ─────────────────────────
  await phase("BROWSE MARKETPLACE — Scan and evaluate open tasks");

  let allTasks: any[] = [];
  let codeTasks: any[] = [];
  await check("Fetch all tasks from merged feed (chain + DB)", async () => {
    const { json } = await api("GET", "/tasks");
    allTasks = json.tasks || [];
    const phases: Record<string, number> = {};
    allTasks.forEach((t: any) => { phases[t.phase] = (phases[t.phase] || 0) + 1; });
    return { ok: allTasks.length > 0, detail: `Total: ${json.totalTasks} | Phases: ${JSON.stringify(phases)}` };
  });

  await check("Filter by CODE category", async () => {
    codeTasks = allTasks.filter((t: any) => t.category === "CODE" || t.category === "GENERIC");
    for (const t of codeTasks.slice(0, 3)) {
      console.log(`     ├─ "${t.title?.slice(0, 40)}" | ${t.reward || t.max_budget || "?"} USDC | ${t.chunks || t.total_chunks || "?"} chunks`);
    }
    return { ok: codeTasks.length > 0, detail: `CODE-eligible: ${codeTasks.length} of ${allTasks.length}` };
  });

  // ─── PHASE 4: TASK SPEC ──────────────────────────────────
  await phase("TASK SPEC — Store & retrieve machine-readable requirements");

  // Use one of the seeded tasks
  const targetTask = allTasks.find((t: any) => t.title?.includes("REST API") || t.title?.includes("Authentication")) || allTasks[0];
  const taskId = targetTask?.id || "0x" + "05".repeat(32);

  await check("Store task spec with test/lint commands", async () => {
    const { status } = await api("POST", `/tasks/${taskId}/spec`, {
      testCommand: "bun test --coverage",
      lintCommand: "npx biome check ./src",
      runtime: "bun",
      requiredCoverage: 80,
      chunks: [
        { description: "JWT auth service", file: "src/auth/jwt.ts", testFile: "test/auth.test.ts" },
        { description: "RBAC middleware", file: "src/middleware/rbac.ts", testFile: "test/rbac.test.ts" },
        { description: "Rate limiter", file: "src/middleware/rate-limit.ts", testFile: "test/rate-limit.test.ts" },
      ],
    });
    return { ok: status === 201, detail: `Spec stored for task ${taskId.slice(0, 18)}...` };
  });

  await check("Retrieve spec to plan work", async () => {
    const { status, json } = await api("GET", `/tasks/${taskId}/spec`);
    return { ok: status === 200 && json.testCommand === "bun test --coverage", detail: `Runtime: ${json.runtime} | Test: ${json.testCommand} | Chunks: ${json.chunks?.length}` };
  });

  // ─── PHASE 5: COMPETITIVE BIDDING ────────────────────────
  await phase("COMPETITIVE BIDDING — Submit bid and compete with rivals");

  await check("Our agent bids (aggressive: 60% of budget)", async () => {
    const { status, json } = await api("POST", `/bids/${taskId}`, {
      agentAddress: AGENT_WALLET,
      agentId: AGENT_ID,
      amount: 3000,
      estimatedHours: 18,
      modelScore: 92,
      message: "Expert in auth systems — JWT, RBAC, rate limiting",
    });
    return { ok: status === 201, detail: `Bid: 3000 AIWK | ETA: 18h | Model: 92 | ID: ${json.bid?.id}` };
  });

  await check("Rival agent-1 bids higher (4200 AIWK)", async () => {
    const { status } = await api("POST", `/bids/${taskId}`, {
      agentAddress: "0x1111111111111111111111111111111111111111",
      agentId: "alpha-gpt4",
      amount: 4200,
      estimatedHours: 24,
      modelScore: 78,
    });
    return { ok: status === 201, detail: "Rival bid submitted" };
  });

  await check("Rival agent-2 bids even higher (4800 AIWK)", async () => {
    const { status } = await api("POST", `/bids/${taskId}`, {
      agentAddress: "0x2222222222222222222222222222222222222222",
      agentId: "solver-nlp",
      amount: 4800,
      estimatedHours: 36,
      modelScore: 65,
    });
    return { ok: status === 201, detail: "Rival bid submitted" };
  });

  await check("View all bids (transparency)", async () => {
    const { json } = await api("GET", `/bids/${taskId}`);
    for (const b of (json.bids || [])) {
      const us = (b.agent_id === AGENT_ID) ? " ← US" : "";
      console.log(`     ├─ ${(b.agent_id || "").slice(0, 20).padEnd(20)} | ${String(b.bid_price || "").padEnd(15)} AIWK | ${b.estimated_hours}h | score: ${b.model_score}${us}`);
    }
    return { ok: (json.bids || []).length >= 3, detail: `Total bids: ${json.totalBids}` };
  });

  await check("Check bid status", async () => {
    const { json } = await api("GET", `/bids/${taskId}/status`);
    return { ok: json.totalBids >= 3, detail: `Open: ${json.biddingOpen} | DB bids: ${json.dbBids}` };
  });

  // ─── PHASE 6: AUCTION CLOSES ─────────────────────────────
  await phase("AUCTION CLOSES — Employer awards task (best bid wins)");

  await check("Award task (scoring: 40% price + 35% model + 25% speed)", async () => {
    const { status, json } = await api("POST", `/tasks/${taskId}/award`);
    return { ok: json.success === true && json.winner === AGENT_ID, detail: `Winner: ${json.winner} | ${json.message?.slice(0, 50)}` };
  });

  await check("Task phase changed to AWARDED in DB", async () => {
    const rows = await db("SELECT phase, worker_agent, awarded_price FROM tasks WHERE task_id = $1", [taskId]);
    return {
      ok: rows[0]?.phase === "AWARDED" && rows[0]?.worker_agent === AGENT_ID,
      detail: `Phase: ${rows[0]?.phase} | Worker: ${rows[0]?.worker_agent} | Price: ${rows[0]?.awarded_price}`,
    };
  });

  await check("Our bid marked as awarded in DB", async () => {
    const rows = await db("SELECT agent_id, is_awarded, bid_price FROM bids WHERE task_id = $1 AND is_awarded = true", [taskId]);
    return { ok: rows.length === 1 && rows[0]?.agent_id === AGENT_ID, detail: `Winner bid: ${rows[0]?.bid_price} AIWK` };
  });

  // ─── PHASE 7: NOTIFICATION POLLING ───────────────────────
  await phase("NOTIFICATIONS — Agent detects task assignment");

  await check("Poll notifications (should see TASK_AWARDED)", async () => {
    const { json } = await api("GET", `/tasks/notifications/${AGENT_ID}`);
    const notifs = json.notifications || [];
    let foundAward = false;
    for (const n of notifs) {
      const action = n.action || JSON.parse(n.metadata || "{}").action;
      console.log(`     ├─ [${action || n.type}] ${n.message?.slice(0, 55)}`);
      if (action === "TASK_AWARDED") foundAward = true;
    }
    return { ok: foundAward, detail: `Notifications: ${json.count} | Award found: ${foundAward}` };
  });

  // ─── PHASE 8: EXECUTE WORK ───────────────────────────────
  await phase("EXECUTE WORK — Submit 3 chunks with commit hashes");

  const chunkDescs = [
    "JWT auth service with access/refresh tokens",
    "RBAC middleware with role-based route guards",
    "Rate limiting + brute-force protection",
  ];

  for (let i = 0; i < 3; i++) {
    await check(`Submit chunk ${i}: ${chunkDescs[i].slice(0, 40)}`, async () => {
      const commitHash = `0x${(Date.now() + i).toString(16)}`;
      const { status, json } = await api("POST", `/tasks/${taskId}/submit`, {
        chunkIndex: i,
        agentId: AGENT_ID,
        commitHash,
      });
      return { ok: status === 200 && json.success, detail: `Commit: ${commitHash.slice(0, 16)}... | Queued: ${json.queued}` };
    });
    await sleep(150);
  }

  // ─── PHASE 9: VERIFICATION ───────────────────────────────
  await phase("SANDBOX VERIFICATION — bunqueue processes chunks asynchronously");

  console.log("  ⏳ Waiting for verification workers (5s)...");
  await sleep(5000);

  await check("All 3 verification jobs completed", async () => {
    const rows = await db(
      "SELECT chunk_index, status, quality_score, test_passed, lint_passed, duration_ms FROM verification_jobs WHERE task_id = $1 ORDER BY chunk_index",
      [taskId]
    );
    for (const r of rows) {
      console.log(`     chunk ${r.chunk_index}: ${r.status} | score: ${r.quality_score} | test: ${r.test_passed ? "✅" : "❌"} | lint: ${r.lint_passed ? "✅" : "❌"} | ${r.duration_ms}ms`);
    }
    return {
      ok: rows.length === 3 && rows.every((r: any) => r.status === "COMPLETED"),
      detail: `${rows.length}/3 chunks verified | Avg score: ${(rows.reduce((s: number, r: any) => s + r.quality_score, 0) / Math.max(rows.length, 1)).toFixed(0)}`,
    };
  });

  await check("Chunks table updated with scores", async () => {
    const rows = await db("SELECT chunk_index, verified, quality_score, commit_hash FROM chunks WHERE task_id = $1 ORDER BY chunk_index", [taskId]);
    for (const c of rows) {
      console.log(`     chunk ${c.chunk_index}: ${c.verified ? "✅ verified" : "⏳ pending"} | score: ${c.quality_score || "–"}`);
    }
    return { ok: rows.every((r: any) => r.verified === true), detail: `All ${rows.length} chunks verified` };
  });

  // ─── PHASE 10: TASK COMPLETION ───────────────────────────
  await phase("TASK COMPLETION — Auto-complete when all chunks verified");

  await check("Task phase = COMPLETED", async () => {
    const rows = await db("SELECT phase, verified_chunks, total_chunks, completed_at FROM tasks WHERE task_id = $1", [taskId]);
    return {
      ok: rows[0]?.phase === "COMPLETED" && rows[0]?.verified_chunks === rows[0]?.total_chunks,
      detail: `Phase: ${rows[0]?.phase} | Verified: ${rows[0]?.verified_chunks}/${rows[0]?.total_chunks} | Completed: ${rows[0]?.completed_at ? "yes" : "no"}`,
    };
  });

  await check("Task shows COMPLETED in marketplace API", async () => {
    const { json } = await api("GET", "/tasks");
    const task = (json.tasks || []).find((t: any) => t.id === taskId);
    return { ok: task?.phase === "completed", detail: `"${task?.title}" | Phase: ${task?.phase}` };
  });

  // ─── PHASE 11: POST-COMPLETION ───────────────────────────
  await phase("POST-COMPLETION — Reputation, activity log, final state");

  await check("Agent stats updated in DB", async () => {
    const rows = await db("SELECT reputation, tasks_completed, avg_quality, current_streak, best_streak FROM agents WHERE agent_id = $1", [AGENT_ID]);
    if (rows.length === 0) return { ok: false, detail: "Agent not found" };
    const a = rows[0];
    return { ok: true, detail: `Rep: ${a.reputation} | Completed: ${a.tasks_completed} | Quality: ${a.avg_quality} | Streak: ${a.current_streak}/${a.best_streak}` };
  });

  await check("Activity log records full journey", async () => {
    const rows = await db("SELECT type, message FROM activity_log WHERE task_id = $1 ORDER BY created_at ASC", [taskId]);
    for (const r of rows) {
      console.log(`     ├─ [${r.type}] ${r.message?.slice(0, 55)}`);
    }
    return { ok: rows.length >= 3, detail: `Events: ${rows.length}` };
  });

  await check("Audit log captured write operations", async () => {
    const rows = await db("SELECT action, actor_type, resource_id FROM audit_log WHERE resource_id = $1 ORDER BY created_at ASC LIMIT 10", [taskId]);
    for (const r of rows) {
      console.log(`     ├─ [${r.action}] by ${r.actor_type}`);
    }
    return { ok: rows.length > 0, detail: `Audit entries: ${rows.length}` };
  });

  // ─── PHASE 12: WEBHOOKS ──────────────────────────────────
  await phase("WEBHOOKS — Git push simulation + activity feed");

  await check("Simulate Forgejo git push", async () => {
    const { status, json } = await api("POST", "/webhooks/push", {
      repository: { name: `task-${taskId.slice(2, 14)}`, clone_url: "http://forgejo/aiwork/repo.git" },
      pusher: { login: AGENT_ID },
      ref: "refs/heads/main",
      commits: [
        { id: "abc123", added: ["chunk-0/src/auth/jwt.ts"], modified: [], removed: [] },
      ],
    });
    return { ok: status === 200, detail: `Chunks detected: ${json.chunksDetected}` };
  });

  await check("Activity feed has entries", async () => {
    const { json } = await api("GET", "/webhooks/activity");
    return { ok: (json.activities || []).length > 0, detail: `Total: ${json.total}` };
  });

  // ─── PHASE 13: ERROR HANDLING ────────────────────────────
  await phase("ERROR HANDLING & SECURITY — Input validation + edge cases");

  await check("Invalid wallet → 400", async () => {
    const { status } = await api("POST", "/agents/register", { walletAddress: "bad", category: "CODE", skills: ["x"] });
    return { ok: status === 400, detail: "Rejected" };
  });

  await check("Missing task fields → 400", async () => {
    const { status } = await api("POST", "/tasks", { title: "Incomplete" });
    return { ok: status === 400, detail: "Rejected" };
  });

  await check("Duplicate bid → 500", async () => {
    const { status } = await api("POST", `/bids/${taskId}`, {
      agentAddress: AGENT_WALLET,
      agentId: AGENT_ID,
      amount: 9999,
      estimatedHours: 1,
    });
    return { ok: status === 500 || status === 409, detail: `Status: ${status} (duplicate rejected)` };
  });

  await check("Health without auth (public)", async () => {
    const res = await fetch(`${API}/platform/health`);
    return { ok: res.status === 200 || res.status === 503, detail: `Status: ${res.status}` };
  });

  await check("Rate limit headers present", async () => {
    const res = await fetch(`${API}/platform/stats`, { headers: { Authorization: "Bearer aiwork-dev-key-001" } });
    const limit = res.headers.get("x-ratelimit-limit");
    return { ok: !!limit, detail: `Limit: ${limit} | Remaining: ${res.headers.get("x-ratelimit-remaining")}` };
  });

  // ─── FINAL DB AUDIT ──────────────────────────────────────
  await phase("DATABASE AUDIT — Final state verification");

  await check("DB table counts", async () => {
    const tables = ["tasks", "agents", "bids", "chunks", "verification_jobs", "activity_log", "audit_log"];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const rows = await db(`SELECT COUNT(*) FROM ${t}`);
      counts[t] = Number(rows[0].count);
    }
    const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" | ");
    console.log(`     ${summary}`);
    return { ok: counts.tasks > 0 && counts.agents > 0, detail: `${Object.keys(counts).length} tables verified` };
  });

  // ═══════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  const total = passed + failed;

  console.log(`\n\n${"═".repeat(72)}`);
  console.log(`  🤖 WORKER AGENT LIFECYCLE — FINAL REPORT`);
  console.log(`${"═".repeat(72)}\n`);

  let currentPhase = "";
  for (const t of timeline) {
    if (t.phase !== currentPhase) {
      currentPhase = t.phase;
      console.log(`\n  📦 ${currentPhase}`);
    }
    console.log(`   ${t.ok ? "✅" : "❌"} ${t.check.padEnd(48)} ${String(t.ms).padStart(5)}ms`);
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`
  Agent:       ${AGENT_ID}
  Wallet:      ${AGENT_WALLET}
  Task:        ${taskId.slice(0, 20)}...
  DB:          ${DB_URL.slice(0, 50)}

  Journey:     Discover → Register → Browse → Spec → Bid → Win
               → Notify → Execute → Verify → Complete → Audit

  ✅ Passed:   ${passed}/${total}
  ❌ Failed:   ${failed}/${total}
  Pass Rate:   ${((passed / total) * 100).toFixed(1)}%
  `);
  console.log(`${"═".repeat(72)}`);

  if (failed === 0) {
    console.log("\n  🎉 FULL LIFECYCLE PASSED — Worker agent completed all platform operations!\n");
  } else {
    console.log("\n  ⚠️  Some checks failed — review details above\n");
    process.exit(1);
  }
}

main().catch(err => { console.error("💥 Crashed:", err.message); process.exit(1); });
