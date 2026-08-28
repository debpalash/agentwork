/**
 * Enforceable dispute projection.
 *
 * Parties open disputes and arbiters vote with their own wallets. The API
 * verifies finalized chain receipts, assigns a deterministic panel from the
 * configured bonded arbiter pool, and projects authoritative chain state into
 * PostgreSQL for discovery. Database writes never decide or settle a case.
 */

import { Hono } from "hono";
import { isAddress, keccak256, toHex, type Address, type Hash } from "viem";
import { pool } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import {
  account,
  CONTRACTS,
  DISPUTE_RESOLUTION_ABI,
  publicClient,
  TASK_MANAGER_ABI,
  walletClient,
} from "../services/blockchain";
import type { AppEnv } from "../types";

export const disputeRoutes = new Hono<AppEnv>();

const STATUS = ["OPEN", "VOTING", "RESOLVED"] as const;
const RESOLUTION = ["NONE", "FAVOR_WORKER", "FAVOR_POSTER", "SPLIT"] as const;

function configuredArbiters(): Address[] {
  const seen = new Set<string>();
  return (process.env.ARBITER_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is Address => isAddress(value))
    .filter((value) => {
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

async function selectPanel(
  taskId: string,
  blockHash: string,
  partyWallets: string[]
): Promise<[Address, Address, Address]> {
  const candidates = configuredArbiters().filter(
    (candidate) => !partyWallets.includes(candidate.toLowerCase())
  );
  if (candidates.length < 3) {
    throw new Error("At least three non-party ARBITER_ADDRESSES are required");
  }
  const role = await publicClient.readContract({
    address: CONTRACTS.disputeResolution,
    abi: DISPUTE_RESOLUTION_ABI,
    functionName: "ARBITER_ROLE",
  });
  const minimumStake = await publicClient.readContract({
    address: CONTRACTS.disputeResolution,
    abi: DISPUTE_RESOLUTION_ABI,
    functionName: "minimumArbiterStake",
  });
  const eligible: Address[] = [];
  for (const candidate of candidates) {
    const [hasRole, stake] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.disputeResolution,
        abi: DISPUTE_RESOLUTION_ABI,
        functionName: "hasRole",
        args: [role, candidate],
      }),
      publicClient.readContract({
        address: CONTRACTS.disputeResolution,
        abi: DISPUTE_RESOLUTION_ABI,
        functionName: "arbiterStake",
        args: [candidate],
      }),
    ]);
    if (hasRole && stake >= minimumStake) eligible.push(candidate);
  }
  if (eligible.length < 3) {
    throw new Error("At least three configured arbiters must hold the on-chain role and minimum stake");
  }

  // The finalized opening block is unknown before the opener commits their
  // bond. Sorting by that block, task, and candidate prevents panel shopping
  // by either task party while remaining reproducible for audit.
  eligible.sort((left, right) =>
    keccak256(toHex(`${blockHash}:${taskId}:${left.toLowerCase()}`)).localeCompare(
      keccak256(toHex(`${blockHash}:${taskId}:${right.toLowerCase()}`))
    )
  );
  return [eligible[0]!, eligible[1]!, eligible[2]!];
}

async function readChainState(chainDisputeId: bigint) {
  const result = await publicClient.readContract({
    address: CONTRACTS.disputeResolution,
    abi: DISPUTE_RESOLUTION_ABI,
    functionName: "getDisputeState",
    args: [chainDisputeId],
  }) as readonly [Hash, number, number, number, readonly Address[], readonly number[], bigint];
  return {
    taskId: result[0],
    status: STATUS[Number(result[1])] || "OPEN",
    resolution: RESOLUTION[Number(result[2])] || "NONE",
    votesReceived: Number(result[3]),
    arbiters: [...result[4]],
    votes: result[5]
      .map((vote, index) => ({ arbiter: result[4][index], vote: RESOLUTION[Number(vote)] }))
      .filter((entry) => entry.vote !== "NONE"),
    resolvedAt: Number(result[6]) > 0 ? new Date(Number(result[6]) * 1000) : null,
  };
}

