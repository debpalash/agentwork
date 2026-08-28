import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { pool, insertActivity } from "../db";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { hasActiveProblemAccess, minimumAssuranceForRisk, resolveActorTrust } from "../services/trust";
import type { AppEnv } from "../types";

export const problemRoutes = new Hono<AppEnv>();

const actorTypes = ["HUMAN", "AGENT", "TEAM", "INSTITUTION", "PLATFORM"] as const;
const domains = ["SOFTWARE", "MATHEMATICS", "DATA", "AI_ML", "RESEARCH", "BIOMEDICAL", "CLIMATE", "ENGINEERING", "POLICY", "OTHER"] as const;
const fundingMechanisms = ["GRANT", "MILESTONE", "PRIZE", "REPLICATION_BOUNTY", "RETROACTIVE"] as const;
const digest = z.string().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());
const jsonObject = z.record(z.string(), z.unknown());
const ethicsDefaults = {
  humanSubjects: false,
  sensitiveData: false,
  dualUse: false,
  institutionalApprovalRequired: false,
  consentBasis: "NOT_APPLICABLE" as const,
  dataClassification: "PUBLIC" as const,
  securityStandard: "NONE" as const,
  highRiskLifeSciences: "NONE" as const,
  jurisdiction: "UNSPECIFIED",
  requirements: [] as string[],
};

const verificationPolicySchema = z.object({
  mode: z.enum(["CODE", "FORMAL_PROOF", "REPRODUCIBLE_RESEARCH", "EXPERT_PANEL", "HYBRID"]),
  minimumIndependentReviews: z.number().int().min(1).max(25),
  replicationRequired: z.boolean(),
  minimumReplications: z.number().int().min(0).max(25).default(0),
  artifactRequirements: z.array(z.enum(["SOURCE", "DATA", "METHODS", "ENVIRONMENT", "RESULTS", "LICENSE", "ETHICS_APPROVAL"])).max(20).default([]),
  acceptanceCriteria: z.array(z.string().trim().min(5).max(1000)).min(1).max(50),
}).strict();

const problemSchema = z.object({
  version: z.literal("1.0"),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180).optional(),
  title: z.string().trim().min(8).max(180),
  summary: z.string().trim().min(20).max(500),
  description: z.string().trim().min(50).max(50_000),
  domain: z.enum(domains),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "RESTRICTED"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  license: z.string().trim().min(1).max(80),
  funding: z.object({
    amount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).optional(),
    token: z.string().trim().max(80).optional(),
    mechanisms: z.array(z.enum(fundingMechanisms)).max(1).default([]),
  }).strict().default({ mechanisms: [] }),
  verificationPolicy: verificationPolicySchema,
  governance: z.object({
    reviewerSelection: z.enum(["RANDOM_CREDENTIALLED", "COMMUNITY", "INSTITUTIONAL", "HYBRID"]).default("HYBRID"),
    appealsAllowed: z.boolean().default(true),
    conflictDisclosureRequired: z.boolean().default(true),
  }).strict().default({ reviewerSelection: "HYBRID", appealsAllowed: true, conflictDisclosureRequired: true }),
  ethics: z.object({
    humanSubjects: z.boolean().default(false),
    sensitiveData: z.boolean().default(false),
    dualUse: z.boolean().default(false),
    institutionalApprovalRequired: z.boolean().default(false),
    consentBasis: z.enum(["INFORMED_CONSENT", "IRB_WAIVER", "SECONDARY_USE_APPROVED", "NOT_APPLICABLE"]).default("NOT_APPLICABLE"),
    dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONTROLLED", "RESTRICTED"]).default("PUBLIC"),
    securityStandard: z.enum(["NONE", "NIST_800_171", "NIST_800_53_MODERATE", "ISO_27001", "EQUIVALENT"]).default("NONE"),
    highRiskLifeSciences: z.enum(["NONE", "POTENTIAL_DGOF", "DGOF", "IROC"]).default("NONE"),
    jurisdiction: z.string().trim().min(2).max(120).default("UNSPECIFIED"),
    dataUseAgreementDigest: digest.optional(),
    mitigationPlanDigest: digest.optional(),
    requirements: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  }).strict().default(ethicsDefaults),
  metadata: jsonObject.default({}),
}).strict().superRefine((value, context) => {
  if (value.funding.amount && Number(value.funding.amount) <= 0) {
    context.addIssue({ code: "custom", path: ["funding", "amount"], message: "Funding amount must be greater than zero" });
  }
  if (value.funding.amount && (!value.funding.token || value.funding.mechanisms.length !== 1)) {
    context.addIssue({ code: "custom", path: ["funding"], message: "A funded charter requires one token and one funding mechanism" });
  }
});

const fundingPledgeSchema = z.object({
  mechanism: z.enum(fundingMechanisms),
  token: z.string().trim().min(1).max(80),
  committedAmount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).refine((value) => Number(value) > 0, "Committed amount must be greater than zero"),
  escrowReference: z.string().trim().min(3).max(256).optional(),
}).strict();

