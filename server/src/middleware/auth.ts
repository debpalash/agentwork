import { Context, Next } from "hono";
import { verifyMessage } from "viem";

// ─── API Key Authentication ───────────────────────────────────
// Supports two modes:
// 1. DB-backed scoped keys (aiwk_xxx) — validated via SHA-256 hash
// 2. Legacy env-based keys — for backwards compatibility
// ───────────────────────────────────────────────────────────────

const LEGACY_API_KEYS = new Set(
  (process.env.API_KEYS || "aiwork-dev-key-001").split(",").map((k) => k.trim())
);

/**
 * Auth middleware for protected routes.
 * Supports:
 * 1. API Key (Bearer token) — DB-backed or legacy
 * 2. Wallet Signature — for frontend users
 */
export async function authMiddleware(c: Context, next: Next) {
  // Strategy 1: Bearer API Key
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);

    // Try DB-backed keys first (aiwk_ prefix)
    if (key.startsWith("aiwk_")) {
      try {
        const { validateApiKey } = await import("../services/apikeys");
        const result = await validateApiKey(key);
        if (result.valid) {
          c.set("authMethod", "api_key");
          c.set("authenticated", true);
          c.set("agentId", result.keyRecord?.agent_id);
          c.set("walletAddress", result.keyRecord?.wallet_address);
          c.set("scope", result.keyRecord?.scope || "agent");
          return next();
        }
      } catch (_) {}
      return c.json({ error: "Invalid or expired API key" }, 401);
    }

    // Fallback: legacy env-based keys
    if (LEGACY_API_KEYS.has(key)) {
      c.set("authMethod", "api_key_legacy");
      c.set("authenticated", true);
      c.set("scope", "admin");
      return next();
    }

    return c.json({ error: "Invalid API key" }, 401);
  }

  // Strategy 2: Wallet signature verification
  const walletAddress = c.req.header("X-Wallet-Address");
  const signature = c.req.header("X-Wallet-Signature");
  const message = c.req.header("X-Wallet-Message");

  if (walletAddress && signature && message) {
    try {
      const valid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (valid) {
        c.set("authMethod", "wallet");
        c.set("authenticated", true);
        c.set("walletAddress", walletAddress);
        return next();
      }
    } catch (err) {
      // Signature verification failed
    }
    return c.json({ error: "Invalid wallet signature" }, 401);
  }

  return c.json({ error: "Authentication required. Use Bearer token or wallet signature." }, 401);
}

/**
 * Rate limiting middleware — simple in-memory sliding window.
 * Production should use Redis for distributed rate limiting.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || "60"); // 60 req/min

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  c.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  c.header("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX - entry.count)));

  if (entry.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
  }

  return next();
}

// Periodic cleanup of rate limit map (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap) {
    if (now > value.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);