async function projectChainState(id: string, settlementTxHash?: string) {
  const current = await pool.query(
    "SELECT chain_dispute_id FROM disputes WHERE id = $1 LIMIT 1",
    [id]
  );
  if (!current.rowCount || current.rows[0].chain_dispute_id == null) return null;
  const state = await readChainState(BigInt(current.rows[0].chain_dispute_id));
  const workerShareBps = state.resolution === "FAVOR_WORKER"
    ? 10000
    : state.resolution === "FAVOR_POSTER" ? 0 : state.resolution === "SPLIT" ? 5000 : null;
  const { rows } = await pool.query(
    `UPDATE disputes SET status = $1, resolution = $2, arbiters = $3, votes = $4,
       resolved_at = $5, settlement_status = $6,
       worker_share_bps = $7,
       settlement_tx_hash = COALESCE($8, settlement_tx_hash)
     WHERE id = $9 RETURNING *`,
    [state.status, state.resolution, state.arbiters, JSON.stringify(state.votes), state.resolvedAt,
      state.status === "RESOLVED" ? "SETTLED" : "PENDING_VOTES",
      workerShareBps, settlementTxHash || null, id]
  );
  return rows[0];
}

// The wallet first executes TaskManager.openDispute. This endpoint then
// verifies that finalized receipt and assigns a panel; it cannot forge an open.
disputeRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const taskId = String(body.taskId || "");
  const reason = String(body.reason || "").trim();
  const openTxHash = String(body.openTxHash || "") as Hash;
  const authenticatedWallet = c.get("walletAddress")?.toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(taskId) || !reason || !/^0x[0-9a-fA-F]{64}$/.test(openTxHash)) {
    return c.json({ error: "taskId, reason, and finalized openTxHash are required" }, 400);
  }
  if (!authenticatedWallet) return c.json({ error: "Wallet authentication is required" }, 401);

  try {
    const existing = await pool.query(
      "SELECT * FROM disputes WHERE tx_hash = $1 OR (task_id = $2 AND status IN ('OPEN','VOTING')) LIMIT 1",
      [openTxHash, taskId]
    );
    if (existing.rowCount) return c.json({ success: true, dispute: existing.rows[0], idempotent: true });

    const [receipt, transaction] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: openTxHash }),
      publicClient.getTransaction({ hash: openTxHash }),
    ]);
    if (receipt.status !== "success" || transaction.from.toLowerCase() !== authenticatedWallet ||
        transaction.to?.toLowerCase() !== CONTRACTS.taskManager.toLowerCase()) {
      return c.json({ error: "The transaction is not a successful authenticated TaskManager call" }, 409);
    }

    const decoded = await publicClient.getContractEvents({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      eventName: "TaskDisputed",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      args: { taskId: taskId as Hash },
      strict: true,
    });
    const event = decoded.find((candidate) => candidate.transactionHash === openTxHash);
    const chainDisputeId = event?.args.disputeId ?? null;
    const eventOpener = String(event?.args.opener || "").toLowerCase();
    const eventReasonHash = String(event?.args.reasonHash || "").toLowerCase();
    if (chainDisputeId == null || eventOpener !== authenticatedWallet ||
        eventReasonHash !== keccak256(toHex(reason)).toLowerCase()) {
      return c.json({ error: "Finalized TaskDisputed event does not match this request" }, 409);
    }

    const { rows: parties } = await pool.query(
      `SELECT t.employer, a.wallet_address AS worker_wallet
       FROM tasks t LEFT JOIN agents a ON a.agent_id = t.worker_agent
       WHERE t.task_id = $1 LIMIT 1`,
      [taskId]
    );
    if (!parties.length) return c.json({ error: "Task is not indexed by this platform" }, 404);
    const partyWallets = [parties[0].employer, parties[0].worker_wallet]
      .filter(Boolean)
      .map((value: string) => value.toLowerCase());
    if (!partyWallets.includes(authenticatedWallet)) {
      return c.json({ error: "Authenticated wallet is not an indexed task party" }, 403);
    }

    let chainState = await readChainState(chainDisputeId);
    let panelTxHash: Hash | null = null;
    if (chainState.status === "OPEN") {
      const panel = await selectPanel(taskId, receipt.blockHash, partyWallets);
      panelTxHash = await walletClient.writeContract({
        account,
        address: CONTRACTS.disputeResolution,
        abi: DISPUTE_RESOLUTION_ABI,
        functionName: "assignPanel",
        args: [chainDisputeId, panel],
      });
      await publicClient.waitForTransactionReceipt({ hash: panelTxHash });
      chainState = await readChainState(chainDisputeId);
    }
    if (chainState.status !== "VOTING") {
      return c.json({ error: `On-chain dispute is unexpectedly ${chainState.status}` }, 409);
    }

    const { rows } = await pool.query(
      `INSERT INTO disputes
       (task_id, opener_address, reason, status, resolution, arbiters, votes, tx_hash,
        chain_dispute_id, settlement_status)
       VALUES ($1,$2,$3,'VOTING','NONE',$4,'[]',$5,$6,'PENDING_VOTES') RETURNING *`,
      [taskId, authenticatedWallet, reason, chainState.arbiters, openTxHash, chainDisputeId.toString()]
    );
    return c.json({
      success: true,
      dispute: rows[0],
      panelTxHash,
      message: "Bonded dispute finalized on-chain and panel assigned.",
    }, 201);
  } catch (error: any) {
    return c.json({ error: error.shortMessage || error.message }, 409);
  }
});

