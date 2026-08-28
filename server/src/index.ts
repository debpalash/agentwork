// ⚠️ OTel MUST be the first import — instruments Node.js internals
import "./telemetry";

// Fix BigInt JSON serialization globally
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

if (process.env.NODE_ENV === "production") {
  const required = [
    "DATABASE_URL",
    "PLATFORM_PRIVATE_KEY",
    "DAYTONA_API_KEY",
    "FORGEJO_ADMIN_TOKEN",
    "FORGEJO_WEBHOOK_SECRET",
    "ALLOWED_ORIGINS",
    "DISPUTE_RESOLUTION_ADDRESS",
    "VERIFIER_INSTANCE_IDS",
    "ARBITER_ADDRESSES",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[CONFIG] Missing required production variables: ${missing.join(", ")}`);
  }
  const quorum = Number(process.env.VERIFIER_QUORUM || "3");
  const verifierTargets = new Set(process.env.VERIFIER_INSTANCE_IDS!.split(",").map((value) => value.trim()).filter(Boolean));
  const arbiters = new Set(process.env.ARBITER_ADDRESSES!.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (quorum < 3 || quorum > 15 || quorum % 2 === 0 || verifierTargets.size < quorum) {
    throw new Error("[CONFIG] Production requires an odd 3–15 verifier quorum and one distinct worker target per vote");
  }
  if (arbiters.size < 3) throw new Error("[CONFIG] Production requires at least three distinct bonded arbiter addresses");
}

import { initDB } from "./db";
await initDB();

// Boot job queues only after the production database/schema gate passes.
const queueService = await import("./services/queue");

import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { agentRoutes } from "./routes/agents";
import { taskRoutes } from "./routes/tasks";
import { platformRoutes } from "./routes/platform";
import { bidRoutes } from "./routes/bids";
import { webhookRoutes } from "./routes/webhooks";
import { disputeRoutes } from "./routes/disputes";
import { problemRoutes } from "./routes/problems";
import { trustRoutes } from "./routes/trust";
import { activeChain } from "./services/blockchain";
import { otelMiddleware } from "./middleware/otel";
import { rateLimitMiddleware } from "./middleware/auth";
import {
  auditMiddleware,
  sanitizeMiddleware,
  securityHeaders,
  corsMiddleware,
} from "./middleware/security";
import { resolveRole } from "./middleware/roles";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// ─── Security Middleware Stack ──────────────────────────────────
app.use("*", corsMiddleware);       // ← Strict origin allowlist
app.use("*", securityHeaders);      // ← CSP, X-Frame-Options, etc.
app.use("*", logger());
app.use("*", prettyJSON());
app.use("*", otelMiddleware);       // ← SigNoz traces + metrics + logs
app.use("*", rateLimitMiddleware);  // ← 60 req/min per IP
app.use("*", sanitizeMiddleware);   // ← XSS/SQLi input validation
app.use("*", auditMiddleware);      // ← All writes logged to audit_log
app.use("*", resolveRole);          // ← Auto-detect employer/agent role

// ─── API Routes ────────────────────────────────────────────────
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/tasks", taskRoutes);
app.route("/api/v1/platform", platformRoutes);
app.route("/api/v1/bids", bidRoutes);
app.route("/api/v1/webhooks", webhookRoutes);
app.route("/api/v1/disputes", disputeRoutes);
app.route("/api/v1/problems", problemRoutes);
app.route("/api/v1/trust", trustRoutes);

// ─── Health / Root ─────────────────────────────────────────────
app.get("/api", (c) => {
  return c.json({
    name: "Collagent — Open Problem Protocol",
    version: "3.0.0-alpha.1",
    status: "operational",
    chain: activeChain.name,
    endpoints: {
      agents: "/api/v1/agents",
      tasks: "/api/v1/tasks",
      bids: "/api/v1/bids",
      webhooks: "/api/v1/webhooks",
      disputes: "/api/v1/disputes",
      platform: "/api/v1/platform",
      problems: "/api/v1/problems",
      trust: "/api/v1/trust",
    },
  });
});

app.get("/", (c) => {
  return c.json({
    message: "Collagent API. Frontend → http://localhost:5173",
    api: "http://localhost:3001/api",
  });
});

// ─── 404 / Error ───────────────────────────────────────────────
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);
  return c.json({ error: err.message }, 500);
});

// ─── Start ─────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 3001;

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[API] ${signal} received; draining`);
  await queueService.stopQueueWorkers();
  const { pool } = await import("./db");
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

console.log(`
╔═══════════════════════════════════════════════════╗
║         Collagent — Open Problem Protocol         ║
╠═══════════════════════════════════════════════════╣
║  API:        http://localhost:${port}/api            ║
║  Frontend:   http://localhost:5173 (Vite)          ║
║  Forgejo:    ${process.env.FORGEJO_URL || "http://localhost:3000"}            ║
║  Chain:      ${activeChain.name.padEnd(38)}║
║                                                    ║
║  Problem Protocol v1:                              ║
║  ├── Problem and workstream graph                  ║
║  ├── Contributions and provenance                  ║
║  ├── Evidence, review, and replication             ║
║  └── Existing code-task verifier                   ║
╚═══════════════════════════════════════════════════╝
`);

export default {
  port,
  fetch: app.fetch,
};
