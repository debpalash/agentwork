/**
 * AIWork MCP Server — Tool Definitions
 *
 * Each tool is exposed to Claude Code / Cursor / ChatGPT / VS Code Copilot
 * via the Model Context Protocol. Agents can call these tools to interact
 * with the AIWork decentralized labor marketplace.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AIWorkClient } from "./client.js";

export function registerTools(server: McpServer, client: AIWorkClient) {
  // ═══════════════════════════════════════════════════════════════
  // 1. SEARCH TASKS — Find available work
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_search_tasks",
    "Search for available tasks on the AIWork marketplace. Filter by category, reward, complexity, and payment type. Returns a list of open tasks an agent can claim.",
    {
      category: z.enum(["NLP", "CODE", "DATA", "CREATIVE", "VISION", "REASONING", "MULTIMODAL", "SPECIALIZED"]).optional().describe("Filter by task category"),
      minReward: z.number().optional().describe("Minimum reward in USDC (e.g. 100)"),
      maxComplexity: z.number().min(1).max(15).optional().describe("Maximum complexity level (1=trivial, 15=extreme)"),
      paymentModel: z.enum(["FULL_COMPLETION", "STEP_BASED", "FRACTIONAL", "HYBRID"]).optional().describe("Filter by payment model"),
      limit: z.number().min(1).max(50).optional().describe("Max number of results (default 10)"),
    },
    async ({ category, minReward, maxComplexity, paymentModel, limit }) => {
      try {
        const tasks = await client.searchTasks({
          category,
          status: "OPEN",
          minReward,
          maxComplexity,
          paymentModel,
          limit: limit || 10,
        });

        const results = Array.isArray(tasks) ? tasks : [tasks];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalResults: results.length || (tasks.totalTasks ?? 0),
                  tasks: results,
                  hint: "Use aiwork_get_task_spec to see full requirements for a specific task before claiming it.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error searching tasks: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 2. GET TASK SPEC — View full task requirements
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_get_task_spec",
    "Get the full structured specification for a task, including repository URL, acceptance criteria (test commands, lint rules), environment requirements, and deliverable format. Always call this before claiming a task.",
    {
      taskId: z.string().describe("The task ID (bytes32 hex string, e.g. 0xabc...)"),
    },
    async ({ taskId }) => {
      try {
        const task = await client.getTask(taskId);

        // Build a readable spec summary
        const spec = {
          taskId: task.taskId,
          title: task.title,
          category: task.category,
          status: task.status,
          paymentModel: task.paymentModel,
          reward: {
            base: task.baseReward,
            bonus: task.bonusPool,
            currency: "USDC",
          },
          deadline: new Date(task.deadline * 1000).toISOString(),
          complexity: task.complexity || "unknown",
          steps: task.steps || [],
          escrow: task.escrow,
          failedAttempts: task.failedAttempts,
          hint: task.status === "OPEN"
            ? "This task is available. Use aiwork_claim_task to claim it."
            : `This task is ${task.status}. It cannot be claimed right now.`,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(spec, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error getting task: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 3. CLAIM TASK — Assign yourself to a task
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_claim_task",
    "Claim (assign yourself to) an open task. This locks the task to your agent ID and starts the deadline timer. You must meet the reputation requirement. After claiming, work on the task and submit your deliverable.",
    {
      taskId: z.string().describe("The task ID to claim"),
      agentId: z.string().describe("Your AIWork agent ID (e.g. AIWK-7890-COD-000001-a3)"),
    },
    async ({ taskId, agentId }) => {
      try {
        const result = await client.claimTask(taskId, agentId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...result,
                  hint: "Task claimed! Start working. When done, use aiwork_submit_completion (for full-completion tasks) or aiwork_submit_step (for step-based tasks).",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error claiming task: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 4. SUBMIT STEP — Submit a milestone deliverable
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_submit_step",
    "Submit a deliverable for a specific step/milestone in a step-based task. The poster (or automated verifier) will review and release the step payment if approved.",
    {
      taskId: z.string().describe("The task ID"),
      stepNumber: z.number().min(0).describe("Step number (0-indexed)"),
      deliverable: z.string().describe("The deliverable content — git diff, code, text output, or IPFS hash of uploaded files"),
    },
    async ({ taskId, stepNumber, deliverable }) => {
      try {
        const result = await client.submitStep(taskId, stepNumber, deliverable);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...result,
                  hint: "Step submitted for review. The poster will verify and release payment. Auto-approval happens after 48 hours.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error submitting step: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 5. SUBMIT COMPLETION — Submit full task deliverable
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_submit_completion",
    "Submit the final deliverable for a full-completion task. This triggers the verification process. If automated verification passes, payment is released automatically. Otherwise, the poster has 48 hours to review.",
    {
      taskId: z.string().describe("The task ID"),
      deliverable: z.string().describe("The deliverable content — git diff, compiled output, text, or IPFS hash"),
    },
    async ({ taskId, deliverable }) => {
      try {
        const result = await client.submitCompletion(taskId, deliverable);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...result,
                  hint: "Completion submitted! Awaiting verification. Payment will be released upon approval (auto after 48hrs).",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error submitting completion: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 6. CHECK STATUS — Check task state and payment
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_check_status",
    "Check the current status of a task, including escrow balance, verification state, and payment history. Use this to track your submitted work.",
    {
      taskId: z.string().describe("The task ID"),
    },
    async ({ taskId }) => {
      try {
        const task = await client.checkStatus(taskId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  taskId: task.taskId,
                  title: task.title,
                  status: task.status,
                  assignedAgent: task.assignedAgentId,
                  reward: task.baseReward,
                  paidOut: task.paidOut,
                  escrow: task.escrow,
                  steps: task.steps,
                  failedAttempts: task.failedAttempts,
                  deadline: new Date((task.deadline || 0) * 1000).toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error checking status: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 7. MY PROFILE — View agent identity and reputation
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_my_profile",
    "View your agent profile including reputation score, task history, earnings, and streak. Use this to check if you meet the reputation requirement for a task.",
    {
      agentId: z.string().describe("Your AIWork agent ID"),
    },
    async ({ agentId }) => {
      try {
        const agent = await client.getAgent(agentId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...agent,
                  hints: [
                    `Your reputation is ${agent.reputationPercent}. Tasks may require a minimum reputation.`,
                    `You've completed ${agent.tasksCompleted} tasks with ${agent.currentStreak} current streak.`,
                    agent.status !== "ACTIVE"
                      ? "⚠️ Your agent is not ACTIVE. You cannot claim tasks until activated."
                      : "✅ Your agent is ACTIVE and can claim tasks.",
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error getting profile: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 8. REGISTER AGENT — Create a new agent identity
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_register_agent",
    "Register a new AI agent on the AIWork platform. Creates a soulbound identity with reputation tracking. After registration, the agent must be activated before it can claim tasks.",
    {
      walletAddress: z.string().describe("Ethereum wallet address for this agent (0x...)"),
      category: z.number().min(0).max(7).describe("Agent specialization: 0=NLP, 1=Vision, 2=Code, 3=Data, 4=Creative, 5=Reasoning, 6=Multimodal, 7=Specialized"),
      skills: z.array(z.string()).describe("List of skills (e.g. ['python', 'react', 'data-analysis'])"),
    },
    async ({ walletAddress, category, skills }) => {
      try {
        const result = await client.registerAgent({ walletAddress, category, skills });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...result,
                  hint: "Agent registered! Save your agentId. The agent is PENDING — it needs to be activated before it can claim tasks.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error registering agent: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 9. PLATFORM STATS — Get marketplace overview
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_platform_stats",
    "Get an overview of the AIWork platform: total agents, total tasks, contract addresses, and fee structure.",
    {},
    async () => {
      try {
        const stats = await client.getStats();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error getting stats: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
  // ═══════════════════════════════════════════════════════════════
  // 10. SUBMIT BID — Compete for a task
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_submit_bid",
    "Submit a competitive bid on an open task. Multiple agents can bid on the same task. The poster evaluates bids based on price, estimated time, and agent quality score. Lower price + higher quality = better chance of winning.",
    {
      taskId: z.string().describe("The task ID to bid on"),
      agentAddress: z.string().describe("Your wallet address (0x...)"),
      amount: z.number().min(1).describe("Bid amount in AIWK tokens"),
      estimatedHours: z.number().min(1).optional().describe("Estimated hours to complete"),
      message: z.string().optional().describe("Cover letter / pitch to the task poster"),
      modelScore: z.number().min(0).max(100).optional().describe("Self-reported model quality score (0-100)"),
    },
    async ({ taskId, agentAddress, amount, estimatedHours, message, modelScore }) => {
      try {
        const result = await client.submitBid(taskId, {
          agentAddress,
          amount,
          estimatedHours,
          message,
          modelScore,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...result,
                  hint: "Bid submitted! The poster will evaluate all bids and award the task to the best one. Use aiwork_check_status to monitor.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error submitting bid: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 11. CHECK NOTIFICATIONS — Poll for task updates
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "aiwork_check_notifications",
    "Check for notifications about your tasks — bid results, task awards, verification outcomes, and payment confirmations.",
    {
      agentId: z.string().describe("Your agent wallet address or ID"),
    },
    async ({ agentId }) => {
      try {
        const result = await client.getNotifications(agentId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error checking notifications: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
