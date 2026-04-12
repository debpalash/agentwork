/**
 * Dispute Routes — /api/v1/disputes
 *
 * Manages the dispute lifecycle:
 *   POST /            — Open a dispute
 *   GET /:id          — Get dispute details
 *   POST /:id/vote    — Cast an arbiter vote
 *   POST /:id/cancel  — Cancel a dispute
 *   GET /task/:taskId  — Get disputes for a task
 */

import { Hono } from "hono";
import { pool } from "../db/index";
import { authMiddleware } from "../middleware/auth";

export const disputeRoutes = new Hono();

// Ensure disputes table exists
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disputes (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      opener_address TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'VOTING', 'RESOLVED', 'CANCELLED')),
      resolution TEXT DEFAULT 'NONE' CHECK (resolution IN ('NONE', 'FAVOR_WORKER', 'FAVOR_POSTER', 'SPLIT')),
      arbiters TEXT[] DEFAULT '{}',
      votes JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      tx_hash TEXT
    )
  `);
}
ensureTable().catch(() => {});

// ─── Open Dispute ──────────────────────────────────────────────
disputeRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json();
  const { taskId, reason, openerAddress, arbiters } = body;

  if (!taskId || !reason || !openerAddress) {
    return c.json({ error: "Missing required fields: taskId, reason, openerAddress" }, 400);
  }

  try {
    const result = await pool.query(
      `INSERT INTO disputes (task_id, opener_address, reason, status, arbiters)
       VALUES ($1, $2, $3, 'VOTING', $4)
       RETURNING *`,
      [taskId, openerAddress, reason, arbiters || []]
    );

    return c.json({
      success: true,
      dispute: result.rows[0],
      message: "Dispute opened. Arbiters will be notified to vote.",
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Dispute ───────────────────────────────────────────────
disputeRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const result = await pool.query("SELECT * FROM disputes WHERE id = $1", [id]);
    if (result.rows.length === 0) return c.json({ error: "Dispute not found" }, 404);

    return c.json(result.rows[0]);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Vote on Dispute ──────────────────────────────────────────
disputeRoutes.post("/:id/vote", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { arbiterAddress, vote } = body;

  if (!arbiterAddress || !vote) {
    return c.json({ error: "Missing required fields: arbiterAddress, vote" }, 400);
  }

  const validVotes = ["FAVOR_WORKER", "FAVOR_POSTER", "SPLIT"];
  if (!validVotes.includes(vote)) {
    return c.json({ error: `Invalid vote. Must be one of: ${validVotes.join(", ")}` }, 400);
  }

  try {
    const disputeResult = await pool.query("SELECT * FROM disputes WHERE id = $1", [id]);
    if (disputeResult.rows.length === 0) return c.json({ error: "Dispute not found" }, 404);

    const dispute = disputeResult.rows[0];
    if (dispute.status !== "VOTING") {
      return c.json({ error: "Dispute is not in voting phase" }, 400);
    }

    // Add vote
    const existingVotes = dispute.votes || [];
    const alreadyVoted = existingVotes.some((v: any) => v.arbiter === arbiterAddress);
    if (alreadyVoted) {
      return c.json({ error: "Arbiter has already voted" }, 400);
    }

    const newVotes = [...existingVotes, { arbiter: arbiterAddress, vote, timestamp: new Date().toISOString() }];

    // Auto-resolve when 3 votes received
    let newStatus = "VOTING";
    let resolution = "NONE";
    let resolvedAt = null;

    if (newVotes.length >= 3) {
      const tally = { FAVOR_WORKER: 0, FAVOR_POSTER: 0, SPLIT: 0 };
      newVotes.forEach((v: any) => { tally[v.vote as keyof typeof tally]++; });

      if (tally.FAVOR_WORKER >= 2) resolution = "FAVOR_WORKER";
      else if (tally.FAVOR_POSTER >= 2) resolution = "FAVOR_POSTER";
      else resolution = "SPLIT";

      newStatus = "RESOLVED";
      resolvedAt = new Date().toISOString();
    }

    await pool.query(
      `UPDATE disputes SET votes = $1, status = $2, resolution = $3, resolved_at = $4 WHERE id = $5`,
      [JSON.stringify(newVotes), newStatus, resolution, resolvedAt, id]
    );

    return c.json({
      success: true,
      votesReceived: newVotes.length,
      status: newStatus,
      resolution,
      message: newStatus === "RESOLVED"
        ? `Dispute resolved: ${resolution}`
        : `Vote recorded. ${3 - newVotes.length} more votes needed.`,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Cancel Dispute ────────────────────────────────────────────
disputeRoutes.post("/:id/cancel", authMiddleware, async (c) => {
  const id = c.req.param("id");

  try {
    const result = await pool.query(
      `UPDATE disputes SET status = 'CANCELLED' WHERE id = $1 AND status IN ('OPEN', 'VOTING') RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Dispute not found or cannot be cancelled" }, 404);
    }

    return c.json({ success: true, dispute: result.rows[0] });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── List All Disputes ─────────────────────────────────────────
disputeRoutes.get("/task/all", async (c) => {
  try {
    const result = await pool.query(
      "SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100"
    );
    return c.json({ disputes: result.rows, total: result.rows.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Disputes for Task ─────────────────────────────────────
disputeRoutes.get("/task/:taskId", async (c) => {
  const taskId = c.req.param("taskId");

  try {
    const result = await pool.query(
      "SELECT * FROM disputes WHERE task_id = $1 ORDER BY created_at DESC",
      [taskId]
    );
    return c.json({ disputes: result.rows, total: result.rows.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
