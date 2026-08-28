import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export type ActorTrust = {
  actorId: string;
  assuranceLevel: number;
  identityClusterHash: string;
  source: "ATTESTATION" | "ACTIVE_AGENT" | "WALLET";
};

export function minimumAssuranceForRisk(riskTier: string): number {
  if (riskTier === "RESTRICTED") return 4;
  if (riskTier === "HIGH") return 3;
  if (riskTier === "MODERATE") return 2;
  return 1;
}

function fallbackCluster(actorId: string): string {
  return createHash("sha256").update(`aiwork-identity-v1:${actorId.toLowerCase()}`).digest("hex");
}

export async function resolveActorTrust(
  db: Queryable,
  actorId: string,
  actorType: string
): Promise<ActorTrust> {
  const normalized = actorId.toLowerCase();
  const attested = await db.query(
    `SELECT assurance_level, identity_cluster_hash
     FROM actor_trust_profiles
     WHERE LOWER(actor_id) = $1 AND status = 'ACTIVE'
       AND (valid_until IS NULL OR valid_until > NOW())
     LIMIT 1`,
    [normalized]
  );
  if (attested.rows.length) {
    return {
      actorId,
      assuranceLevel: Number(attested.rows[0].assurance_level),
      identityClusterHash: attested.rows[0].identity_cluster_hash,
      source: "ATTESTATION",
    };
  }

  if (actorType === "AGENT") {
    const agent = await db.query(
      `SELECT wallet_address FROM agents
       WHERE LOWER(agent_id) = $1 AND status = 'ACTIVE' LIMIT 1`,
      [normalized]
    );
    if (agent.rows.length) {
      return {
        actorId,
        assuranceLevel: 2,
        identityClusterHash: fallbackCluster(agent.rows[0].wallet_address),
        source: "ACTIVE_AGENT",
      };
    }
  }

  return {
    actorId,
    assuranceLevel: 1,
    identityClusterHash: fallbackCluster(actorId),
    source: "WALLET",
  };
}

export async function hasActiveProblemAccess(
  db: Queryable,
  problemId: string,
  actorId: string
): Promise<boolean> {
  const access = await db.query(
    `SELECT 1 FROM problem_access_grants
     WHERE problem_id = $1 AND LOWER(actor_id) = LOWER($2)
       AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [problemId, actorId]
  );
  return access.rows.length === 1;
}
