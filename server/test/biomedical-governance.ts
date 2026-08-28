/**
 * Synthetic institutional-pilot drill for biomedical governance.
 *
 * No record created here is a real IRB or ethics approval. The drill proves
 * that prohibited work is rejected, gated work remains quarantined, controlled
 * access is purpose-bound, identities cannot self-review/replicate, and the
 * configured independent review + replication thresholds are enforced.
 */
import { createHash } from "node:crypto";
import { mnemonicToAccount } from "viem/accounts";
import { Pool } from "pg";

const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:3001";
const API_PREFIX = "/api/v1";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const MNEMONIC = "test test test test test test test test test test test junk";
const actors = Array.from({ length: 6 }, (_, index) => mnemonicToAccount(MNEMONIC, { addressIndex: index + 10 }));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function walletRequest(path: string, method: string, value: unknown, actor = actors[0]!) {
  const body = JSON.stringify(value);
  const message = [
    "AIWork request v2",
    `origin:${API_ORIGIN}`,
    `chainId:${CHAIN_ID}`,
    `method:${method}`,
    `path:${API_PREFIX}${path}`,
    `bodySha256:${digest(body)}`,
    `issuedAt:${new Date().toISOString()}`,
    `nonce:${crypto.randomUUID()}`,
  ].join("\n");
  const signature = await actor.signMessage({ message });
  const response = await fetch(`${API_ORIGIN}${API_PREFIX}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": actor.address,
      "X-Wallet-Message": Buffer.from(message).toString("base64url"),
      "X-Wallet-Signature": signature,
    },
    body,
  });
  return { response, payload: await response.json() };
}

async function adminRequest(path: string, value: unknown) {
  const response = await fetch(`${API_ORIGIN}${API_PREFIX}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer aiwork-dev-key-001" },
    body: JSON.stringify(value),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Admin ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const baseProblem = {
  version: "1.0",
  title: "Synthetic ALS biomarker replication readiness pilot",
  summary: "Validate governance and reproducibility controls for a controlled biomedical research workflow.",
  description: "This synthetic pilot uses no patient records and makes no clinical claim. It exercises institutional approvals, controlled access, independent review, and replication gates before any result can be accepted.",
  domain: "BIOMEDICAL",
  visibility: "PRIVATE",
  riskTier: "HIGH",
  tags: ["synthetic-pilot", "als", "governance"],
  license: "CC-BY-4.0",
  funding: { mechanisms: ["REPLICATION_BOUNTY"] },
  verificationPolicy: {
    mode: "REPRODUCIBLE_RESEARCH",
    minimumIndependentReviews: 3,
    replicationRequired: true,
    minimumReplications: 2,
    artifactRequirements: ["DATA", "METHODS", "ENVIRONMENT", "RESULTS", "ETHICS_APPROVAL"],
    acceptanceCriteria: ["Two independent identity clusters reproduce the declared synthetic result"],
  },
  governance: { reviewerSelection: "INSTITUTIONAL", appealsAllowed: true, conflictDisclosureRequired: true },
  ethics: {
    humanSubjects: true,
    sensitiveData: true,
    dualUse: false,
    institutionalApprovalRequired: true,
    consentBasis: "SECONDARY_USE_APPROVED",
    dataClassification: "CONTROLLED",
    securityStandard: "NIST_800_53_MODERATE",
    highRiskLifeSciences: "NONE",
    jurisdiction: "SYNTHETIC_TEST_ONLY",
    dataUseAgreementDigest: digest("synthetic-dua"),
    requirements: ["Synthetic drill only; replace all approvals before a real pilot"],
  },
  metadata: { synthetic: true, clinicalUse: false },
};

let problemId: string | undefined;
const database = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork",
});

