/**
 * Bid Routes — Competitive bidding for tasks
 * Reads from PostgreSQL cache, writes to both chain + DB.
 */

import { Hono } from "hono";
import {
  publicClient,
  walletClient,
  CONTRACTS,
  BIDDING_ENGINE_ABI,
  account,
} from "../services/blockchain";
import { parseEther } from "viem";
import { insertBid, getBidsByTask, insertActivity } from "../db";
import { authMiddleware } from "../middleware/auth";

export const bidRoutes = new Hono();

const biddingEngineDeployed = () =>
  CONTRACTS.biddingEngine !== "0x0000000000000000000000000000000000000000";

// ─── Submit Bid (Protected) ────────────────────────────────────
bidRoutes.post("/:taskId", authMiddleware, async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json();
  const { agentAddress, agentId, amount, estimatedHours, modelScore } = body;

  if (!agentAddress || !amount) {
    return c.json({ error: "Missing required: agentAddress, amount" }, 400);
  }

  let txHash: string | undefined;

  // Try on-chain submission if BiddingEngine is deployed
  if (biddingEngineDeployed()) {
    try {
      txHash = await walletClient.writeContract({
        address: CONTRACTS.biddingEngine,
        abi: BIDDING_ENGINE_ABI,
        functionName: "submitBid",
        args: [
          taskId as `0x${string}`,
          agentId || "",
          parseEther(amount.toString()),
          BigInt(estimatedHours || 24),
          BigInt(modelScore || 50),
        ],
        value: parseEther("0.001"),
      });
    } catch (err: any) {
      console.warn("[BIDS] On-chain bid failed, saving to DB only:", err.message);
    }
  }

  // Always persist to PostgreSQL
  try {
    const bid = await insertBid({
      taskId,
      agentId: agentId || "",
      agentAddress,
      amount: amount.toString(),
      estimatedHours: estimatedHours || 24,
      modelScore: modelScore || 50,
      reputation: "NEW",
      txHash,
    });

    // Record activity
    await insertActivity({
      type: "bid",
      agent: agentAddress.slice(0, 10) + "...",
      message: `bid ${amount} USDC on task ${taskId.slice(0, 10)}...`,
      taskId,
      txHash,
    });

    return c.json({
      success: true,
      bid,
      txHash: txHash || null,
      onChain: !!txHash,
      message: txHash ? "Bid submitted on-chain + DB" : "Bid stored in DB (chain unavailable)",
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
    const dbBids = await getBidsByTask(taskId);

    if (dbBids.length > 0) {
      return c.json({
        taskId,
        biddingOpen: true,
        totalBids: dbBids.length,
        bids: dbBids.map((b: any) => ({
          agentAddress: b.bidder_address,
          agentId: b.agent_id,
          amount: b.bid_price,
          agentReputation: b.model_score ? `${b.model_score}%` : "NEW",
          timestamp: new Date(b.submitted_at).getTime(),
          estimatedHours: b.estimated_hours,
          onChain: !!b.tx_hash,
        })),
        source: "database",
      });
    }

    // Fallback: try reading from chain if DB is empty
    if (biddingEngineDeployed()) {
      const count = await publicClient.readContract({
        address: CONTRACTS.biddingEngine,
        abi: BIDDING_ENGINE_ABI,
        functionName: "getBidCount",
        args: [taskId as `0x${string}`],
      }) as bigint;

      if (Number(count) > 0) {
        // Chain has bids, DB doesn't — this is an indexing gap
        return c.json({
          taskId,
          biddingOpen: true,
          totalBids: Number(count),
          bids: [],
          source: "chain_count_only",
          message: "Bids exist on-chain but are not yet indexed. Run sync.",
        });
      }
    }

    // No bids anywhere
    return c.json({
      taskId,
      biddingOpen: true,
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
    const dbBids = await getBidsByTask(taskId);

    if (biddingEngineDeployed()) {
      try {
        const count = await publicClient.readContract({
          address: CONTRACTS.biddingEngine,
          abi: BIDDING_ENGINE_ABI,
          functionName: "getBidCount",
          args: [taskId as `0x${string}`],
        }) as bigint;

        return c.json({
          taskId,
          biddingOpen: true,
          totalBids: Math.max(Number(count), dbBids.length),
          dbBids: dbBids.length,
          chainBids: Number(count),
        });
      } catch {}
    }

    return c.json({
      taskId,
      biddingOpen: true,
      totalBids: dbBids.length,
      dbBids: dbBids.length,
      chainBids: 0,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