const workstreamSchema = z.object({
  title: z.string().trim().min(5).max(180),
  description: z.string().trim().min(20).max(20_000),
  dependencies: z.array(z.string().uuid()).max(50).default([]),
  budget: jsonObject.default({}),
  acceptancePolicy: jsonObject.default({}),
  metadata: jsonObject.default({}),
}).strict();

const provenanceSchema = z.object({
  generatedAt: z.string().datetime(),
  generatedBy: z.array(z.object({ id: z.string().min(1).max(256), type: z.enum(actorTypes), role: z.string().max(80).optional() }).strict()).min(1).max(100),
  inputs: z.array(z.object({ uri: z.string().min(1).max(2000), digest: digest.optional() }).strict()).max(500).default([]),
  environment: jsonObject,
}).strict();

const contributionSchema = z.object({
  workstreamId: z.string().uuid().optional(),
  title: z.string().trim().min(5).max(180),
  summary: z.string().trim().min(20).max(20_000),
  artifactUri: z.string().trim().min(1).max(4000),
  artifactDigest: digest,
  artifactType: z.enum(["CODE", "PROOF", "DATASET", "MODEL", "PAPER", "PROTOCOL", "EXPERIMENT", "ANALYSIS", "REVIEW", "NEGATIVE_RESULT", "OTHER"]),
  license: z.string().trim().min(1).max(80),
  provenance: provenanceSchema,
  metadata: jsonObject.default({}),
}).strict();

const evidenceSchema = z.object({
  subjectContributionId: z.string().uuid().optional(),
  evidenceType: z.enum(["SUPPORTS", "REFUTES", "REPLICATES", "REVIEWS", "BENCHMARKS"]),
  uri: z.string().trim().min(1).max(4000),
  digest,
  confidence: z.number().min(0).max(1).optional(),
  methodology: jsonObject,
  provenance: provenanceSchema,
}).strict();

const reviewSchema = z.object({
  reviewerType: z.enum(["HUMAN", "AGENT", "INSTITUTION"]),
  verdict: z.enum(["ACCEPT", "REVISE", "REJECT", "ABSTAIN"]),
  score: z.number().int().min(0).max(100).optional(),
  rationale: z.string().trim().min(20).max(20_000),
  conflictDisclosure: z.object({
    hasConflict: z.boolean(),
    details: z.string().trim().max(2000).default(""),
  }).strict(),
  attestation: jsonObject.default({}),
}).strict();

const approvalSchema = z.object({
  approvalType: z.enum(["IRB", "IRB_EXEMPTION", "IBC", "DATA_ACCESS", "BIOSECURITY", "LEGAL", "SECURITY", "ETHICS"]),
  authorityName: z.string().trim().min(2).max(300),
  authorityIdentifier: z.string().trim().min(2).max(200),
  protocolReference: z.string().trim().min(2).max(200),
  documentDigest: digest,
  decision: z.enum(["APPROVED", "DENIED", "SUSPENDED", "EXPIRED"]),
  scope: jsonObject.default({}),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
}).strict();

const accessGrantSchema = z.object({
  actorId: z.string().trim().min(1).max(128),
  purpose: z.string().trim().min(20).max(10_000),
  termsDigest: digest,
  expiresAt: z.string().datetime(),
}).strict();

function creditRoleForArtifact(artifactType: string): string {
  return ({
    CODE: "SOFTWARE",
    PROOF: "FORMAL_ANALYSIS",
    DATASET: "DATA_CURATION",
    MODEL: "FORMAL_ANALYSIS",
    PAPER: "WRITING_ORIGINAL",
    PROTOCOL: "METHODOLOGY",
    EXPERIMENT: "INVESTIGATION",
    ANALYSIS: "FORMAL_ANALYSIS",
    REVIEW: "WRITING_REVIEW",
    NEGATIVE_RESULT: "INVESTIGATION",
  } as Record<string, string>)[artifactType] || "OTHER";
}

function actor(c: any): { id: string; type: typeof actorTypes[number] } | null {
  if (c.get("role") === "admin") return { id: c.get("walletAddress") || "platform", type: "PLATFORM" };
  // A wallet-authenticated browser user acts as a human even when the same
  // wallet also owns a registered agent. API-key calls continue to act as the
  // registered agent. Identity and product role are separate concerns.
  if (c.get("authMethod") === "wallet" && c.get("walletAddress")) {
    return { id: c.get("walletAddress").toLowerCase(), type: "HUMAN" };
  }
  if (c.get("agentId")) return { id: c.get("agentId"), type: "AGENT" };
  if (c.get("walletAddress")) return { id: c.get("walletAddress").toLowerCase(), type: "HUMAN" };
  return null;
}

async function parseBody<T>(c: any, schema: z.ZodType<T>): Promise<{ data?: T; response?: Response }> {
  try {
    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
      return { response: c.json({ error: "Invalid request", issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400) };
    }
    return { data: result.data };
  } catch {
    return { response: c.json({ error: "Request body must be valid JSON" }, 400) };
  }
}

function contentDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeSlug(title: string, id: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 165) || "problem";
  return `${base}-${id.slice(0, 8)}`;
}

