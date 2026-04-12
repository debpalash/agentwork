/**
 * API Key Service — Self-service key management for agents
 *
 * Agents register → get a scoped API key → use it for all platform access.
 * Keys are SHA-256 hashed before storage. The plaintext is returned ONCE on creation.
 */

import { createHash, randomBytes } from "crypto";
import { pool } from "../db";

const KEY_PREFIX = "aiwk_";

/**
 * Generate a new API key for an agent/wallet.
 * Returns the plaintext key ONLY ONCE — hash is stored in DB.
 */
export async function createApiKey(opts: {
  walletAddress: string;
  agentId?: string;
  label: string;
  scope?: "admin" | "agent" | "readonly";
  rateLimitPerMin?: number;
  expiresInDays?: number;
}): Promise<{ key: string; keyId: number; expiresAt: string | null }> {
  const rawKey = KEY_PREFIX + randomBytes(32).toString("hex");
  const keyHash = hashKey(rawKey);
  const expiresAt = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
    : null;

  const { rows } = await pool.query(
    `INSERT INTO api_keys (key_hash, label, agent_id, wallet_address, scope, rate_limit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      keyHash,
      opts.label,
      opts.agentId || null,
      opts.walletAddress,
      opts.scope || "agent",
      opts.rateLimitPerMin || 60,
      expiresAt,
    ]
  );

  return { key: rawKey, keyId: rows[0].id, expiresAt };
}

/**
 * Validate an API key — returns the key record if active and not expired.
 */
export async function validateApiKey(plainKey: string): Promise<{
  valid: boolean;
  keyRecord?: any;
}> {
  if (!plainKey.startsWith(KEY_PREFIX)) {
    return { valid: false };
  }

  const keyHash = hashKey(plainKey);
  const { rows } = await pool.query(
    `SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true`,
    [keyHash]
  );

  if (rows.length === 0) return { valid: false };

  const record = rows[0];

  // Check expiry
  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return { valid: false };
  }

  // Update last_used_at (non-blocking)
  pool.query(
    "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
    [record.id]
  ).catch(() => {});

  return { valid: true, keyRecord: record };
}

/**
 * List all keys for a wallet (hashes only — never expose plaintext).
 */
export async function listApiKeys(walletAddress: string) {
  const { rows } = await pool.query(
    `SELECT id, label, agent_id, scope, rate_limit, is_active, last_used_at, expires_at, created_at
     FROM api_keys WHERE wallet_address = $1 ORDER BY created_at DESC`,
    [walletAddress]
  );
  return rows;
}

/**
 * Revoke an API key by ID.
 */
export async function revokeApiKey(keyId: number, walletAddress: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE api_keys SET is_active = false WHERE id = $1 AND wallet_address = $2",
    [keyId, walletAddress]
  );
  return (rowCount || 0) > 0;
}

function hashKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex");
}
