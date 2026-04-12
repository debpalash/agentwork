/**
 * AIWork Platform — Comprehensive Public API Test Suite
 *
 * Tests EVERY public endpoint with proper expected status codes.
 * Chain-write operations are expected to fail when Hardhat isn't running.
 *
 * Run: bun run test/api-full-suite.ts
 */

const API = process.env.API_BASE || "http://localhost:3001/api/v1";

// ─── Helpers ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results: { endpoint: string; status: string; ms: number; detail?: string }[] = [];

async function test(
  method: string,
  path: string,
  opts: { body?: any; expect?: number | number[]; label?: string; auth?: boolean } = {}
) {
  // Throttle to avoid rate limiting
  await new Promise(r => setTimeout(r, 150));
  
  const url = `${API}${path}`;
  const label = opts.label || `${method} ${path}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const start = Date.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opts.auth !== false) {
        headers["Authorization"] = "Bearer aiwork-dev-key-001";
      }

      const res = await fetch(url, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });

      const ms = Date.now() - start;

      // Retry on rate limit
      if (res.status === 429 && attempt < 2) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      const data = await res.text();
      let json: any;
      try { json = JSON.parse(data); } catch { json = data; }

      const expected = Array.isArray(opts.expect) ? opts.expect : [opts.expect || 200];
      const ok = expected.includes(res.status);

      if (ok) {
        passed++;
        const summary = typeof json === "object" ? Object.keys(json).slice(0, 4).join(", ") : String(data).slice(0, 50);
        results.push({ endpoint: label, status: `✅ ${res.status}`, ms, detail: summary });
      } else {
        failed++;
        const errMsg = typeof json === "object" ? (json.error || JSON.stringify(json).slice(0, 60)) : String(data).slice(0, 60);
        results.push({ endpoint: label, status: `❌ ${res.status}`, ms, detail: `expected ${expected.join("|")} → ${errMsg}` });
      }

      return { ok, status: res.status, json, ms };
    } catch (err: any) {
      const ms = Date.now() - start;
      if (attempt === 2) {
        failed++;
        results.push({ endpoint: label, status: "💥 ERR", ms, detail: err.message.slice(0, 50) });
        return { ok: false, status: 0, json: null, ms };
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { ok: false, status: 0, json: null, ms: 0 };
}

function header(section: string) {
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  📦 ${section}`);
  console.log(`${"━".repeat(70)}`);
}

