import { Pool } from "pg";
import { runMigrations } from "./migrations";

// ─── PostgreSQL Connection ─────────────────────────────────────
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

// ─── Schema check (tables are created by docker/init.sql) ──────
export async function initDB() {
  try {
    await runMigrations(pool);
    const client = await pool.connect();
    const requiredTables = [
      "agents", "tasks", "chunks", "bids", "activity_log",
      "task_specs", "verification_jobs", "api_keys", "audit_log", "disputes",
      "problems", "workstreams", "workstream_dependencies", "contributions",
      "evidence", "contribution_reviews", "auth_replay_protection",
      "chain_operations", "actor_trust_profiles", "institutional_approvals",
      "problem_access_grants", "verifier_receipts", "governance_audit_log", "durable_jobs",
    ];
    // Quick connectivity + schema check
    let rows: any[];
    try {
      ({ rows } = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [requiredTables]
      ));
    } finally {
      client.release();
    }
    const tables = rows.map((r: any) => r.table_name);
    const missing = requiredTables.filter((table) => !tables.includes(table));
    if (process.env.NODE_ENV === "production" && missing.length > 0) {
      throw new Error(`Missing required database tables: ${missing.join(", ")}`);
    }
    console.log(`[DB] Connected. Tables found: ${tables.join(", ") || "none (run docker compose up to init)"}`);
  } catch (err: any) {
    if (process.env.NODE_ENV === "production") throw err;
    console.warn(`[DB] Connection failed: ${err.message}. Development reads may fall back to chain state.`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Agent Queries (matches docker/init.sql schema)
// ═══════════════════════════════════════════════════════════════
export async function upsertAgent(agent: {
  agentId: string;
  walletAddress: string;
  paymentAddress?: string;
  category: string;
  status: string;
  reputation?: number;
  tasksCompleted?: number;
  tasksFailed?: number;
  currentStreak?: number;
  bestStreak?: number;
  avgQuality?: number;
  totalEarned?: string;
  stakedAmount?: string;
  skills?: string[];
}) {
  await pool.query(
    `INSERT INTO agents (agent_id, wallet_address, payment_address, category, status, reputation, tasks_completed, tasks_failed, current_streak, best_streak, avg_quality, total_earned, staked_amount, skills)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (agent_id) DO UPDATE SET
       status = EXCLUDED.status,
       reputation = EXCLUDED.reputation,
       tasks_completed = EXCLUDED.tasks_completed,
       tasks_failed = EXCLUDED.tasks_failed,
       current_streak = EXCLUDED.current_streak,
       best_streak = EXCLUDED.best_streak,
       avg_quality = EXCLUDED.avg_quality,
       total_earned = EXCLUDED.total_earned,
       staked_amount = EXCLUDED.staked_amount,
       updated_at = NOW()`,
    [
      agent.agentId, agent.walletAddress, agent.paymentAddress || agent.walletAddress,
      agent.category, agent.status, agent.reputation || 5000,
      agent.tasksCompleted || 0, agent.tasksFailed || 0,
      agent.currentStreak || 0, agent.bestStreak || 0,
      agent.avgQuality || 0, agent.totalEarned || "0",
      agent.stakedAmount || "0", agent.skills || [],
    ]
  );
}

export async function getAgentByWallet(wallet: string) {
  const { rows } = await pool.query("SELECT * FROM agents WHERE wallet_address = $1", [wallet]);
  return rows[0] || null;
}

export async function getAllAgents(filter?: string) {
  let query = "SELECT * FROM agents ORDER BY reputation DESC";
  if (filter && filter !== "ALL") {
    query = `SELECT * FROM agents WHERE status = $1 OR category = $1 ORDER BY reputation DESC`;
    const { rows } = await pool.query(query, [filter]);
    return rows;
  }
  const { rows } = await pool.query(query);
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// Task Queries (matches docker/init.sql schema)
// ═══════════════════════════════════════════════════════════════
export async function upsertTask(task: {
  taskId: string;
  employer: string;
  title: string;
  category: string;
  phase?: string;
  maxBudget: string;
  bonusPool?: string;
  deadline?: number;
  biddingEnds?: number;
  totalChunks?: number;
  description?: string;
  txHash?: string;
}) {
  await pool.query(
    `INSERT INTO tasks (task_id, employer, title, category, phase, max_budget, bonus_pool, deadline, bidding_ends, total_chunks, description, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (task_id) DO UPDATE SET
       phase = EXCLUDED.phase,
       max_budget = EXCLUDED.max_budget,
       bidding_ends = COALESCE(tasks.bidding_ends, EXCLUDED.bidding_ends),
       updated_at = NOW()`,
    [
      task.taskId, task.employer, task.title, task.category,
      task.phase || "POSTED", task.maxBudget, task.bonusPool || "0",
      task.deadline ? new Date(task.deadline * 1000).toISOString() : null,
      task.biddingEnds ? new Date(task.biddingEnds * 1000).toISOString() : null,
      task.totalChunks || 0, task.description || "", task.txHash || "",
    ]
  );
}

export async function getAllTasks() {
  const { rows } = await pool.query("SELECT * FROM tasks ORDER BY created_at DESC");
  return rows;
}

export async function getTaskById(taskId: string) {
  const { rows } = await pool.query("SELECT * FROM tasks WHERE task_id = $1", [taskId]);
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════
// Bid Queries (matches docker/init.sql schema)
// ═══════════════════════════════════════════════════════════════
export async function insertBid(bid: {
  taskId: string;
  agentId?: string;
  agentAddress: string;
  amount: string;
  estimatedHours?: number;
  reputation?: string;
  txHash?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO bids (task_id, agent_id, bidder_address, bid_price, estimated_hours, model_score, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      bid.taskId, bid.agentId || "unknown",
      bid.agentAddress, bid.amount,
      bid.estimatedHours || 24, 0,
      bid.txHash || null,
    ]
  );
  return rows[0];
}

export async function getBidsByTask(taskId: string) {
  const { rows } = await pool.query(
    `SELECT b.*, a.reputation AS agent_reputation
     FROM bids b LEFT JOIN agents a ON a.agent_id = b.agent_id
     WHERE b.task_id = $1 ORDER BY b.bid_price ASC`,
    [taskId]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// Activity Queries (matches docker/init.sql schema)
// ═══════════════════════════════════════════════════════════════
export async function insertActivity(activity: {
  type: string;
  agent?: string;
  message: string;
  taskId?: string;
  txHash?: string;
}) {
  await pool.query(
    `INSERT INTO activity_log (type, agent_id, task_id, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [
      activity.type, activity.agent || "system",
      activity.taskId || null, activity.message,
      JSON.stringify({ txHash: activity.txHash || null }),
    ]
  );
}

export async function getRecentActivities(limit: number = 20) {
  const { rows } = await pool.query(
    "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}
