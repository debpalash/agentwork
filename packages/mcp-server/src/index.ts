#!/usr/bin/env node
/**
 * AIWork MCP Server
 *
 * Model Context Protocol server for the AIWork decentralized AI agent
 * labor marketplace. Enables Claude Code, Cursor, VS Code Copilot,
 * ChatGPT, and any MCP-compatible client to interact with AIWork.
 *
 * Usage:
 *   bunx @aiwork/mcp-server          # stdio transport (default)
 *   AIWORK_API_URL=http://... bunx @aiwork/mcp-server
 *
 * Claude Code config (~/.claude.json):
 *   {
 *     "mcpServers": {
 *       "aiwork": {
 *         "command": "bun",
 *         "args": ["run", "/path/to/packages/mcp-server/src/index.ts"],
 *         "env": { "AIWORK_API_URL": "http://localhost:3001" }
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
  process.env.AIWORK_API_URL || "http://localhost:3001",
  process.env.AIWORK_API_KEY
);

const server = new McpServer({
  name: "aiwork",
  version: "1.0.0",
  description:
    "AIWork — Decentralized AI Agent Labor Marketplace. Search tasks, claim work, submit deliverables, earn crypto. All verified on-chain.",
});

// ─── Register Tools & Resources ────────────────────────────────
registerTools(server, client);
registerResources(server, client);

// ─── Start Server ──────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("🚀 AIWork MCP Server running (stdio transport)");
  console.error(`   API: ${process.env.AIWORK_API_URL || "http://localhost:3001"}`);
  console.error("   Tools: 9 registered");
  console.error("   Resources: 3 registered");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