function requiredApprovals(problem: { domain: string; ethics: any }): string[][] {
  const requirements: string[][] = [];
  if (problem.ethics?.humanSubjects) requirements.push(["IRB", "IRB_EXEMPTION"]);
  if (problem.ethics?.sensitiveData) requirements.push(["DATA_ACCESS"], ["SECURITY"]);
  if (problem.ethics?.dualUse || problem.ethics?.highRiskLifeSciences === "POTENTIAL_DGOF") {
    requirements.push(["BIOSECURITY"]);
  }
  if (problem.domain === "BIOMEDICAL" || problem.ethics?.institutionalApprovalRequired) {
    requirements.push(["ETHICS"]);
  }
  return requirements;
}

async function evaluateGovernance(problemId: string): Promise<{ ready: boolean; missing: string[][]; blocked: boolean }> {
  const problem = await pool.query("SELECT domain, ethics, status FROM problems WHERE id = $1", [problemId]);
  if (!problem.rows.length) return { ready: false, missing: [], blocked: true };
  const row = problem.rows[0];
  const approvals = await pool.query(
    `SELECT approval_type, decision FROM institutional_approvals
     WHERE problem_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [problemId]
  );
  const blocked = approvals.rows.some((approval) => ["DENIED", "SUSPENDED"].includes(approval.decision))
    || ["DGOF", "IROC"].includes(row.ethics?.highRiskLifeSciences);
  const approvedTypes = new Set(
    approvals.rows.filter((approval) => approval.decision === "APPROVED").map((approval) => approval.approval_type)
  );
  const missing = requiredApprovals(row).filter((alternatives) => !alternatives.some((type) => approvedTypes.has(type)));
  const ready = !blocked && missing.length === 0;
  if (row.status === "QUARANTINED" && ready) {
    await pool.query("UPDATE problems SET status = 'OPEN', updated_at = NOW() WHERE id = $1", [problemId]);
  } else if (row.status !== "QUARANTINED" && !ready && requiredApprovals(row).length > 0) {
    await pool.query("UPDATE problems SET status = 'QUARANTINED', updated_at = NOW() WHERE id = $1", [problemId]);
  }
  return { ready, missing, blocked };
}

async function canViewProblem(c: any, row: any): Promise<boolean> {
  if (row.visibility !== "PRIVATE") return true;
  if (c.get("role") === "admin") return true;
  const viewer = actor(c);
  if (!viewer) return false;
  if (viewer.id.toLowerCase() === row.funder_id.toLowerCase()) return true;
  return hasActiveProblemAccess(pool, row.id, viewer.id);
}

function problemView(row: any) {
  return {
    id: row.id,
    version: row.spec_version,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    domain: row.domain,
    status: row.status,
    visibility: row.visibility,
    riskTier: row.risk_tier,
    funderId: row.funder_id,
    funderType: row.funder_type,
    license: row.license,
    tags: row.tags || [],
    funding: row.funding || {},
    verificationPolicy: row.verification_policy,
    governance: row.governance || {},
    ethics: row.ethics || {},
    metadata: row.metadata || {},
    contentDigest: row.content_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

problemRoutes.get("/", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 20) || 20));
  const domain = c.req.query("domain");
  const status = c.req.query("status") || "OPEN";
  const cursor = c.req.query("cursor");
  if (domain && !domains.includes(domain as any)) return c.json({ error: "Invalid domain" }, 400);
  if (!["OPEN", "ACTIVE", "REVIEW", "COMPLETED", "ALL"].includes(status)) return c.json({ error: "Invalid status" }, 400);
  if (cursor && Number.isNaN(Date.parse(cursor))) return c.json({ error: "cursor must be an ISO timestamp" }, 400);

  const values: unknown[] = [];
  const clauses = ["visibility = 'PUBLIC'"];
  if (status !== "ALL") { values.push(status); clauses.push(`status = $${values.length}`); }
  else clauses.push("status IN ('OPEN', 'ACTIVE', 'REVIEW', 'COMPLETED')");
  if (domain) { values.push(domain); clauses.push(`domain = $${values.length}`); }
  if (cursor) { values.push(cursor); clauses.push(`created_at < $${values.length}`); }
  values.push(limit + 1);
  const { rows } = await pool.query(
    `SELECT * FROM problems WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return c.json({ problems: page.map(problemView), hasMore, nextCursor: hasMore ? page.at(-1)?.created_at : null });
});

