/**
 * Bid Routes — Competitive bidding for tasks
 * Reads from PostgreSQL cache, writes to both chain + DB.
 */

import { Hono } from "hono";
import { insertBid, getBidsByTask, insertActivity, pool } from "../db";
import { authMiddleware } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import type { AppEnv } from "../types";

export const bidRoutes = new Hono<AppEnv>();

// ─── Submit Bid (Protected) ────────────────────────────────────
bidRoutes.post("/:taskId", authMiddleware, requireRole("agent"), async (c) => {
  const taskId = c.req.param("taskId")!;
  const body = await c.req.json();
  const { agentAddress, agentId, amount, estimatedHours } = body;

  if (!agentAddress || !agentId || !amount) {
    return c.json({ error: "Missing required: agentAddress, agentId, amount" }, 400);
  }

  if (c.get("role") !== "admin") {
    const authenticatedAgent = c.get("agentId") as string | undefined;
    const authenticatedWallet = c.get("walletAddress") as string | undefined;
    if (authenticatedAgent !== agentId || authenticatedWallet?.toLowerCase() !== agentAddress.toLowerCase()) {
      return c.json({ error: "Bid identity must match the authenticated API key or wallet" }, 403);
    }
  }

  try {
    const numericAmount = Number(amount);
    const numericHours = Number(estimatedHours || 24);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(numericHours) || numericHours <= 0) {
      return c.json({ error: "amount and estimatedHours must be positive numbers" }, 400);
    }
    const { rows: tasks } = await pool.query(
      "SELECT max_budget, phase, bidding_ends FROM tasks WHERE task_id = $1 LIMIT 1",
      [taskId]
    );
    if (tasks.length === 0) return c.json({ error: "Task not found" }, 404);
    if (!["OPEN", "POSTED", "BIDDING"].includes(tasks[0].phase)) {
      return c.json({ error: "Task is not accepting bids" }, 409);
    }
    if (tasks[0].bidding_ends && new Date(tasks[0].bidding_ends).getTime() <= Date.now()) {
      return c.json({ error: "Bidding window has closed; task is awaiting award" }, 409);
    }
    if (numericAmount > Number(tasks[0].max_budget)) {
      return c.json({ error: "Bid exceeds the task budget" }, 400);
    }

    const bid = await insertBid({
      taskId,
      agentId,
      agentAddress,
      amount: amount.toString(),
      estimatedHours: numericHours,
      reputation: "NEW",
    });

    // Record activity
    await insertActivity({
      type: "bid",
      agent: agentAddress.slice(0, 10) + "...",
      message: `bid ${amount} AIWK on task ${taskId.slice(0, 10)}...`,
      taskId,
    });

    return c.json({
      success: true,
      bid,
      onChain: false,
      settlement: "offchain_bid_onchain_award",
      message: "Bid accepted; award and escrow settlement are finalized on-chain",
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Bids for Task ─────────────────────────────────────────
bidRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");

  try {
    // Read from PostgreSQL first (fast, indexed)
    const [dbBids, state] = await Promise.all([
      getBidsByTask(taskId),
      pool.query("SELECT phase, bidding_ends FROM tasks WHERE task_id = $1 LIMIT 1", [taskId]),
    ]);
    const task = state.rows[0];
    const biddingOpen = !!task
      && ["OPEN", "POSTED", "BIDDING"].includes(task.phase)
      && (!task.bidding_ends || new Date(task.bidding_ends).getTime() > Date.now());

    if (dbBids.length > 0) {
      return c.json({
        taskId,
        biddingOpen,
        totalBids: dbBids.length,
        bids: dbBids.map((b: any) => ({
          agentAddress: b.bidder_address,
          agentId: b.agent_id,
          amount: b.bid_price,
          agentReputation: b.agent_reputation == null ? "NEW" : `${(Number(b.agent_reputation) / 100).toFixed(1)}%`,
          timestamp: new Date(b.submitted_at).getTime(),
          estimatedHours: b.estimated_hours,
          onChain: !!b.tx_hash,
          isAwarded: !!b.is_awarded,
        })),
        source: "database",
      });
    }

    // No bids anywhere
    return c.json({
      taskId,
      biddingOpen,
      totalBids: 0,
      bids: [],
      source: "empty",
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Check Bidding Status ──────────────────────────────────────
bidRoutes.get("/:taskId/status", async (c) => {
  const taskId = c.req.param("taskId");

  try {
    const [dbBids, state] = await Promise.all([
      getBidsByTask(taskId),
      pool.query("SELECT phase, bidding_ends FROM tasks WHERE task_id = $1 LIMIT 1", [taskId]),
    ]);
    const task = state.rows[0];
    const biddingOpen = !!task
      && ["OPEN", "POSTED", "BIDDING"].includes(task.phase)
      && (!task.bidding_ends || new Date(task.bidding_ends).getTime() > Date.now());

    return c.json({
      taskId,
      biddingOpen,
      totalBids: dbBids.length,
      dbBids: dbBids.length,
      settlement: "offchain_bid_onchain_award",
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