// Anyone may reconcile public chain state. A supplied resolution receipt is
// verified before it is attached to the settlement projection.
disputeRoutes.post("/:id/sync", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const txHash = body.txHash ? String(body.txHash) as Hash : undefined;
  try {
    let verifiedSettlementHash: string | undefined;
    if (txHash) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return c.json({ error: "Invalid txHash" }, 400);
      const indexed = await pool.query("SELECT chain_dispute_id FROM disputes WHERE id = $1", [id]);
      if (!indexed.rowCount) return c.json({ error: "Dispute not found" }, 404);
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success" || !receipt.logs.some(
        (log) => log.address.toLowerCase() === CONTRACTS.disputeResolution.toLowerCase()
      )) return c.json({ error: "Not a successful dispute resolution transaction" }, 409);
      const events = await publicClient.getContractEvents({
        address: CONTRACTS.disputeResolution,
        abi: DISPUTE_RESOLUTION_ABI,
        eventName: "DisputeResolved",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
        args: { disputeId: BigInt(indexed.rows[0].chain_dispute_id) },
        strict: true,
      });
      if (events.some((event) => event.transactionHash === txHash)) verifiedSettlementHash = txHash;
    }
    const dispute = await projectChainState(id, verifiedSettlementHash);
    if (!dispute) return c.json({ error: "Dispute not found" }, 404);
    return c.json({ success: true, dispute });
  } catch (error: any) {
    return c.json({ error: error.shortMessage || error.message }, 409);
  }
});

disputeRoutes.post("/:id/vote", async (c) => c.json({
  error: "Arbiters must vote directly with their assigned wallet on DisputeResolution.vote; API votes are not authoritative.",
}, 409));

disputeRoutes.post("/:id/cancel", async (c) => c.json({
  error: "Bonded disputes cannot be unilaterally cancelled after escrow is frozen.",
}, 409));

disputeRoutes.get("/task/all", async (c) => {
  const result = await pool.query("SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100");
  return c.json({ disputes: result.rows, total: result.rows.length });
});

disputeRoutes.get("/task/:taskId", async (c) => {
  const result = await pool.query(
    "SELECT * FROM disputes WHERE task_id = $1 ORDER BY created_at DESC",
    [c.req.param("taskId")]
  );
  return c.json({ disputes: result.rows, total: result.rows.length });
});

disputeRoutes.get("/:id", async (c) => {
  try {
    const dispute = await projectChainState(c.req.param("id"));
    if (!dispute) return c.json({ error: "Dispute not found" }, 404);
    return c.json(dispute);
  } catch (error: any) {
    return c.json({ error: error.shortMessage || error.message }, 409);
  }
});
