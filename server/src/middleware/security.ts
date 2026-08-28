/**
 * Security Middleware — Audit logging, input sanitization, CSRF protection
 *
 * Every mutating operation (POST/PUT/DELETE) is recorded in audit_log.
 * Inputs receive structural, size, null-byte, and identifier validation.
 */

import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import type { AppEnv } from "../types";
import { pool } from "../db";

// ─── Audit Logger ──────────────────────────────────────────────
/**
 * Records every write operation for forensic analysis.
 * Non-blocking: fires and forgets to avoid latency.
 */
export async function auditMiddleware(c: Context, next: Next) {
  const startTime = Date.now();
  await next();

  // Only audit write operations
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const action = deriveAction(c.req.path, method);
  const actorId = c.get("walletAddress") || c.get("agentId") || "anonymous";
  const actorType = c.get("authMethod") === "wallet" ? "human" : "agent";

  // Fire and forget — don't block response
  pool
    .query(
      `INSERT INTO audit_log (action, actor_type, actor_id, resource_type, resource_id, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        action,
        actorType,
        actorId,
        deriveResourceType(c.req.path),
        c.req.param("taskId") || c.req.param("agentId") || null,
        c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "direct",
        (c.req.header("user-agent") || "").slice(0, 256),
        JSON.stringify({
          status: c.res.status,
          method,
          path: c.req.path,
          durationMs: Date.now() - startTime,
        }),
      ]
    )
    .catch((err) => console.warn("[AUDIT] Log failed:", err.message));
}

function deriveAction(path: string, method: string): string {
  if (path.includes("/award")) return "task.award";
  if (path.includes("/submit")) return "task.submit";
  if (path.includes("/register")) return "agent.register";
  if (path.includes("/activate")) return "agent.activate";
  if (path.includes("/bids")) return "bid.submit";
  if (path.includes("/tasks")) return method === "POST" ? "task.create" : "task.update";
  return `${method.toLowerCase()}.${path.split("/").pop()}`;
}

function deriveResourceType(path: string): string {
  if (path.includes("/tasks")) return "task";
  if (path.includes("/bids")) return "bid";
  if (path.includes("/agents")) return "agent";
  return "unknown";
}

// ─── Input Sanitization ────────────────────────────────────────
/**
 * Validates and sanitizes request bodies to prevent:
 * - Oversized inputs
 * - Invalid hex addresses
 */
const DANGEROUS_PATTERNS = [
  /\0/, // Null bytes
];

const MAX_STRING_LENGTH = 100_000;
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const TASK_ID_REGEX = /^0x[0-9a-fA-F]{64}$/;

export async function sanitizeMiddleware(c: Context, next: Next) {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();

  // Preserve a digest of the exact wire body before any parser consumes it.
  // Wallet authentication later binds its signature to this value.
  const rawBody = await c.req.raw.clone().text();
  c.set("requestBodySha256", createHash("sha256").update(rawBody).digest("hex"));

  // Check Content-Type for POST requests
  const contentType = c.req.header("content-type") || "";
  if (c.req.method === "POST" && !contentType.includes("application/json")) {
    // Allow empty body for actions like /award
    const raw = await c.req.text();
    if (raw.length > 0) {
      return c.json({ error: "Content-Type must be application/json" }, 415);
    }
    return next();
  }

  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return next(); // No body is OK for some endpoints

    // Check total payload size
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > 256_000) {
      return c.json({ error: "Request body too large (max 256KB)" }, 413);
    }

    // Recursive sanitization
    const issues = validateObject(body, "body");
    if (issues.length > 0) {
      return c.json(
        { error: "Input validation failed", details: issues },
        400
      );
    }
  } catch (err: any) {
    return c.json({ error: "Malformed request body" }, 400);
  }

  return next();
}

function validateObject(obj: any, path: string): string[] {
  const issues: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = `${path}.${key}`;

    if (typeof value === "string") {
      // Check length
      if (value.length > MAX_STRING_LENGTH) {
        issues.push(`${fieldPath}: exceeds max length (${MAX_STRING_LENGTH})`);
      }

      // Check for injection patterns
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(value)) {
          issues.push(`${fieldPath}: contains potentially dangerous content`);
          break;
        }
      }

      // Validate specific field formats
      if (
        (key === "walletAddress" || key === "agentAddress" || key === "paymentAddress") &&
        !WALLET_REGEX.test(value)
      ) {
        issues.push(`${fieldPath}: invalid wallet address format`);
      }

      if (key === "taskId" && value.startsWith("0x") && !TASK_ID_REGEX.test(value)) {
        issues.push(`${fieldPath}: invalid task ID format`);
      }
    } else if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        if (value.length > 100) {
          issues.push(`${fieldPath}: array too large (max 100 items)`);
        }
        value.forEach((item, i) => {
          if (typeof item === "object" && item !== null) {
            issues.push(...validateObject(item, `${fieldPath}[${i}]`));
          }
          if (typeof item === "string" && item.length > MAX_STRING_LENGTH) {
            issues.push(`${fieldPath}[${i}]: string exceeds max length`);
          }
        });
      } else {
        issues.push(...validateObject(value, fieldPath));
      }
    }
  }

  return issues;
}

// ─── Security Headers ──────────────────────────────────────────
export async function securityHeaders(c: Context, next: Next) {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  );
}

// ─── CORS hardening ────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost")
    .split(",")
    .map((s) => s.trim())
);

export async function corsMiddleware(c: Context, next: Next) {
  const origin = c.req.header("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // No Origin header → likely a non-browser client (CLI, curl, server-to-server).
    // Do NOT emit Access-Control-Allow-Origin: * — that previously let any browser
    // page in any tab issue authenticated cross-origin requests against us.
    // Non-browser clients ignore CORS headers, so they're unaffected.
  } else {
    // Unknown origin — block
    return c.json({ error: "CORS: origin not allowed" }, 403);
  }

  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wallet-Address, X-Wallet-Signature, X-Wallet-Message");
  c.header("Access-Control-Max-Age", "86400");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  return next();
}