problemRoutes.post("/", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, problemSchema);
  if (parsed.response) return parsed.response;
  const spec = parsed.data!;
  const owner = actor(c);
  if (!owner) return c.json({ error: "A verified wallet or agent identity is required" }, 401);

  const sensitive = spec.domain === "BIOMEDICAL" || spec.ethics.humanSubjects || spec.ethics.sensitiveData || spec.ethics.dualUse;
  if (spec.domain === "BIOMEDICAL" && !["HIGH", "RESTRICTED"].includes(spec.riskTier)) {
    return c.json({ error: "Biomedical problems must use HIGH or RESTRICTED risk classification" }, 400);
  }
  if (spec.domain === "BIOMEDICAL" && !spec.ethics.institutionalApprovalRequired) {
    return c.json({ error: "Biomedical problems must require institutional approval" }, 400);
  }
  if (["DGOF", "IROC"].includes(spec.ethics.highRiskLifeSciences)) {
    return c.json({ error: "This high-risk life-sciences category is prohibited from being posted or funded on Collagent" }, 403);
  }
  if (spec.ethics.humanSubjects && (!spec.ethics.institutionalApprovalRequired || spec.ethics.consentBasis === "NOT_APPLICABLE")) {
    return c.json({ error: "Human-subjects research requires institutional oversight and a declared consent or waiver basis" }, 400);
  }
  if (spec.ethics.sensitiveData && (
    spec.visibility !== "PRIVATE"
    || !["CONTROLLED", "RESTRICTED"].includes(spec.ethics.dataClassification)
    || spec.ethics.securityStandard === "NONE"
    || !spec.ethics.dataUseAgreementDigest
  )) {
    return c.json({ error: "Sensitive data requires PRIVATE visibility, controlled/restricted classification, a security standard, and a data-use agreement digest" }, 400);
  }
  if (spec.ethics.dualUse && !spec.ethics.mitigationPlanDigest) {
    return c.json({ error: "Dual-use research requires a mitigation plan digest" }, 400);
  }
  if (spec.domain === "BIOMEDICAL" && (
    spec.verificationPolicy.minimumIndependentReviews < 3
    || !spec.verificationPolicy.replicationRequired
    || spec.verificationPolicy.minimumReplications < 2
  )) {
    return c.json({ error: "Biomedical problems require at least three independent reviews and two independent replications" }, 400);
  }
  const id = randomUUID();
  const slug = spec.slug || makeSlug(spec.title, id);
  // Funding or administrator status can never bypass institutional gates.
  const status = sensitive ? "QUARANTINED" : "OPEN";
  const normalized = { ...spec, slug };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO problems
       (id, spec_version, slug, title, summary, description, domain, status, visibility, risk_tier, funder_id, funder_type, license, tags, funding, verification_policy, governance, ethics, metadata, content_digest)
       VALUES ($1, '1.0', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [id, slug, spec.title, spec.summary, spec.description, spec.domain, status, spec.visibility, spec.riskTier, owner.id, owner.type, spec.license, spec.tags, spec.funding, spec.verificationPolicy, spec.governance, spec.ethics, spec.metadata, contentDigest(normalized)]
    );
    if (spec.funding.amount && spec.funding.token && spec.funding.mechanisms[0]) {
      await client.query(
        `INSERT INTO funding_pools
         (id, problem_id, funder_id, mechanism, token, committed_amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,'PLEDGED')`,
        [randomUUID(), id, owner.id, spec.funding.mechanisms[0], spec.funding.token, spec.funding.amount]
      );
    }
    await client.query("COMMIT");
    await insertActivity({ type: "problem", agent: owner.id, taskId: id, message: `opened problem: ${spec.title}` });
    return c.json({ problem: problemView(rows[0]), safetyReviewRequired: status === "QUARANTINED" }, 201);
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return c.json({ error: "Problem slug already exists" }, 409);
    throw error;
  } finally { client.release(); }
});

problemRoutes.post("/:id/governance/approvals", authMiddleware, requireRole("admin"), async (c) => {
  const parsed = await parseBody(c, approvalSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const problemId = c.req.param("id")!;
  if (Date.parse(input.issuedAt) > Date.now()) return c.json({ error: "issuedAt cannot be in the future" }, 400);
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) {
    return c.json({ error: "expiresAt must be after issuedAt" }, 400);
  }
  const problem = await pool.query("SELECT 1 FROM problems WHERE id = $1", [problemId]);
  if (!problem.rowCount) return c.json({ error: "Problem not found" }, 404);
  const id = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO institutional_approvals
       (id, problem_id, approval_type, authority_name, authority_identifier, protocol_reference,
        document_digest, decision, scope, issued_at, expires_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, problemId, input.approvalType, input.authorityName, input.authorityIdentifier,
        input.protocolReference, input.documentDigest, input.decision, input.scope,
        input.issuedAt, input.expiresAt || null, c.get("walletAddress") || "platform"]
    );
    await pool.query(
      `INSERT INTO governance_audit_log
       (event_type, actor_id, resource_type, resource_id, decision, evidence_digest, metadata)
       VALUES ('INSTITUTIONAL_APPROVAL_RECORDED',$1,'PROBLEM',$2,$3,$4,$5)`,
      [c.get("walletAddress") || "platform", problemId, input.decision, input.documentDigest,
        { approvalType: input.approvalType, authorityIdentifier: input.authorityIdentifier }]
    );
    const governance = await evaluateGovernance(problemId);
    return c.json({ approval: rows[0], governance }, 201);
  } catch (error: any) {
    if (error.code === "23505") return c.json({ error: "This institutional decision is already recorded" }, 409);
    throw error;
  }
});

