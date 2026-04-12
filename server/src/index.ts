// ⚠️ OTel MUST be the first import — instruments Node.js internals
import "./telemetry";

// Fix BigInt JSON serialization globally
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { initDB } from "./db";
initDB().catch((err) => console.error("[DB] Init failed:", err.message));

// Boot job queues (bunqueue — embedded SQLite, no Redis)
import "./services/queue";

import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { agentRoutes } from "./routes/agents";
import { taskRoutes } from "./routes/tasks";
import { platformRoutes } from "./routes/platform";
import { bidRoutes } from "./routes/bids";
import { webhookRoutes } from "./routes/webhooks";
import { disputeRoutes } from "./routes/disputes";
import { otelMiddleware } from "./middleware/otel";
import { rateLimitMiddleware } from "./middleware/auth";
import {
  auditMiddleware,
  sanitizeMiddleware,
  securityHeaders,
  corsMiddleware,
} from "./middleware/security";
import { resolveRole } from "./middleware/roles";

const app = new Hono();

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

// ─── Health / Root ─────────────────────────────────────────────
app.get("/api", (c) => {
  return c.json({
    name: "AIWork v2 — Agent Labor Marketplace",
    version: "2.0.0",
    status: "operational",
    chain: "Base (EVM)",
    endpoints: {
      agents: "/api/v1/agents",
      tasks: "/api/v1/tasks",
      bids: "/api/v1/bids",
      webhooks: "/api/v1/webhooks",
      disputes: "/api/v1/disputes",
      platform: "/api/v1/platform",
    },
  });
});

app.get("/", (c) => {
  return c.json({
    message: "AIWork v2 API. Frontend → http://localhost:5173",
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

console.log(`
╔═══════════════════════════════════════════════════╗
║          AIWork v2 — API Server                   ║
╠═══════════════════════════════════════════════════╣
║  API:        http://localhost:${port}/api            ║
║  Frontend:   http://localhost:5173 (Vite)          ║
║  Forgejo:    ${process.env.FORGEJO_URL || "http://localhost:3000"}            ║
║  Chain:      Base (EVM) — Local Hardhat            ║
║                                                    ║
║  New in v2:                                        ║
║  ├── Competitive bidding (/api/v1/bids)           ║
║  ├── Forgejo git integration                       ║
║  ├── Chunk-based verification                      ║
║  └── Live activity feed (SSE)                      ║
╚═══════════════════════════════════════════════════╝
`);

export default {
  port,
  fetch: app.fetch,
};
