import { Hono } from "hono";
import {
  publicClient,
  CONTRACTS,
  AGENT_REGISTRY_ABI,
  TASK_MANAGER_ABI,
  activeChain,
} from "../services/blockchain";
import { ipfs } from "../services/ipfs";
import { pool } from "../db";

export const platformRoutes = new Hono();

// Counters for Prometheus
let requestCount = 0;
const startTime = Date.now();

platformRoutes.get("/live", (c) => c.json({ status: "alive", uptime: Math.floor((Date.now() - startTime) / 1000) }));

platformRoutes.get("/ready", async (c) => {
  const checks = await Promise.allSettled([
    pool.query("SELECT 1 FROM schema_migrations LIMIT 1"),
    publicClient.getBlockNumber(),
  ]);
  const ready = checks.every((check) => check.status === "fulfilled");
  return c.json({ status: ready ? "ready" : "not_ready", database: checks[0]?.status, chain: checks[1]?.status }, ready ? 200 : 503);
});

// Middleware to count requests
platformRoutes.use("*", async (c, next) => {
  requestCount++;
  await next();
});

// ─── Platform Stats ────────────────────────────────────────────
platformRoutes.get("/stats", async (c) => {
  try {
    const [totalAgents, totalTasks, aggregates] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.agentRegistry,
        abi: AGENT_REGISTRY_ABI,
        functionName: "totalAgents",
      }),
      publicClient.readContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "totalTasks",
      }),
      pool.query(
        `SELECT COALESCE((SELECT SUM(paid_out) FROM tasks), 0) AS volume,
                COALESCE((SELECT AVG(reputation) FROM agents), 0) AS avg_reputation,
                (SELECT COUNT(*) FROM problems) AS total_problems,
                (SELECT COUNT(*) FROM contributions WHERE status = 'ACCEPTED') AS accepted_contributions,
                (SELECT COUNT(*) FROM evidence) AS evidence_records`
      ),
    ]);
    const aggregate = aggregates.rows[0];

    return c.json({
      platform: "Collagent",
      chain: activeChain.name,
      totalAgents: Number(totalAgents),
      totalTasks: Number(totalTasks),
      volume: String(aggregate.volume),
      avgScore: Math.round(Number(aggregate.avg_reputation)),
      totalProblems: Number(aggregate.total_problems),
      acceptedContributions: Number(aggregate.accepted_contributions),
      evidenceRecords: Number(aggregate.evidence_records),
      contracts: CONTRACTS,
      fees: {
        platformFeeBPS: 250,
        validatorFeeBPS: 100,
        burnBPS: 50,
        cancellationFeeBPS: 100,
      },
      complexityLevels: {
        1: "Trivial",
        5: "Standard",
        8: "Advanced",
        10: "Expert",
        13: "Master",
        15: "Extreme",
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Contract Addresses ────────────────────────────────────────
platformRoutes.get("/contracts", (c) => {
  return c.json(CONTRACTS);
});

// ─── Prometheus Metrics ────────────────────────────────────────
platformRoutes.get("/metrics", async (c) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const memUsage = process.memoryUsage();
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM activity_log) AS activities,
       (SELECT COUNT(*) FROM verification_jobs WHERE status = 'COMPLETED') AS verifications,
       (SELECT COUNT(*) FROM verification_jobs WHERE status = 'FAILED') AS verification_failures,
       (SELECT COUNT(*) FROM durable_jobs WHERE status = 'FAILED') AS queue_dlq,
       (SELECT COUNT(*) FROM durable_jobs WHERE status = 'PENDING') AS queue_pending`
  );
  const counts = rows[0] || {};

  const metrics = [
    `# HELP aiwork_uptime_seconds Server uptime in seconds`,
    `# TYPE aiwork_uptime_seconds gauge`,
    `aiwork_uptime_seconds ${uptimeSeconds}`,
    ``,
    `# HELP aiwork_requests_total Total HTTP requests`,
    `# TYPE aiwork_requests_total counter`,
    `aiwork_requests_total ${requestCount}`,
    ``,
    `# HELP aiwork_verifications_total Total chunk verifications`,
    `# TYPE aiwork_verifications_total counter`,
    `aiwork_verifications_total ${Number(counts.verifications || 0)}`,
    ``,
    `# HELP aiwork_verification_failures_total Failed chunk verifications`,
    `# TYPE aiwork_verification_failures_total counter`,
    `aiwork_verification_failures_total ${Number(counts.verification_failures || 0)}`,
    ``,
    `# HELP aiwork_queue_dlq_jobs Durable jobs exhausted into the DLQ`,
    `# TYPE aiwork_queue_dlq_jobs gauge`,
    `aiwork_queue_dlq_jobs ${Number(counts.queue_dlq || 0)}`,
    ``,
    `# HELP aiwork_queue_pending_jobs Durable jobs awaiting a worker`,
    `# TYPE aiwork_queue_pending_jobs gauge`,
    `aiwork_queue_pending_jobs ${Number(counts.queue_pending || 0)}`,
    ``,
    `# HELP aiwork_activity_feed_size Current activity feed length`,
    `# TYPE aiwork_activity_feed_size gauge`,
    `aiwork_activity_feed_size ${Number(counts.activities || 0)}`,
    ``,
    `# HELP aiwork_memory_heap_used_bytes Heap memory used`,
    `# TYPE aiwork_memory_heap_used_bytes gauge`,
    `aiwork_memory_heap_used_bytes ${memUsage.heapUsed}`,
    ``,
    `# HELP aiwork_memory_rss_bytes RSS memory`,
    `# TYPE aiwork_memory_rss_bytes gauge`,
    `aiwork_memory_rss_bytes ${memUsage.rss}`,
  ].join("\n");

  return new Response(metrics, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});

// ─── Health Check (all services) ───────────────────────────────
platformRoutes.get("/health", async (c) => {
  const checks = await Promise.allSettled([
    pool.query("SELECT 1").then(() => ({ service: "database", ok: true })),
    publicClient.getBlockNumber().then(() => ({ service: "chain", ok: true })),
    checkDaytona(),
    checkForgejo(),
    ipfs.health().then((ok) => ({ service: "ipfs", ok, optional: true })),
  ]);

  const results = checks.map((r) =>
    r.status === "fulfilled" ? r.value : { service: "unknown", ok: false }
  );

  const required = results.filter((r: any) => !r.optional);
  const allHealthy = required.every((r) => r.ok);

  return c.json({
    status: allHealthy ? "healthy" : "degraded",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services: Object.fromEntries(results.map((r) => [r.service, r.ok ? "up" : "down"])),
  }, allHealthy ? 200 : 503);
});

async function checkDaytona() {
  if (!process.env.DAYTONA_API_KEY) {
    return { service: "sandbox", ok: false, optional: process.env.NODE_ENV !== "production" };
  }
  try {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      ...(process.env.DAYTONA_API_URL ? { apiUrl: process.env.DAYTONA_API_URL } : {}),
    });
    // The current SDK exposes sandbox discovery as a lazy async iterator. Calling
    // next() performs one bounded API request and proves credentials/connectivity.
    await daytona.list({ limit: 1 }).next();
    return { service: "sandbox", ok: true };
  } catch {
    return { service: "sandbox", ok: false };
  }
}

async function checkForgejo() {
  const configured = !!process.env.FORGEJO_URL;
  try {
    const response = await fetch(process.env.FORGEJO_URL || "http://localhost:3000");
    return { service: "forgejo", ok: response.ok, optional: !configured && process.env.NODE_ENV !== "production" };
  } catch {
    return { service: "forgejo", ok: false, optional: !configured && process.env.NODE_ENV !== "production" };
  }
}

// ─── Durable PostgreSQL Queue Stats ────────────────────────────
platformRoutes.get("/queues", async (c) => {
  try {
    const { getQueueStats } = await import("../services/queue");
    const stats = await getQueueStats();
    return c.json({
      engine: "postgresql",
      mode: "durable SKIP LOCKED workers with retry/DLQ state",
      queues: stats,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