problemRoutes.post("/:id/governance/access", authMiddleware, requireRole("admin"), async (c) => {
  const parsed = await parseBody(c, accessGrantSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  if (Date.parse(input.expiresAt) <= Date.now()) return c.json({ error: "expiresAt must be in the future" }, 400);
  const problemId = c.req.param("id")!;
  const problem = await pool.query("SELECT risk_tier, ethics FROM problems WHERE id = $1", [problemId]);
  if (!problem.rowCount) return c.json({ error: "Problem not found" }, 404);
  const trust = await resolveActorTrust(pool, input.actorId, "HUMAN");
  const requiredAssurance = minimumAssuranceForRisk(problem.rows[0].risk_tier);
  if (trust.assuranceLevel < requiredAssurance) {
    return c.json({ error: `Actor assurance level ${trust.assuranceLevel} is below required level ${requiredAssurance}` }, 409);
  }
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO problem_access_grants
       (id, problem_id, actor_id, purpose, terms_digest, approved_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (problem_id, actor_id) DO UPDATE SET
       purpose = EXCLUDED.purpose, terms_digest = EXCLUDED.terms_digest,
       approved_by = EXCLUDED.approved_by, issued_at = NOW(),
       expires_at = EXCLUDED.expires_at, revoked_at = NULL
     RETURNING *`,
    [id, problemId, input.actorId, input.purpose, input.termsDigest,
      c.get("walletAddress") || "platform", input.expiresAt]
  );
  await pool.query(
    `INSERT INTO governance_audit_log
       (event_type, actor_id, resource_type, resource_id, decision, evidence_digest, metadata)
     VALUES ('CONTROLLED_ACCESS_GRANTED',$1,'PROBLEM',$2,'APPROVED',$3,$4)`,
    [c.get("walletAddress") || "platform", problemId, input.termsDigest,
      { grantee: input.actorId, expiresAt: input.expiresAt }]
  );
  return c.json({ grant: rows[0] }, 201);
});

problemRoutes.get("/:id/governance", optionalAuthMiddleware, async (c) => {
  const problemId = c.req.param("id")!;
  const problem = await pool.query("SELECT * FROM problems WHERE id = $1", [problemId]);
  if (!problem.rowCount || !await canViewProblem(c, problem.rows[0])) return c.json({ error: "Problem not found" }, 404);
  const governance = await evaluateGovernance(problemId);
  const approvals = await pool.query(
    `SELECT id, approval_type, authority_name, authority_identifier, protocol_reference,
            document_digest, decision, scope, issued_at, expires_at, created_at
     FROM institutional_approvals WHERE problem_id = $1 ORDER BY created_at DESC`,
    [problemId]
  );
  return c.json({ governance, approvals: approvals.rows });
});

problemRoutes.post("/:id/funding", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, fundingPledgeSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const funder = actor(c);
  if (!funder) return c.json({ error: "Verified funder identity required" }, 401);
  const problemId = c.req.param("id")!;
  const problem = await pool.query("SELECT title, status FROM problems WHERE id = $1", [problemId]);
  if (!problem.rowCount) return c.json({ error: "Problem not found" }, 404);
  if (["COMPLETED", "CANCELLED"].includes(problem.rows[0].status)) {
    return c.json({ error: `Problem does not accept funding pledges while ${problem.rows[0].status}` }, 409);
  }
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO funding_pools
     (id, problem_id, funder_id, mechanism, token, committed_amount, escrow_reference, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PLEDGED') RETURNING *`,
    [id, problemId, funder.id, input.mechanism, input.token, input.committedAmount, input.escrowReference || null]
  );
  await insertActivity({
    type: "funding",
    agent: funder.id,
    taskId: problemId,
    message: `recorded ${input.committedAmount} ${input.token} pledge for: ${problem.rows[0].title}`,
  });
  return c.json({ fundingPool: rows[0], settlement: "PLEDGE_RECORDED_NOT_ESCROWED" }, 201);
});

problemRoutes.post("/:id/workstreams", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, workstreamSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const creator = actor(c);
  if (!creator) return c.json({ error: "Verified contributor identity required" }, 401);
  const problemId = c.req.param("id")!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const problem = await client.query("SELECT status, domain, risk_tier, ethics FROM problems WHERE id = $1 FOR SHARE", [problemId]);
    if (!problem.rowCount) { await client.query("ROLLBACK"); return c.json({ error: "Problem not found" }, 404); }
    if (["CANCELLED", "COMPLETED", "QUARANTINED"].includes(problem.rows[0].status)) { await client.query("ROLLBACK"); return c.json({ error: `Problem does not accept workstreams while ${problem.rows[0].status}` }, 409); }
    if (requiredApprovals(problem.rows[0]).length > 0) {
      const governance = await evaluateGovernance(problemId);
      if (!governance.ready) {
        await client.query("ROLLBACK");
        return c.json({ error: "Institutional governance is not active", governance }, 409);
      }
    }
    const creatorTrust = await resolveActorTrust(client, creator.id, creator.type);
    const requiredAssurance = minimumAssuranceForRisk(problem.rows[0].risk_tier);
    if (creatorTrust.assuranceLevel < requiredAssurance) {
      await client.query("ROLLBACK");
      return c.json({ error: `Creator assurance level ${creatorTrust.assuranceLevel} is below required level ${requiredAssurance}` }, 403);
    }
    if (problem.rows[0].ethics?.sensitiveData && !await hasActiveProblemAccess(client, problemId, creator.id)) {
      await client.query("ROLLBACK");
      return c.json({ error: "An active purpose-bound data access grant is required" }, 403);
    }
    if (input.dependencies.length) {
      const deps = await client.query("SELECT id FROM workstreams WHERE problem_id = $1 AND id = ANY($2::uuid[])", [problemId, input.dependencies]);
      if (deps.rowCount !== input.dependencies.length) { await client.query("ROLLBACK"); return c.json({ error: "Every dependency must belong to this problem" }, 400); }
    }
    const id = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO workstreams (id, problem_id, title, description, creator_id, creator_type, budget, acceptance_policy, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, problemId, input.title, input.description, creator.id, creator.type, input.budget, input.acceptancePolicy, input.metadata]
    );
    for (const dependency of input.dependencies) {
      await client.query("INSERT INTO workstream_dependencies (workstream_id, depends_on_id) VALUES ($1,$2)", [id, dependency]);
    }
    await client.query("COMMIT");
    return c.json({ workstream: { ...rows[0], dependencies: input.dependencies } }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
});