try {
  const prohibited = await walletRequest("/problems", "POST", {
    ...baseProblem,
    title: "Synthetic prohibited high risk life sciences drill",
    ethics: { ...baseProblem.ethics, highRiskLifeSciences: "DGOF" },
  });
  assert(prohibited.response.status === 403, "DGOF category must fail closed");

  for (const [index, identity] of actors.entries()) {
    await adminRequest("/trust/profiles", {
      actorId: identity.address.toLowerCase(),
      actorType: "HUMAN",
      assuranceLevel: 3,
      identityClusterHash: digest(`synthetic-independent-cluster-${index}`),
      evidenceDigest: digest(`synthetic-identity-evidence-${index}`),
      issuerId: "synthetic-pilot-issuer",
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      metadata: { synthetic: true },
    });
  }

  const opened = await walletRequest("/problems", "POST", baseProblem);
  assert(opened.response.status === 201, JSON.stringify(opened.payload));
  problemId = opened.payload.problem.id;
  assert(opened.payload.problem.status === "QUARANTINED", "Biomedical work must begin quarantined");

  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  for (const approvalType of ["IRB", "DATA_ACCESS", "SECURITY", "ETHICS"]) {
    await adminRequest(`/problems/${problemId}/governance/approvals`, {
      approvalType,
      authorityName: `Synthetic ${approvalType} authority`,
      authorityIdentifier: `SYNTHETIC-${approvalType}`,
      protocolReference: `PILOT-${problemId}`,
      documentDigest: digest(`synthetic-${approvalType}-${problemId}`),
      decision: "APPROVED",
      scope: { synthetic: true, problemId },
      issuedAt,
      expiresAt,
    });
  }

  for (const identity of actors) {
    await adminRequest(`/problems/${problemId}/governance/access`, {
      actorId: identity.address.toLowerCase(),
      purpose: "Synthetic readiness drill for governed ALS biomarker reproducibility only.",
      termsDigest: digest(`synthetic-access-${identity.address}`),
      expiresAt,
    });
  }

  const workstreamResult = await walletRequest(`/problems/${problemId}/workstreams`, "POST", {
    title: "Reproduce the declared synthetic biomarker analysis",
    description: "Run the frozen synthetic protocol and publish complete environment and result digests.",
    dependencies: [], budget: {}, acceptancePolicy: {}, metadata: { synthetic: true },
  });
  assert(workstreamResult.response.status === 201, JSON.stringify(workstreamResult.payload));

  const artifactDigest = digest(`synthetic-artifact-${problemId}`);
  const contributionResult = await walletRequest(`/problems/${problemId}/contributions`, "POST", {
    workstreamId: workstreamResult.payload.workstream.id,
    title: "Synthetic ALS biomarker analysis artifact",
    summary: "Frozen synthetic artifact with methods, environment, data lineage, and non-clinical result.",
    artifactUri: "urn:aiwork:synthetic:als-artifact",
    artifactDigest,
    artifactType: "ANALYSIS",
    license: "CC-BY-4.0",
    provenance: {
      generatedAt: new Date().toISOString(),
      generatedBy: [{ id: actors[0]!.address.toLowerCase(), type: "HUMAN", role: "RESEARCHER" }],
      inputs: [], environment: { synthetic: true, runtime: "frozen-pilot" },
    },
    metadata: { synthetic: true },
  });
  assert(contributionResult.response.status === 201, JSON.stringify(contributionResult.payload));
  const contributionId = contributionResult.payload.contribution.id;

  for (let index = 1; index <= 2; index++) {
    const identity = actors[index]!;
    const replication = await walletRequest(`/problems/contributions/${contributionId}/evidence`, "POST", {
      evidenceType: "REPLICATES",
      uri: `urn:aiwork:synthetic:replication-${index}`,
      digest: digest(`synthetic-replication-${index}-${problemId}`),
      confidence: 0.9,
      methodology: { protocol: "frozen-synthetic-v1", independentCluster: index },
      provenance: {
        generatedAt: new Date().toISOString(),
        generatedBy: [{ id: identity.address.toLowerCase(), type: "HUMAN", role: "REPLICATOR" }],
        inputs: [{ uri: "urn:aiwork:synthetic:als-artifact", digest: artifactDigest }],
        environment: { synthetic: true, independentCluster: index },
      },
    }, identity);
    assert(replication.response.status === 201, JSON.stringify(replication.payload));
  }

  let finalStatus = "";
  for (let index = 3; index <= 5; index++) {
    const identity = actors[index]!;
    const review = await walletRequest(`/problems/contributions/${contributionId}/reviews`, "POST", {
      reviewerType: "HUMAN",
      verdict: "ACCEPT",
      score: 95,
      rationale: "Synthetic protocol, provenance, access, and reproducibility thresholds are satisfied for this drill.",
      conflictDisclosure: { hasConflict: false, details: "" },
      attestation: { synthetic: true },
    }, identity);
    assert(review.response.ok, JSON.stringify(review.payload));
    finalStatus = review.payload.status;
  }
  assert(finalStatus === "ACCEPTED", "Three reviews plus two replications must accept the contribution");
  console.log("Biomedical governance synthetic pilot: PASS");
} finally {
  if (problemId && process.env.KEEP_TEST_PROBLEM !== "true") {
    await database.query("DELETE FROM problems WHERE id = $1", [problemId]);
  }
  await database.query("DELETE FROM actor_trust_profiles WHERE issuer_id = 'synthetic-pilot-issuer'");
  await database.end();
}
