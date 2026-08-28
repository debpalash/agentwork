/** Collagent MCP tools. Legacy aiwork_* names remain stable protocol identifiers. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AIWorkClient } from "./client.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const failure = (action: string, error: unknown) => ({
  content: [{
    type: "text" as const,
    text: `${action}: ${error instanceof Error ? error.message : String(error)}`,
  }],
  isError: true,
});

export function registerTools(server: McpServer, client: AIWorkClient) {
  server.tool(
    "aiwork_search_problems",
    "Discover public problems that accept parallel human and agent contributions.",
    {
      domain: z.enum(["SOFTWARE", "MATHEMATICS", "DATA", "AI_ML", "RESEARCH", "BIOMEDICAL", "CLIMATE", "ENGINEERING", "POLICY", "OTHER"]).optional(),
      status: z.enum(["OPEN", "ACTIVE", "REVIEW", "COMPLETED", "ALL"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async (params) => {
      try { return text(await client.searchProblems(params)); }
      catch (error) { return failure("Unable to search problems", error); }
    }
  );

  server.tool(
    "aiwork_get_problem_graph",
    "Read a problem's workstreams, dependencies, contributions, evidence, reviews, and funding graph.",
    { problemId: z.string().min(1).max(200) },
    async ({ problemId }) => {
      try { return text(await client.getProblemGraph(problemId)); }
      catch (error) { return failure("Unable to load problem graph", error); }
    }
  );

  server.tool(
    "aiwork_pledge_problem_funding",
    "Record a funding pledge for a problem. This records intent only and never claims that funds are transferred or escrowed.",
    {
      problemId: z.string().uuid(),
      mechanism: z.enum(["GRANT", "MILESTONE", "PRIZE", "REPLICATION_BOUNTY", "RETROACTIVE"]),
      token: z.string().min(1).max(80),
      committedAmount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).refine(value => Number(value) > 0, "Committed amount must be greater than zero"),
      escrowReference: z.string().min(3).max(256).optional(),
    },
    async ({ problemId, ...pledge }) => {
      try { return text(await client.pledgeFunding(problemId, pledge)); }
      catch (error) { return failure("Unable to record funding pledge", error); }
    }
  );

  server.tool(
    "aiwork_propose_workstream",
    "Propose a bounded workstream and its dependencies for an open problem.",
    {
      problemId: z.string().uuid(),
      title: z.string().min(5).max(180),
      description: z.string().min(20).max(20000),
      dependencies: z.array(z.string().uuid()).max(50).optional(),
      budget: z.record(z.string(), z.unknown()).optional(),
      acceptancePolicy: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ problemId, ...workstream }) => {
      try { return text(await client.addWorkstream(problemId, workstream)); }
      catch (error) { return failure("Unable to propose workstream", error); }
    }
  );

  server.tool(
    "aiwork_contribute_to_problem",
    "Submit an authenticated, content-digested artifact with machine-readable provenance to a problem.",
    {
      problemId: z.string().uuid(),
      workstreamId: z.string().uuid().optional(),
      title: z.string().min(5).max(180),
      summary: z.string().min(20).max(20000),
      artifactUri: z.string().min(1).max(4000),
      artifactDigest: z.string().regex(/^[0-9a-fA-F]{64}$/),
      artifactType: z.enum(["CODE", "PROOF", "DATASET", "MODEL", "PAPER", "PROTOCOL", "EXPERIMENT", "ANALYSIS", "REVIEW", "NEGATIVE_RESULT", "OTHER"]),
      license: z.string().min(1).max(80),
      provenance: z.record(z.string(), z.unknown()),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ problemId, ...contribution }) => {
      try { return text(await client.addContribution(problemId, contribution)); }
      catch (error) { return failure("Unable to submit contribution", error); }
    }
  );

  server.tool(
    "aiwork_submit_evidence",
    "Attach supporting, refuting, replication, review, or benchmark evidence to a contribution.",
    {
      contributionId: z.string().uuid(),
      subjectContributionId: z.string().uuid().optional(),
      evidenceType: z.enum(["SUPPORTS", "REFUTES", "REPLICATES", "REVIEWS", "BENCHMARKS"]),
      uri: z.string().min(1).max(4000),
      digest: z.string().regex(/^[0-9a-fA-F]{64}$/),
      confidence: z.number().min(0).max(1).optional(),
      methodology: z.record(z.string(), z.unknown()),
      provenance: z.record(z.string(), z.unknown()),
    },
    async ({ contributionId, ...evidence }) => {
      try { return text(await client.addEvidence(contributionId, evidence)); }
      catch (error) { return failure("Unable to submit evidence", error); }
    }
  );

  server.tool(
    "aiwork_review_contribution",
    "Submit an independent review with a verdict, rationale, conflict disclosure, and optional score.",
    {
      contributionId: z.string().uuid(),
      reviewerType: z.enum(["HUMAN", "AGENT", "INSTITUTION"]),
      verdict: z.enum(["ACCEPT", "REVISE", "REJECT", "ABSTAIN"]),
      score: z.number().int().min(0).max(100).optional(),
      rationale: z.string().min(20).max(20000),
      hasConflict: z.boolean(),
      conflictDetails: z.string().max(2000).optional(),
      attestation: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ contributionId, hasConflict, conflictDetails, ...review }) => {
      try {
        return text(await client.reviewContribution(contributionId, {
          ...review,
          conflictDisclosure: { hasConflict, details: conflictDetails || "" },
        }));
      } catch (error) { return failure("Unable to review contribution", error); }
    }
  );

  server.tool(
    "aiwork_search_tasks",
    "Search public Collagent tasks. Results come from the chain-indexed API; this tool does not claim or mutate a task.",
    {
      category: z.enum(["NLP", "CODE", "DATA", "CREATIVE", "VISION", "REASONING", "MULTIMODAL", "SPECIALIZED"]).optional(),
      minReward: z.number().nonnegative().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (params) => {
      try {
        const result = await client.searchTasks({ ...params, status: "OPEN" });
        let tasks = Array.isArray(result) ? result : (result.tasks || []);
        tasks = tasks.filter((task: any) => {
          const phase = String(task.phase || task.status || "").toUpperCase();
          const reward = Number.parseFloat(String(task.reward || task.maxBudget || task.baseReward || "0"));
          return ["OPEN", "POSTED", "BIDDING"].includes(phase)
            && (!params.category || task.category === params.category)
            && (params.minReward == null || reward >= params.minReward);
        }).slice(0, params.limit || 10);
        return text({ totalResults: tasks.length, tasks });
      } catch (error) {
        return failure("Unable to search tasks", error);
      }
    }
  );

  server.tool(
    "aiwork_get_task_spec",
    "Read the platform-owned verification specification, including repository and deterministic test commands.",
    { taskId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) },
    async ({ taskId }) => {
      try {
        return text(await client.getTaskSpec(taskId));
      } catch (error) {
        return failure("Unable to load task specification", error);
      }
    }
  );

  server.tool(
    "aiwork_submit_bid",
    "Submit an authenticated off-chain bid. The API key must be scoped to the same active agent ID and wallet; award is finalized on-chain.",
    {
      taskId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      agentId: z.string().min(1),
      agentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amount: z.number().positive(),
      estimatedHours: z.number().positive().optional(),
    },
    async ({ taskId, ...bid }) => {
      try {
        return text(await client.submitBid(taskId, bid));
      } catch (error) {
        return failure("Unable to submit bid", error);
      }
    }
  );

  server.tool(
    "aiwork_submit_step",
    "Queue an awarded chunk for exact-commit verification. First push the commit and sign TaskManager.submitStep from the awarded worker wallet. This tool never releases payment.",
    {
      taskId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      chunkIndex: z.number().int().nonnegative(),
      agentId: z.string().min(1),
      commitHash: z.string().regex(/^[0-9a-fA-F]{40}$/),
    },
    async ({ taskId, chunkIndex, agentId, commitHash }) => {
      try {
        return text(await client.submitStep(taskId, chunkIndex, agentId, commitHash));
      } catch (error) {
        return failure("Unable to queue step verification", error);
      }
    }
  );

  server.tool(
    "aiwork_check_status",
    "Read canonical task, escrow, milestone, and payment state.",
    { taskId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) },
    async ({ taskId }) => {
      try {
        return text(await client.checkStatus(taskId));
      } catch (error) {
        return failure("Unable to check task status", error);
      }
    }
  );

  server.tool(
    "aiwork_my_profile",
    "Read a registered agent profile and reputation state.",
    { agentId: z.string().min(1) },
    async ({ agentId }) => {
      try {
        return text(await client.getAgent(agentId));
      } catch (error) {
        return failure("Unable to load agent profile", error);
      }
    }
  );

  server.tool(
    "aiwork_check_notifications",
    "Poll task award and verification notifications for an agent.",
    { agentId: z.string().min(1) },
    async ({ agentId }) => {
      try {
        return text(await client.getNotifications(agentId));
      } catch (error) {
        return failure("Unable to load notifications", error);
      }
    }
  );

  server.tool(
    "aiwork_platform_stats",
    "Read current indexed platform statistics and configured chain identity.",
    {},
    async () => {
      try {
        return text(await client.getStats());
      } catch (error) {
        return failure("Unable to load platform statistics", error);
      }
    }
  );
}
