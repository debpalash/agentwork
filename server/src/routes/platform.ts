import { Hono } from "hono";
import {
  publicClient,
  CONTRACTS,
  AGENT_REGISTRY_ABI,
  TASK_MANAGER_ABI,
} from "../services/blockchain";
import { ipfs } from "../services/ipfs";
// sandbox health moved inline (Daytona SDK)
import { activityFeed } from "../routes/webhooks";

export const platformRoutes = new Hono();

// Counters for Prometheus
let requestCount = 0;
let verificationCount = 0;
let verificationFailures = 0;
const startTime = Date.now();

// Middleware to count requests
platformRoutes.use("*", async (c, next) => {
  requestCount++;
  await next();
});

// ─── Platform Stats ────────────────────────────────────────────
platformRoutes.get("/stats", async (c) => {
  try {
    const [totalAgents, totalTasks] = await Promise.all([
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
    ]);

    return c.json({
      platform: "AIWork",
      chain: "Base (EVM)",
      totalAgents: Number(totalAgents),
      totalTasks: Number(totalTasks),
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
platformRoutes.get("/metrics", (c) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const memUsage = process.memoryUsage();

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
    `aiwork_verifications_total ${verificationCount}`,
    ``,
    `# HELP aiwork_verification_failures_total Failed chunk verifications`,
    `# TYPE aiwork_verification_failures_total counter`,
    `aiwork_verification_failures_total ${verificationFailures}`,
    ``,
    `# HELP aiwork_activity_feed_size Current activity feed length`,
    `# TYPE aiwork_activity_feed_size gauge`,
    `aiwork_activity_feed_size ${activityFeed.length}`,
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
    ipfs.health().then((ok) => ({ service: "ipfs", ok })),
    Promise.resolve({ service: "sandbox", ok: !!process.env.DAYTONA_API_KEY, mode: process.env.DAYTONA_API_KEY ? "daytona" : "simulated" }),
    fetch(process.env.FORGEJO_URL || "http://localhost:3000")
      .then((r) => ({ service: "forgejo", ok: r.ok }))
      .catch(() => ({ service: "forgejo", ok: false })),
  ]);

  const results = checks.map((r) =>
    r.status === "fulfilled" ? r.value : { service: "unknown", ok: false }
  );

  const allHealthy = results.every((r) => r.ok);

  return c.json({
    status: allHealthy ? "healthy" : "degraded",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services: Object.fromEntries(results.map((r) => [r.service, r.ok ? "up" : "down"])),
  }, allHealthy ? 200 : 503);
});

// ─── Queue Stats (bunqueue monitoring) ──────────────────────────
platformRoutes.get("/queues", async (c) => {
  try {
    const { getQueueStats } = await import("../services/queue");
    const stats = await getQueueStats();
    return c.json({
      engine: "bunqueue",
      mode: "embedded (SQLite WAL)",
      redis: false,
      queues: stats,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Export counters for other modules
export function incVerification(passed: boolean) {
  verificationCount++;
  if (!passed) verificationFailures++;
}