problemRoutes.post("/:id/contributions", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, contributionSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const contributor = actor(c);
  if (!contributor || contributor.type === "PLATFORM") return c.json({ error: "Human or agent contributor identity required" }, 401);
  const problemId = c.req.param("id")!;
  const { rows: problemRows } = await pool.query("SELECT status, risk_tier, ethics FROM problems WHERE id = $1", [problemId]);
  if (!problemRows.length) return c.json({ error: "Problem not found" }, 404);
  if (requiredApprovals({ domain: "", ethics: problemRows[0].ethics }).length > 0) {
    const governance = await evaluateGovernance(problemId);
    if (!governance.ready) return c.json({ error: "Institutional governance is not active", governance }, 409);
  }
  if (!['OPEN', 'ACTIVE', 'REVIEW'].includes(problemRows[0].status)) return c.json({ error: "Problem is not accepting contributions" }, 409);
  const contributorTrust = await resolveActorTrust(pool, contributor.id, contributor.type);
  const requiredAssurance = minimumAssuranceForRisk(problemRows[0].risk_tier);
  if (contributorTrust.assuranceLevel < requiredAssurance) {
    return c.json({ error: `Contributor assurance level ${contributorTrust.assuranceLevel} is below required level ${requiredAssurance}` }, 403);
  }
  if (problemRows[0].ethics?.sensitiveData && !await hasActiveProblemAccess(pool, problemId, contributor.id)) {
    return c.json({ error: "An active purpose-bound data access grant is required" }, 403);
  }
  if (input.workstreamId) {
    const ws = await pool.query("SELECT 1 FROM workstreams WHERE id = $1 AND problem_id = $2", [input.workstreamId, problemId]);
    if (!ws.rowCount) return c.json({ error: "Workstream does not belong to this problem" }, 400);
  }
  if (!input.provenance.generatedBy.some((entry) => entry.id.toLowerCase() === contributor.id.toLowerCase())) {
    return c.json({ error: "Provenance generatedBy must include the authenticated contributor" }, 400);
  }
  const id = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO contributions
       (id, problem_id, workstream_id, contributor_id, contributor_type, title, summary, artifact_uri, artifact_digest, artifact_type, license, provenance, metadata, contributor_assurance_level, contributor_identity_cluster_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, problemId, input.workstreamId || null, contributor.id, contributor.type, input.title, input.summary, input.artifactUri, input.artifactDigest, input.artifactType, input.license, input.provenance, input.metadata, contributorTrust.assuranceLevel, contributorTrust.identityClusterHash]
    );
    return c.json({ contribution: rows[0] }, 201);
  } catch (error: any) {
    if (error.code === "23505") return c.json({ error: "This artifact digest is already registered for the problem" }, 409);
    throw error;
  }
});

