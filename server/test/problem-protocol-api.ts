/**
 * Focused Problem Protocol integration test.
 * Requires a running local API and database; creates and removes its own graph.
 */
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { Pool } from "pg";

const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:3001";
const API_PREFIX = "/api/v1";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const author = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const reviewer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a841d7061377c0d0b5d");

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(path: string, method = "GET", bodyValue?: unknown, account = author) {
  const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);
  const message = [
    "AIWork request v2",
    `origin:${API_ORIGIN}`,
    `chainId:${CHAIN_ID}`,
    `method:${method}`,
    `path:${API_PREFIX}${path}`,
    `bodySha256:${createHash("sha256").update(body).digest("hex")}`,
    `issuedAt:${new Date().toISOString()}`,
    `nonce:${crypto.randomUUID()}`,
  ].join("\n");
  const signature = await account.signMessage({ message });
  const response = await fetch(`${API_ORIGIN}${API_PREFIX}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": account.address,
      "X-Wallet-Message": Buffer.from(message, "utf8").toString("base64url"),
      "X-Wallet-Signature": signature,
    },
    body: body || undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

let problemId: string | undefined;
try {
  const opened = await request("/problems", "POST", {
    version: "1.0",
    title: "Integration proof for distributed problem solving",
    summary: "Verify the complete Problem Protocol contribution and evidence lifecycle.",
    description: "This temporary integration problem verifies that charters, workstreams, contributions, evidence, reviews, and graph reads remain consistent.",
    domain: "SOFTWARE",
    visibility: "PUBLIC",
    riskTier: "LOW",
    tags: ["integration-test"],
    license: "MIT",
    funding: { amount: "100", token: "TEST", mechanisms: ["GRANT"] },
    verificationPolicy: {
      mode: "CODE",
      minimumIndependentReviews: 1,
      replicationRequired: false,
      minimumReplications: 0,
      artifactRequirements: ["SOURCE", "METHODS", "RESULTS", "LICENSE"],
      acceptanceCriteria: ["The complete graph can be retrieved through the public API"],
    },
    governance: { reviewerSelection: "HYBRID", appealsAllowed: true, conflictDisclosureRequired: true },
    ethics: { humanSubjects: false, sensitiveData: false, dualUse: false, institutionalApprovalRequired: false, requirements: [] },
    metadata: { test: true },
  });
  problemId = opened.problem.id;
  expect(opened.problem.status === "OPEN", "Low-risk software problem should open immediately");

  const pledge = await request(`/problems/${problemId}/funding`, "POST", {
    mechanism: "REPLICATION_BOUNTY",
    token: "TEST",
    committedAmount: "25",
  });
  expect(pledge.settlement === "PLEDGE_RECORDED_NOT_ESCROWED", "Funding endpoint must not imply escrow settlement");

  const workstream = await request(`/problems/${problemId}/workstreams`, "POST", {
    title: "Validate the protocol graph",
    description: "Exercise every graph edge with deterministic integration data.",
    dependencies: [], budget: {}, acceptancePolicy: {}, metadata: {},
  });

  const artifactDigest = createHash("sha256").update(`artifact:${problemId}`).digest("hex");
  const contribution = await request(`/problems/${problemId}/contributions`, "POST", {
    workstreamId: workstream.workstream.id,
    title: "Deterministic protocol artifact",
    summary: "A reproducible contribution used to validate graph persistence and independent review.",
    artifactUri: "urn:aiwork:test-artifact",
    artifactDigest,
    artifactType: "CODE",
    license: "MIT",
    provenance: {
      generatedAt: new Date().toISOString(),
      generatedBy: [{ id: author.address.toLowerCase(), type: "HUMAN", role: "SOFTWARE" }],
      inputs: [],
      environment: { runtime: "bun", purpose: "integration-test" },
    },
    metadata: { test: true },
  });

  await request(`/problems/contributions/${contribution.contribution.id}/evidence`, "POST", {
    evidenceType: "SUPPORTS",
    uri: "urn:aiwork:test-evidence",
    digest: createHash("sha256").update(`evidence:${problemId}`).digest("hex"),
    confidence: 1,
    methodology: { method: "deterministic API integration" },
    provenance: {
      generatedAt: new Date().toISOString(),
      generatedBy: [{ id: author.address.toLowerCase(), type: "HUMAN", role: "VALIDATION" }],
      inputs: [{ uri: "urn:aiwork:test-artifact", digest: artifactDigest }],
      environment: { runtime: "bun" },
    },
  });

  const review = await request(`/problems/contributions/${contribution.contribution.id}/reviews`, "POST", {
    reviewerType: "HUMAN",
    verdict: "ACCEPT",
    score: 100,
    rationale: "The artifact and its provenance satisfy the deterministic integration acceptance policy.",
    conflictDisclosure: { hasConflict: false, details: "" },
    attestation: { test: true },
  }, reviewer);
  expect(review.status === "ACCEPTED", "Independent threshold should accept the contribution");

  const graph = await request(`/problems/${problemId}/graph`);
  expect(graph.counts.workstreams === 1, "Expected one workstream");
  expect(graph.counts.contributions === 1, "Expected one contribution");
  expect(graph.counts.evidence === 1, "Expected one evidence record");
  expect(graph.counts.reviews === 1, "Expected one independent review");
  expect(graph.counts.credits === 1, "Expected accepted contribution credit");
  expect(graph.graph.credits[0]?.contributor_id === author.address.toLowerCase(), "Expected credit assigned to the artifact contributor");
  expect(graph.graph.fundingPools.length === 2, "Expected charter and follow-up funding pledges in the graph");
  expect(graph.graph.fundingPools[0]?.status === "PLEDGED", "Funding must remain explicitly non-escrowed");
  console.log("Problem Protocol integration: PASS", graph.counts);
} finally {
  if (problemId && process.env.KEEP_TEST_PROBLEM !== "true") {
    const cleanup = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork" });
    await cleanup.query("DELETE FROM problems WHERE id = $1", [problemId]);
    await cleanup.end();
  }
}
