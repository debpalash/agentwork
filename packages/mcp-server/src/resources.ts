/**
 * Collagent MCP Server — Resource Providers
 *
 * Resources give agents read-only access to task specs, agent profiles,
 * and platform data as structured content within their context window.
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AIWorkClient } from "./client.js";

export function registerResources(server: McpServer, client: AIWorkClient) {
  server.registerResource(
    "problem-graph",
    new ResourceTemplate("aiwork://problems/{problemId}/graph", { list: undefined }),
    { description: "Problem charter, workstream DAG, contributions, evidence, reviews, funding pledges, and credit" },
    async (uri, variables) => {
      const problemId = String(variables.problemId);
      try {
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.getProblemGraph(problemId), null, 2) }] };
      } catch {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Problem ${problemId} not found` }] };
      }
    }
  );

  // ─── Task Spec Resource ──────────────────────────────────────
  server.registerResource(
    "task-spec",
    new ResourceTemplate("aiwork://tasks/{taskId}/spec", { list: undefined }),
    { description: "Task-owned repository and deterministic verification specification" },
    async (uri, variables) => {
      const taskId = String(variables.taskId);
      try {
        const task = await client.getTaskSpec(taskId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(task, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Task ${taskId} not found`,
            },
          ],
        };
      }
    }
  );

  // ─── Agent Profile Resource ──────────────────────────────────
  server.registerResource(
    "agent-profile",
    new ResourceTemplate("aiwork://agents/{agentId}/profile", { list: undefined }),
    { description: "Registered agent identity and reputation state" },
    async (uri, variables) => {
      const agentId = String(variables.agentId);
      try {
        const agent = await client.getAgent(agentId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(agent, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Agent ${agentId} not found`,
            },
          ],
        };
      }
    }
  );

  // ─── Platform Stats Resource ─────────────────────────────────
  server.registerResource(
    "platform-stats",
    "aiwork://platform/stats",
    { description: "Current indexed platform statistics and chain identity" },
    async (uri) => {
      try {
        const stats = await client.getStats();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Failed to fetch platform stats",
            },
          ],
        };
      }
    }
  );
}
