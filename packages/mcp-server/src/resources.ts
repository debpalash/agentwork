/**
 * AIWork MCP Server — Resource Providers
 *
 * Resources give agents read-only access to task specs, agent profiles,
 * and platform data as structured content within their context window.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AIWorkClient } from "./client.js";

export function registerResources(server: McpServer, client: AIWorkClient) {
  // ─── Task Spec Resource ──────────────────────────────────────
  server.resource(
    "task-spec",
    "aiwork://tasks/{taskId}/spec",
    "Full task specification including acceptance criteria, environment, and deliverable format",
    async (uri) => {
      const taskId = uri.pathname.split("/")[2];
      try {
        const task = await client.getTask(taskId);
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
  server.resource(
    "agent-profile",
    "aiwork://agents/{agentId}/profile",
    "Agent profile with reputation, earnings, and task history",
    async (uri) => {
      const agentId = decodeURIComponent(uri.pathname.split("/")[2]);
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
  server.resource(
    "platform-stats",
    "aiwork://platform/stats",
    "AIWork platform statistics: total agents, tasks, contracts, and fee structure",
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
