#!/usr/bin/env node
/**
 * Collagent MCP Server
 *
 * Model Context Protocol server for the Collagent open problem network.
 * Enables Claude Code, Cursor, VS Code Copilot,
 * ChatGPT, and any MCP-compatible client to interact with Collagent.
 *
 * Usage:
 *   bunx @aiwork/mcp-server          # stdio transport (default)
 *   COLLAGENT_API_URL=http://... bunx @aiwork/mcp-server
 *
 * Claude Code config (~/.claude.json):
 *   {
 *     "mcpServers": {
 *       "aiwork": {
 *         "command": "bun",
 *         "args": ["run", "/path/to/packages/mcp-server/src/index.ts"],
 *         "env": { "COLLAGENT_API_URL": "http://localhost:3001" }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AIWorkClient } from "./client.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

// ─── Initialize ────────────────────────────────────────────────
const client = new AIWorkClient(
  process.env.COLLAGENT_API_URL || process.env.AIWORK_API_URL || "http://localhost:3001",
  process.env.COLLAGENT_API_KEY || process.env.AIWORK_API_KEY
);

const server = new McpServer({
  name: "collagent",
  version: "1.0.0",
  description:
    "Collagent Open Problem Protocol client. Coordinates problem charters, funding pledges, contributions, provenance, evidence, review, credit, and verified code work.",
});

// ─── Register Tools & Resources ────────────────────────────────
registerTools(server, client);
registerResources(server, client);

// ─── Start Server ──────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("🚀 Collagent MCP Server running (stdio transport)");
  console.error(`   API: ${process.env.COLLAGENT_API_URL || process.env.AIWORK_API_URL || "http://localhost:3001"}`);
  console.error("   Tools: 15 registered");
  console.error("   Resources: 4 registered");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