problemRoutes.post("/contributions/:contributionId/evidence", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, evidenceSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const submitter = actor(c);
  if (!submitter) return c.json({ error: "Verified submitter identity required" }, 401);
  const contributionId = c.req.param("contributionId");
  const { rows: contributions } = await pool.query(
    `SELECT c.problem_id, c.contributor_identity_cluster_hash, p.risk_tier, p.ethics
     FROM contributions c JOIN problems p ON p.id = c.problem_id WHERE c.id = $1`,
    [contributionId]
  );
  if (!contributions.length) return c.json({ error: "Contribution not found" }, 404);
  if (requiredApprovals({ domain: "", ethics: contributions[0].ethics }).length > 0) {
    const governance = await evaluateGovernance(contributions[0].problem_id);
    if (!governance.ready) return c.json({ error: "Institutional governance is not active", governance }, 409);
  }
  const submitterTrust = await resolveActorTrust(pool, submitter.id, submitter.type);
  const evidenceAssurance = minimumAssuranceForRisk(contributions[0].risk_tier);
  if (submitterTrust.assuranceLevel < evidenceAssurance) {
    return c.json({ error: `Evidence submitter assurance level ${submitterTrust.assuranceLevel} is below required level ${evidenceAssurance}` }, 403);
  }
  if (!input.provenance.generatedBy.some((entry) => entry.id.toLowerCase() === submitter.id.toLowerCase())) {
    return c.json({ error: "Evidence provenance generatedBy must include the authenticated submitter" }, 400);
  }
  if (input.evidenceType === "REPLICATES" && submitterTrust.identityClusterHash === contributions[0].contributor_identity_cluster_hash) {
    return c.json({ error: "A contributor identity cluster cannot independently replicate its own artifact" }, 409);
  }
  if (contributions[0].ethics?.sensitiveData && !await hasActiveProblemAccess(pool, contributions[0].problem_id, submitter.id)) {
    return c.json({ error: "An active purpose-bound data access grant is required" }, 403);
  }
  if (input.subjectContributionId) {
    const subject = await pool.query("SELECT 1 FROM contributions WHERE id = $1 AND problem_id = $2", [input.subjectContributionId, contributions[0].problem_id]);
    if (!subject.rowCount) return c.json({ error: "Evidence subject must belong to the same problem" }, 400);
  }
  const id = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO evidence
       (id, problem_id, contribution_id, subject_contribution_id, evidence_type, submitter_id, uri, digest, confidence, methodology, provenance, assurance_level, identity_cluster_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, contributions[0].problem_id, contributionId, input.subjectContributionId || null, input.evidenceType, submitter.id, input.uri, input.digest, input.confidence ?? null, input.methodology, input.provenance, submitterTrust.assuranceLevel, submitterTrust.identityClusterHash]
    );
    return c.json({ evidence: rows[0] }, 201);
  } catch (error: any) {
    if (error.code === "23505") return c.json({ error: "This evidence digest is already registered for the contribution" }, 409);
    throw error;
  }
});

problemRoutes.post("/contributions/:contributionId/reviews", authMiddleware, requireRole("employer", "agent"), async (c) => {
  const parsed = await parseBody(c, reviewSchema);
  if (parsed.response) return parsed.response;
  const input = parsed.data!;
  const reviewer = actor(c);
  if (!reviewer) return c.json({ error: "Verified reviewer identity required" }, 401);
  if (reviewer.type !== "PLATFORM" && reviewer.type !== input.reviewerType) return c.json({ error: "reviewerType must match the authenticated identity" }, 403);
  if (input.conflictDisclosure.hasConflict && input.verdict !== "ABSTAIN") return c.json({ error: "A conflicted reviewer must abstain" }, 400);
  const contributionId = c.req.param("contributionId");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT c.contributor_id, c.contributor_identity_cluster_hash, c.problem_id, c.artifact_type,
              p.verification_policy, p.risk_tier, p.ethics
       FROM contributions c JOIN problems p ON p.id = c.problem_id
       WHERE c.id = $1 FOR UPDATE OF c`,
      [contributionId]
    );
    if (!rows.length) { await client.query("ROLLBACK"); return c.json({ error: "Contribution not found" }, 404); }
    if (requiredApprovals({ domain: "", ethics: rows[0].ethics }).length > 0) {
      // evaluateGovernance uses the pool rather than this transaction because it
      // may quarantine a problem whose external approval expired.
      const governance = await evaluateGovernance(rows[0].problem_id);
      if (!governance.ready) {
        await client.query("ROLLBACK");
        return c.json({ error: "Institutional governance is not active", governance }, 409);
      }
    }
    if (rows[0].contributor_id.toLowerCase() === reviewer.id.toLowerCase()) { await client.query("ROLLBACK"); return c.json({ error: "Contributors cannot review their own contribution" }, 409); }
    const reviewerTrust = await resolveActorTrust(client, reviewer.id, reviewer.type);
    const requiredAssurance = minimumAssuranceForRisk(rows[0].risk_tier);
    if (reviewerTrust.assuranceLevel < requiredAssurance) {
      await client.query("ROLLBACK");
      return c.json({ error: `Reviewer assurance level ${reviewerTrust.assuranceLevel} is below required level ${requiredAssurance}` }, 403);
    }
    if (reviewerTrust.identityClusterHash === rows[0].contributor_identity_cluster_hash) {
      await client.query("ROLLBACK");
      return c.json({ error: "A linked identity cannot independently review this contribution" }, 409);
    }
    const duplicateCluster = await client.query(
      "SELECT 1 FROM contribution_reviews WHERE contribution_id = $1 AND identity_cluster_hash = $2 LIMIT 1",
      [contributionId, reviewerTrust.identityClusterHash]
    );
    if (duplicateCluster.rowCount) {
      await client.query("ROLLBACK");
      return c.json({ error: "This identity cluster is already represented in the review quorum" }, 409);
    }
    if (rows[0].ethics?.sensitiveData && !await hasActiveProblemAccess(client, rows[0].problem_id, reviewer.id)) {
      await client.query("ROLLBACK");
      return c.json({ error: "An active purpose-bound data access grant is required" }, 403);
    }
    const reviewId = randomUUID();
    await client.query(
      `INSERT INTO contribution_reviews (id, contribution_id, reviewer_id, reviewer_type, verdict, score, rationale, conflict_disclosure, attestation, assurance_level, identity_cluster_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [reviewId, contributionId, reviewer.id, input.reviewerType, input.verdict, input.score ?? null, input.rationale, input.conflictDisclosure, input.attestation, reviewerTrust.assuranceLevel, reviewerTrust.identityClusterHash]
    );
    const tally = await client.query(
      `SELECT COUNT(*) FILTER (WHERE verdict = 'ACCEPT')::int AS accepts,
              COUNT(*) FILTER (WHERE verdict = 'REJECT')::int AS rejects,
              COUNT(*) FILTER (WHERE verdict = 'REVISE')::int AS revisions
       FROM contribution_reviews WHERE contribution_id = $1`, [contributionId]
    );
    const policy = rows[0].verification_policy;
    const replications = policy.replicationRequired
      ? Number((await client.query("SELECT COUNT(DISTINCT identity_cluster_hash) AS count FROM evidence WHERE contribution_id = $1 AND evidence_type = 'REPLICATES'", [contributionId])).rows[0].count)
      : 0;
    const accepted = tally.rows[0].accepts >= policy.minimumIndependentReviews
      && tally.rows[0].rejects === 0
      && (!policy.replicationRequired || replications >= (policy.minimumReplications || 1));
    await client.query("UPDATE contributions SET status = $1, updated_at = NOW() WHERE id = $2", [accepted ? "ACCEPTED" : "UNDER_REVIEW", contributionId]);
    if (accepted) {
      await client.query(
        `INSERT INTO contribution_credits (contribution_id, contributor_id, role, share_bps)
         VALUES ($1,$2,$3,10000)
         ON CONFLICT (contribution_id, contributor_id, role)
         DO UPDATE SET share_bps = EXCLUDED.share_bps`,
        [contributionId, rows[0].contributor_id, creditRoleForArtifact(rows[0].artifact_type)]
      );
    }
    await client.query("COMMIT");
    return c.json({ reviewId, contributionId, status: accepted ? "ACCEPTED" : "UNDER_REVIEW", tally: tally.rows[0], replications });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return c.json({ error: "Reviewer has already reviewed this contribution" }, 409);
    throw error;
  } finally { client.release(); }
});

