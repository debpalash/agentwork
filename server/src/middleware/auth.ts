import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import { verifyMessage } from "viem";
import { pool } from "../db";
import type { AppEnv } from "../types";

const WALLET_MESSAGE_TTL_MS = 5 * 60_000;
const developmentReplayCache = new Map<string, number>();

type WalletRequest = {
  origin: string;
  chainId: number;
  method: string;
  path: string;
  bodySha256: string;
  issuedAt: number;
  nonce: string;
};

function decodeWalletMessage(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function parseWalletRequestMessage(message: string): WalletRequest | null {
  const lines = message.split("\n");
  if (lines.length !== 8 || lines[0] !== "AIWork request v2") return null;
  const fields = Object.fromEntries(lines.slice(1).map((line) => {
    const separator = line.indexOf(":");
    return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : ["", ""];
  }));
  const issuedAt = Date.parse(fields.issuedAt || "");
  const chainId = Number(fields.chainId);
  if (!fields.origin || !Number.isSafeInteger(chainId) || !Number.isFinite(issuedAt)) return null;
  return {
    origin: fields.origin!,
    chainId,
    method: fields.method!,
    path: fields.path!,
    bodySha256: fields.bodySha256!,
    issuedAt,
    nonce: fields.nonce!,
  };
}

async function validWalletRequestMessage(c: Context<AppEnv>, message: string): Promise<WalletRequest | null> {
  const request = parseWalletRequestMessage(message);
  if (!request) return null;
  const requestOrigin = c.req.header("Origin");
  const configuredOrigins = (process.env.AUTH_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3001")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  const expectedChainId = Number(process.env.CHAIN_ID || 31337);
  const bodySha256 = c.get("requestBodySha256")
    || createHash("sha256").update("").digest("hex");
  const valid = request.method === c.req.method.toUpperCase()
    && request.path === c.req.path
    && request.bodySha256 === bodySha256
    && request.chainId === expectedChainId
    && configuredOrigins.includes(request.origin)
    && (!requestOrigin || requestOrigin === request.origin)
    && /^[A-Za-z0-9._:-]{16,128}$/.test(request.nonce)
    && Math.abs(Date.now() - request.issuedAt) <= WALLET_MESSAGE_TTL_MS;
  return valid ? request : null;
}

async function consumeWalletNonce(wallet: string, signature: string, request: WalletRequest): Promise<boolean> {
  const signatureHash = createHash("sha256").update(signature).digest("hex");
  if (process.env.NODE_ENV !== "production") {
    const key = `${wallet.toLowerCase()}:${request.nonce}`;
    if (developmentReplayCache.has(key)) return false;
    developmentReplayCache.set(key, request.issuedAt + WALLET_MESSAGE_TTL_MS);
    return true;
  }
  const expiresAt = new Date(request.issuedAt + WALLET_MESSAGE_TTL_MS);
  const result = await pool.query(
    `INSERT INTO auth_replay_protection (signature_hash, wallet_address, nonce, expires_at)
     VALUES ($1, LOWER($2), $3, $4)
     ON CONFLICT DO NOTHING`,
    [signatureHash, wallet, request.nonce, expiresAt]
  );
  if (Math.random() < 0.01) {
    void pool.query("DELETE FROM auth_replay_protection WHERE expires_at < NOW()").catch(() => {});
  }
  return result.rowCount === 1;
}

// ─── API Key Authentication ───────────────────────────────────
// Supports two modes:
// 1. DB-backed scoped keys (aiwk_xxx) — validated via SHA-256 hash
// 2. Legacy env-based keys — for backwards compatibility
// ───────────────────────────────────────────────────────────────

// Legacy/dev API keys. In production we REFUSE to fall back to the dev key;
// keys must come from the API_KEYS env var (and ideally the DB-backed table).
const LEGACY_API_KEYS = (() => {
  const fromEnv = (process.env.API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (fromEnv.length > 0) return new Set(fromEnv);
  if (process.env.NODE_ENV === "production") {
    console.warn("[AUTH] No legacy API_KEYS configured; only DB-backed scoped keys and wallet signatures are accepted");
    return new Set<string>();
  }
  console.warn("[AUTH] Using DEV-ONLY fallback API key 'aiwork-dev-key-001' — never deploy this to production");
  return new Set(["aiwork-dev-key-001"]);
})();

/**
 * Auth middleware for protected routes.
 * Supports:
 * 1. API Key (Bearer token) — DB-backed or legacy
 * 2. Wallet Signature — for frontend users
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
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
          c.set("role", result.keyRecord?.scope || "agent");
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
      c.set("role", "admin");
      return next();
    }

    return c.json({ error: "Invalid API key" }, 401);
  }

  // Strategy 2: Wallet signature verification
  const walletAddress = c.req.header("X-Wallet-Address");
  const signature = c.req.header("X-Wallet-Signature");
  const encodedMessage = c.req.header("X-Wallet-Message");

  if (walletAddress && signature && encodedMessage) {
    try {
      const message = decodeWalletMessage(encodedMessage);
      if (!message) return c.json({ error: "Wallet message encoding is invalid" }, 401);
      const walletRequest = await validWalletRequestMessage(c, message);
      if (!walletRequest) {
        return c.json({ error: "Wallet signature message is expired or does not match this request" }, 401);
      }
      const valid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (valid) {
        if (!await consumeWalletNonce(walletAddress, signature, walletRequest)) {
          return c.json({ error: "Wallet request nonce has already been used" }, 401);
        }
        c.set("authMethod", "wallet");
        c.set("authenticated", true);
        c.set("walletAddress", walletAddress);
        try {
          const { pool } = await import("../db");
          const { rows } = await pool.query(
            "SELECT agent_id FROM agents WHERE LOWER(wallet_address) = LOWER($1) AND status = 'ACTIVE' LIMIT 1",
            [walletAddress]
          );
          if (rows.length > 0) {
            c.set("agentId", rows[0].agent_id);
            c.set("role", "agent");
          } else {
            c.set("role", "employer");
          }
        } catch {
          c.set("role", "employer");
        }
        return next();
      }
    } catch (err) {
      // Signature verification failed
    }
    return c.json({ error: "Invalid wallet signature" }, 401);
  }

  return c.json({ error: "Authentication required. Use Bearer token or wallet signature." }, 401);
}

/** Authenticate when credentials are present, while keeping public reads public. */
export async function optionalAuthMiddleware(c: Context<AppEnv>, next: Next) {
  const hasCredentials = !!c.req.header("Authorization")
    || !!c.req.header("X-Wallet-Signature")
    || !!c.req.header("X-Wallet-Message")
    || !!c.req.header("X-Wallet-Address");
  return hasCredentials ? authMiddleware(c, next) : next();
}

/**
 * Rate limiting middleware. Production uses a PostgreSQL shared window so API
 * replicas cannot independently reset the limit; development stays in memory.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || "60"); // 60 req/min

export async function rateLimitMiddleware(c: Context<AppEnv>, next: Next) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = process.env.TRUST_PROXY === "true"
    ? (forwarded || c.req.header("x-real-ip") || "unknown")
    : "direct";
  const now = Date.now();

  if (process.env.NODE_ENV === "production") {
    const windowStart = new Date(Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS);
    const { rows } = await pool.query(
      `INSERT INTO rate_limit_windows (limiter_key, window_start, request_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (limiter_key, window_start)
       DO UPDATE SET request_count = rate_limit_windows.request_count + 1
       RETURNING request_count`,
      [`ip:${ip}`, windowStart]
    );
    const count = Number(rows[0].request_count);
    c.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
    c.header("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX - count)));
    if (count > RATE_LIMIT_MAX) return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    if (Math.random() < 0.01) void pool.query("DELETE FROM rate_limit_windows WHERE window_start < NOW() - INTERVAL '10 minutes'").catch(() => {});
    return next();
  }

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

// Periodic cleanup must not keep command-line imports alive on its own.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap) {
    if (now > value.resetAt) rateLimitMap.delete(key);
  }
  for (const [key, expiresAt] of developmentReplayCache) {
    if (now > expiresAt) developmentReplayCache.delete(key);
  }
}, 300_000);
cleanupTimer.unref?.();
