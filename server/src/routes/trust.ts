import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../db";
import { authMiddleware } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { resolveActorTrust } from "../services/trust";
import type { AppEnv } from "../types";

export const trustRoutes = new Hono<AppEnv>();
const digest = z.string().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());

const profileSchema = z.object({
  actorId: z.string().trim().min(1).max(128),
  actorType: z.enum(["HUMAN", "AGENT", "TEAM", "INSTITUTION", "PLATFORM"]),
  assuranceLevel: z.number().int().min(2).max(4),
  identityClusterHash: digest,
  evidenceDigest: digest,
  issuerId: z.string().trim().min(1).max(128),
  validUntil: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

trustRoutes.get("/me", authMiddleware, async (c) => {
  const actorId = c.get("agentId") || c.get("walletAddress");
  if (!actorId) return c.json({ error: "Wallet or agent identity required" }, 401);
  const trust = await resolveActorTrust(pool, actorId, c.get("agentId") ? "AGENT" : "HUMAN");
  return c.json({ actorId, assuranceLevel: trust.assuranceLevel, source: trust.source });
});

trustRoutes.post("/profiles", authMiddleware, requireRole("admin"), async (c) => {
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid trust profile", issues: parsed.error.issues }, 400);
  const input = parsed.data;
  if (input.validUntil && Date.parse(input.validUntil) <= Date.now()) {
    return c.json({ error: "validUntil must be in the future" }, 400);
  }
  const { rows } = await pool.query(
    `INSERT INTO actor_trust_profiles
       (actor_id, actor_type, assurance_level, identity_cluster_hash, issuer_id, evidence_digest, valid_until, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (actor_id) DO UPDATE SET
       actor_type = EXCLUDED.actor_type,
       assurance_level = EXCLUDED.assurance_level,
       identity_cluster_hash = EXCLUDED.identity_cluster_hash,
       issuer_id = EXCLUDED.issuer_id,
       evidence_digest = EXCLUDED.evidence_digest,
       valid_until = EXCLUDED.valid_until,
       metadata = EXCLUDED.metadata,
       status = 'ACTIVE',
       updated_at = NOW()
     RETURNING actor_id, actor_type, assurance_level, issuer_id, status, valid_until, created_at, updated_at`,
    [input.actorId, input.actorType, input.assuranceLevel, input.identityClusterHash, input.issuerId,
      input.evidenceDigest, input.validUntil || null, input.metadata]
  );
  await pool.query(
    `INSERT INTO governance_audit_log
       (event_type, actor_id, resource_type, resource_id, decision, evidence_digest, metadata)
     VALUES ('TRUST_PROFILE_ISSUED',$1,'ACTOR',$2,'ACTIVE',$3,$4)`,
    [c.get("walletAddress") || "platform", input.actorId, input.evidenceDigest,
      { assuranceLevel: input.assuranceLevel, issuerId: input.issuerId, auditId: randomUUID() }]
  );
  return c.json({ profile: rows[0] }, 201);
});

trustRoutes.post("/profiles/:actorId/revoke", authMiddleware, requireRole("admin"), async (c) => {
  const actorId = c.req.param("actorId");
  const { rows } = await pool.query(
    `UPDATE actor_trust_profiles SET status = 'REVOKED', updated_at = NOW()
     WHERE LOWER(actor_id) = LOWER($1) AND status <> 'REVOKED'
     RETURNING actor_id, actor_type, assurance_level, issuer_id, status, valid_until, updated_at`,
    [actorId]
  );
  if (!rows.length) return c.json({ error: "Active trust profile not found" }, 404);
  await pool.query(
    `INSERT INTO governance_audit_log
       (event_type, actor_id, resource_type, resource_id, decision)
     VALUES ('TRUST_PROFILE_REVOKED',$1,'ACTOR',$2,'REVOKED')`,
    [c.get("walletAddress") || "platform", actorId]
  );
  return c.json({ profile: rows[0] });
});