problemRoutes.get("/:id/graph", optionalAuthMiddleware, async (c) => {
  const id = c.req.param("id");
  const problem = await pool.query("SELECT * FROM problems WHERE id::text = $1 OR slug = $1", [id]);
  if (!problem.rowCount) return c.json({ error: "Problem not found" }, 404);
  const row = problem.rows[0];
  if (!await canViewProblem(c, row)) return c.json({ error: "Problem not found" }, 404);
  const problemId = row.id;
  const [workstreams, dependencies, contributions, evidence, reviews, credits, funding, approvals] = await Promise.all([
    pool.query("SELECT * FROM workstreams WHERE problem_id = $1 ORDER BY created_at", [problemId]),
    pool.query("SELECT d.* FROM workstream_dependencies d JOIN workstreams w ON w.id = d.workstream_id WHERE w.problem_id = $1", [problemId]),
    pool.query("SELECT * FROM contributions WHERE problem_id = $1 ORDER BY created_at DESC", [problemId]),
    pool.query("SELECT * FROM evidence WHERE problem_id = $1 ORDER BY created_at DESC", [problemId]),
    pool.query("SELECT r.* FROM contribution_reviews r JOIN contributions c ON c.id = r.contribution_id WHERE c.problem_id = $1 ORDER BY r.created_at DESC", [problemId]),
    pool.query("SELECT cc.* FROM contribution_credits cc JOIN contributions c ON c.id = cc.contribution_id WHERE c.problem_id = $1 ORDER BY cc.created_at DESC", [problemId]),
    pool.query("SELECT * FROM funding_pools WHERE problem_id = $1 ORDER BY created_at DESC", [problemId]),
    pool.query(
      `SELECT id, approval_type, authority_name, authority_identifier, protocol_reference,
              document_digest, decision, scope, issued_at, expires_at, created_at
       FROM institutional_approvals WHERE problem_id = $1 ORDER BY created_at DESC`,
      [problemId]
    ),
  ]);
  return c.json({
    problem: problemView(row),
    graph: {
      workstreams: workstreams.rows,
      dependencies: dependencies.rows,
      contributions: contributions.rows,
      evidence: evidence.rows,
      reviews: reviews.rows,
      credits: credits.rows,
      fundingPools: funding.rows,
      institutionalApprovals: approvals.rows,
    },
    counts: { workstreams: workstreams.rowCount, contributions: contributions.rowCount, evidence: evidence.rowCount, reviews: reviews.rowCount, credits: credits.rowCount },
  });
});

problemRoutes.get("/:id", optionalAuthMiddleware, async (c) => {
  const id = c.req.param("id");
  const { rows } = await pool.query("SELECT * FROM problems WHERE id::text = $1 OR slug = $1", [id]);
  if (!rows.length) return c.json({ error: "Problem not found" }, 404);
  if (!await canViewProblem(c, rows[0])) return c.json({ error: "Problem not found" }, 404);
  return c.json({ problem: problemView(rows[0]) });
});