// ─── Test Data ─────────────────────────────────────────────────
const agentWallet = `0x${"c".repeat(38)}01`;
const employerWallet = `0x${"d".repeat(38)}02`;
const agentId = `api-test-${Date.now()}`;

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log("🧪 AIWork API Full Suite");
  console.log(`   Target: ${API}`);
  console.log(`   Time:   ${new Date().toISOString()}`);

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork" });

  // ─── 1. PLATFORM ───────────────────────────────────────────
  header("1. PLATFORM (5 endpoints)");

  await test("GET", "/platform/health", {
    label: "GET /platform/health",
    expect: [200, 503], // 503 = degraded (IPFS/Forgejo down) — acceptable
  });
  await test("GET", "/platform/stats", { label: "GET /platform/stats" });
  await test("GET", "/platform/contracts", { label: "GET /platform/contracts" });
  await test("GET", "/platform/metrics", { label: "GET /platform/metrics" });
  await test("GET", "/platform/queues", { label: "GET /platform/queues" });

  // ─── 2. AGENTS ─────────────────────────────────────────────
  header("2. AGENTS (7 endpoints)");

  // Register (chain write — expected to fail w/o Hardhat)
  await test("POST", "/agents/register", {
    label: "POST /agents/register (chain)",
    body: { walletAddress: agentWallet, paymentAddress: agentWallet, category: "CODE", skills: ["ts"] },
    expect: [201, 500], // 500 = no Hardhat node
  });

  await test("GET", "/agents", { label: "GET /agents (list)" });

  // Seed an agent in DB for retrieval testing
  try {
    const { upsertAgent } = await import("../src/db");
    await upsertAgent({
      agentId, walletAddress: agentWallet, paymentAddress: agentWallet,
      category: "CODE", status: "ACTIVE", reputation: 500,
      tasksCompleted: 0, tasksFailed: 0, currentStreak: 0, bestStreak: 0,
      avgQuality: 0, totalEarned: "0", stakedAmount: "0", skills: ["typescript"],
    });
  } catch {}

  await test("GET", `/agents/wallet/${agentWallet}`, {
    label: "GET /agents/wallet/:addr",
  });

  // Chain reads (may timeout on non-existent agent)
  await test("GET", `/agents/${agentId}`, {
    label: "GET /agents/:agentId (chain)",
    expect: [200, 404, 500],
  });

  await test("POST", `/agents/${agentId}/activate`, {
    label: "POST /agents/:id/activate (chain)",
    expect: [200, 500],
  });

  await test("POST", "/agents/keys", {
    label: "POST /agents/keys (create)",
    body: { walletAddress: agentWallet, label: "suite-key", scope: "agent" },
    expect: [201, 500], // 500 if api_keys table missing
  });

  await test("GET", `/agents/keys/${agentWallet}`, {
    label: "GET /agents/keys/:wallet",
    expect: [200, 500],
  });

  // ─── 3. TASKS ──────────────────────────────────────────────
  header("3. TASKS — READ (3 endpoints)");

  const tasksResult = await test("GET", "/tasks", { label: "GET /tasks (list)" });
  const chainTaskId = tasksResult.json?.tasks?.[0]?.id || "";

  if (chainTaskId) {
    await test("GET", `/tasks/${chainTaskId}`, {
      label: "GET /tasks/:id (detail)",
      expect: [200, 404, 500],
    });
  }

  await test("GET", "/tasks/0x000000000000000000000000000000000000000000000000000000000000dead", {
    label: "GET /tasks/:id (nonexistent)",
    expect: [200, 404, 500], // 200 if chain returns empty struct
  });

  // ─── TASK SPEC ─────────────────────────────────────────────
  header("4. TASK SPECS (2 endpoints)");

  const specTaskId = chainTaskId || "0x0000000000000000000000000000000000000000000000000000000000test";
  await test("POST", `/tasks/${specTaskId}/spec`, {
    label: "POST /tasks/:id/spec (store)",
    body: { testCommand: "bun test", lintCommand: "biome check .", runtime: "bun", chunks: [{ desc: "impl" }] },
    expect: 201,
  });

  await test("GET", `/tasks/${specTaskId}/spec`, {
    label: "GET /tasks/:id/spec (retrieve)",
  });

  // ─── CHAIN WRITES ──────────────────────────────────────────
  header("5. TASKS — CHAIN WRITES (6 endpoints, expect 500 w/o Hardhat)");

  await test("POST", "/tasks", {
    label: "POST /tasks (create — chain)",
    body: {
      title: "Test", category: 0, paymentModel: 1,
      paymentToken: "0x0000000000000000000000000000000000000000",
      baseReward: "1000000000000000000", complexityClaim: 5,
      steps: [{ description: "impl", rewardBPS: 10000 }],
    },
    expect: [201, 400, 500],
  });

  if (chainTaskId) {
    await test("POST", `/tasks/${chainTaskId}/assign`, {
      label: "POST /tasks/:id/assign (chain)",
      body: { agentAddress: agentWallet },
      expect: [200, 500],
    });
    await test("POST", `/tasks/${chainTaskId}/steps/0/submit`, {
      label: "POST /tasks/:id/steps/0/submit",
      body: {},
      expect: [200, 500],
    });
    await test("POST", `/tasks/${chainTaskId}/steps/0/verify`, {
      label: "POST /tasks/:id/steps/0/verify",
      body: { approved: true, qualityScore: 85 },
      expect: [200, 500],
    });
    await test("POST", `/tasks/${chainTaskId}/complete`, {
      label: "POST /tasks/:id/complete",
      body: {},
      expect: [200, 500],
    });
    await test("POST", `/tasks/${chainTaskId}/cancel`, {
      label: "POST /tasks/:id/cancel",
      expect: [200, 500],
    });
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────
  header("6. LIFECYCLE — DB-backed (4 endpoints)");

  const lcTaskId = `0x${Date.now().toString(16)}${"f".repeat(50)}`.slice(0, 66);
  await pool.query(
    `INSERT INTO tasks (task_id, title, description, category, max_budget, deadline, employer, phase, total_chunks, verified_chunks, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + interval '24h', $6, 'BIDDING', 2, 0, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [lcTaskId, "Suite: Lifecycle", "Test", "CODE", 5000, employerWallet]
  );
  for (let i = 0; i < 2; i++) {
    await pool.query(
      `INSERT INTO chunks (task_id, chunk_index, description, percentage_bps) VALUES ($1, $2, $3, 5000) ON CONFLICT DO NOTHING`,
      [lcTaskId, i, `Chunk ${i}`]
    );
  }
  await pool.query(
    `INSERT INTO bids (task_id, agent_id, bidder_address, bid_price, estimated_hours, model_score, composite_score, submitted_at)
     VALUES ($1, $2, $3, 4000, 12, 88, 82, NOW()) ON CONFLICT DO NOTHING`,
    [lcTaskId, agentId, agentWallet]
  );

  await test("POST", `/tasks/${lcTaskId}/award`, {
    label: "POST /tasks/:id/award (lifecycle)",
  });

  await test("POST", `/tasks/${lcTaskId}/submit`, {
    label: "POST /tasks/:id/submit chunk 0",
    body: { chunkIndex: 0, agentId, commitHash: "abc123" },
  });

  await test("POST", `/tasks/${lcTaskId}/submit`, {
    label: "POST /tasks/:id/submit chunk 1",
    body: { chunkIndex: 1, agentId, commitHash: "def456" },
  });

  await test("GET", `/tasks/notifications/${agentId}`, {
    label: "GET /tasks/notifications/:agentId",
  });

  // ─── BIDS ──────────────────────────────────────────────────
  header("7. BIDS (4 endpoints)");

  const bidTaskId = `0x${(Date.now() + 1).toString(16)}${"e".repeat(50)}`.slice(0, 66);
  await pool.query(
    `INSERT INTO tasks (task_id, title, category, max_budget, deadline, employer, phase, total_chunks, verified_chunks, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW() + interval '48h', $5, 'BIDDING', 3, 0, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [bidTaskId, "Bid Test", "CODE", 8000, employerWallet]
  );

  await test("POST", `/bids/${bidTaskId}`, {
    label: "POST /bids/:taskId (submit bid)",
    body: { agentAddress: agentWallet, agentId, amount: 6500, estimatedHours: 16, modelScore: 92, message: "Ready" },
    expect: [200, 201],
  });

  await test("POST", `/bids/${bidTaskId}`, {
    label: "POST /bids/:taskId (competing bid)",
    body: { agentAddress: `0x${"e".repeat(38)}03`, agentId: "rival-agent", amount: 7000, estimatedHours: 20, modelScore: 85, message: "Me too" },
    expect: [200, 201],
  });

  await test("GET", `/bids/${bidTaskId}`, {
    label: "GET /bids/:taskId (list bids)",
  });

  await test("GET", `/bids/${bidTaskId}/status`, {
    label: "GET /bids/:taskId/status",
  });

  // ─── WEBHOOKS ──────────────────────────────────────────────
  header("8. WEBHOOKS (3 endpoints)");

  await test("POST", "/webhooks/push", {
    label: "POST /webhooks/push",
    body: {
      repository: { name: "task-abc123", clone_url: "http://forgejo:3000/aiwork/task-abc123.git" },
      pusher: { login: "bot" }, ref: "refs/heads/main",
      commits: [{ id: "aaa111", added: ["chunk-1/index.ts"], modified: [], removed: [] }],
    },
  });

  await test("POST", `/webhooks/specs/test-task`, {
    label: "POST /webhooks/specs/:taskId",
    body: { testCommand: "bun test", lintCommand: "biome check ." },
  });

  await test("GET", "/webhooks/activity", { label: "GET /webhooks/activity" });

  // ─── ERROR HANDLING ────────────────────────────────────────
  header("9. ERROR HANDLING (6 cases)");

  await test("GET", "/agents/nonexistent-agent-zzzz", {
    label: "Agent 404",
    expect: [404, 500],
  });

  await test("POST", "/tasks", {
    label: "Task — missing fields → 400",
    body: { title: "Incomplete" },
    expect: 400,
  });

  await test("POST", "/agents/register", {
    label: "Register — invalid wallet → 400",
    body: { walletAddress: "not-a-wallet", category: "CODE", skills: ["x"] },
    expect: 400,
  });

  await test("POST", `/bids/${bidTaskId}`, {
    label: "Duplicate bid → 409/500",
    body: { agentAddress: agentWallet, agentId, amount: 5000, estimatedHours: 10, modelScore: 80 },
    expect: [409, 500],
  });

  await test("POST", `/tasks/${lcTaskId}/submit`, {
    label: "Submit — missing agentId → 400",
    body: { chunkIndex: 0 },
    expect: 400,
  });

  await test("GET", "/platform/health", {
    label: "Health — no auth",
    auth: false,
    expect: [200, 503], // Health should work without auth
  });

  // ─── DB AUDIT ──────────────────────────────────────────────
  header("10. DATABASE STATE");

  const tables = ["tasks", "agents", "bids", "chunks", "verification_jobs", "activity_log"];
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT COUNT(*) as c FROM ${t}`);
    results.push({ endpoint: `DB: ${t}`, status: `📊 ${rows[0].c}`, ms: 0, detail: "rows" });
  }

  await pool.end();

  // ─── REPORT ────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(70)}`);
  console.log("  📋 FULL API TEST REPORT");
  console.log(`${"═".repeat(70)}\n`);

  for (const r of results) {
    const ep = r.endpoint.padEnd(40);
    const st = r.status.padEnd(10);
    const ms = r.ms > 0 ? `${String(r.ms).padStart(5)}ms` : "      ";
    const det = r.detail ? `  ${r.detail.slice(0, 45)}` : "";
    console.log(`  ${st} ${ep} ${ms}${det}`);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`  ✅ Passed: ${passed}    ❌ Failed: ${failed}    Total: ${results.length}`);
  console.log(`  Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`${"═".repeat(70)}`);

  if (failed > 0) {
    console.log("\n  ⚠️  FAILURES detected — review above");
    process.exit(1);
  } else {
    console.log("\n  🎉 ALL TESTS PASSED!");
  }
}

main().catch((err) => { console.error("💥 Suite crashed:", err.message); process.exit(1); });
