/**
 * Off-chain coordination for the canonical TaskManager V1 lifecycle.
 *
 * Economic state changes are finalized on-chain first. PostgreSQL contains
 * searchable bids, repository state, verification evidence, and notifications.
 */

import { publicClient, walletClient, CONTRACTS, TASK_MANAGER_ABI } from "./blockchain";
import { pool, insertActivity } from "../db";
import { randomUUID } from "node:crypto";

export async function awardTask(taskId: string): Promise<{
  success: boolean;
  winner?: string;
  txHash?: string;
  error?: string;
}> {
  const operationKey = `task-award:${taskId}`;
  let operation: any;
  const prepare = await pool.connect();
  try {
    await prepare.query("BEGIN");
    await prepare.query("SELECT pg_advisory_xact_lock(hashtext($1))", [operationKey]);
    const { rows: tasks } = await prepare.query(
      "SELECT * FROM tasks WHERE task_id = $1 FOR UPDATE",
      [taskId]
    );
    if (tasks.length === 0) throw new Error("Task not found");
    const task = tasks[0];
    if (task.phase === "IN_PROGRESS" && task.worker_agent) {
      await prepare.query("COMMIT");
      return { success: true, winner: task.worker_agent };
    }

    const existing = await prepare.query("SELECT * FROM chain_operations WHERE operation_key = $1", [operationKey]);
    if (existing.rowCount) {
      operation = existing.rows[0];
      await prepare.query("COMMIT");
    } else {
    if (!["OPEN", "POSTED", "BIDDING"].includes(task.phase)) {
      throw new Error(`Task cannot be awarded from phase ${task.phase}`);
    }
    if (task.bidding_ends && new Date(task.bidding_ends).getTime() > Date.now()) {
      throw new Error(`Bidding remains open until ${new Date(task.bidding_ends).toISOString()}`);
    }

    const { rows: bids } = await prepare.query(
      `SELECT b.*, a.reputation, a.benchmark_score
       FROM bids b
       JOIN agents a ON a.agent_id = b.agent_id AND a.status = 'ACTIVE'
       WHERE b.task_id = $1 AND b.bid_price > 0 AND b.bid_price <= $2
       ORDER BY b.bid_price ASC`,
      [taskId, task.max_budget]
    );
    if (bids.length === 0) throw new Error("No eligible bids found for this task");

    let bestBid = bids[0];
    let bestScore = -1;
    const budget = Number(task.max_budget);
    for (const bid of bids) {
      const priceScore = Math.max(0, ((budget - Number(bid.bid_price)) / budget) * 100);
      const reputationScore = Math.min(100, Number(bid.reputation || 0) / 100);
      const benchmarkScore = Math.min(100, Number(bid.benchmark_score || 0));
      const speedScore = Math.max(0, 100 - Number(bid.estimated_hours || 24));
      const qualityScore = benchmarkScore > 0 ? benchmarkScore : reputationScore;
      const total = priceScore * 0.35 + qualityScore * 0.35 + reputationScore * 0.2 + speedScore * 0.1;
      if (total > bestScore) {
        bestScore = total;
        bestBid = bid;
      }
    }

      const payload = { winner: bestBid.agent_id, bidPrice: String(bestBid.bid_price), score: Math.round(bestScore) };
      const { rows } = await prepare.query(
        `INSERT INTO chain_operations (id, operation_key, operation_type, resource_id, payload)
         VALUES ($1, $2, 'TASK_AWARD', $3, $4) RETURNING *`,
        [randomUUID(), operationKey, taskId, payload]
      );
      operation = rows[0];
      await prepare.query("COMMIT");
    }
  } catch (err: any) {
    await prepare.query("ROLLBACK").catch(() => {});
    return { success: false, error: err.message };
  } finally {
    prepare.release();
  }

  const payload = operation.payload;
  let txHash = operation.tx_hash as `0x${string}` | undefined;
  try {
    // Reconcile chain state before broadcasting. This closes the crash window
    // where a previous transaction finalized before its hash reached Postgres.
    const chainTask = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "getTask",
      args: [taskId as `0x${string}`],
    }) as unknown as any[];
    const chainWinner = String(chainTask[2] || "");
    if (chainWinner && chainWinner !== payload.winner) {
      throw new Error(`Chain already assigned task to ${chainWinner}, expected ${payload.winner}`);
    }

    if (!chainWinner && txHash) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const confirmed = await publicClient.readContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "getTask",
        args: [taskId as `0x${string}`],
      }) as unknown as any[];
      if (String(confirmed[2] || "") !== payload.winner) {
        throw new Error("Submitted award transaction did not finalize the expected winner");
      }
    } else if (!chainWinner) {
      txHash = await walletClient.writeContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "assignTask",
        args: [taskId as `0x${string}`, payload.winner],
      });
      await pool.query(
        `UPDATE chain_operations SET status = 'SUBMITTED', tx_hash = $1, attempts = attempts + 1, updated_at = NOW()
         WHERE operation_key = $2`, [txHash, operationKey]
      );
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }
    await pool.query(
      `UPDATE chain_operations SET status = 'CONFIRMED', tx_hash = COALESCE($1, tx_hash), error = NULL, updated_at = NOW()
       WHERE operation_key = $2`, [txHash || null, operationKey]
    );

    const projection = await pool.connect();
    let projected = false;
    try {
      await projection.query("BEGIN");
      const taskUpdate = await projection.query(
        `UPDATE tasks SET phase = 'IN_PROGRESS', worker_agent = $1, awarded_price = $2, awarded_at = COALESCE(awarded_at, NOW()), updated_at = NOW()
         WHERE task_id = $3 AND (phase IN ('OPEN', 'POSTED', 'BIDDING') OR worker_agent = $1)
         RETURNING task_id`,
        [payload.winner, payload.bidPrice, taskId]
      );
      if (!taskUpdate.rowCount) throw new Error("Local task state conflicts with finalized chain assignment");
      projected = true;
      await projection.query(
        "UPDATE bids SET is_awarded = (agent_id = $2), composite_score = CASE WHEN agent_id = $2 THEN $3 ELSE composite_score END WHERE task_id = $1",
        [taskId, payload.winner, payload.score]
      );
      await projection.query(
        "UPDATE chain_operations SET status = 'PROJECTED', updated_at = NOW() WHERE operation_key = $1",
        [operationKey]
      );
      await projection.query("COMMIT");
    } catch (error) {
      await projection.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      projection.release();
    }

    if (projected) try {
      await insertActivity({
        type: "award",
        agent: payload.winner,
        taskId,
        message: `Task awarded to ${payload.winner} at ${payload.bidPrice} (score: ${payload.score})`,
      });
      await pool.query(
        `INSERT INTO activity_log (type, agent_id, task_id, message, metadata)
         VALUES ('notification', $1, $2, $3, $4)`,
        [
          payload.winner,
          taskId,
          `You won task ${taskId.slice(0, 16)}...`,
          JSON.stringify({ action: "TASK_AWARDED", bidPrice: payload.bidPrice, txHash, operationKey }),
        ]
      );
    } catch (notificationError: any) {
      console.warn(`[LIFECYCLE] Award finalized but notification failed: ${notificationError.message}`);
    }

    return { success: true, winner: payload.winner, txHash };
  } catch (err: any) {
    await pool.query(
      `UPDATE chain_operations SET status = CASE WHEN status IN ('SUBMITTED', 'CONFIRMED') THEN status ELSE 'FAILED' END,
       error = $1, updated_at = NOW() WHERE operation_key = $2`,
      [err.message, operationKey]
    ).catch(() => {});
    return { success: false, error: err.message };
  }
}

export async function submitStep(
  taskId: string,
  chunkIndex: number,
  agentId: string,
  commitHash?: string
): Promise<{ success: boolean; queued?: boolean; error?: string }> {
  try {
    if (!commitHash || !/^[0-9a-f]{40}$/i.test(commitHash)) {
      return { success: false, error: "A full 40-character Git commit SHA is required" };
    }
    const { rows } = await pool.query(
      `SELECT t.worker_agent, t.phase, c.verified, s.repo_url, s.test_command
       FROM tasks t
       JOIN chunks c ON c.task_id = t.task_id AND c.chunk_index = $2
       JOIN task_specs s ON s.task_id = t.task_id
       WHERE t.task_id = $1 LIMIT 1`,
      [taskId, chunkIndex]
    );
    if (rows.length === 0) return { success: false, error: "Task, chunk, or TaskSpec not found" };
    if (rows[0].worker_agent !== agentId) return { success: false, error: "Agent is not assigned to this task" };
    if (!["IN_PROGRESS", "EXECUTING", "SUBMITTED"].includes(rows[0].phase)) {
      return { success: false, error: `Task cannot accept work in phase ${rows[0].phase}` };
    }
    if (rows[0].verified) return { success: false, error: "Chunk is already verified" };
    if (!rows[0].repo_url || !rows[0].test_command) {
      return { success: false, error: "TaskSpec is missing repository or test configuration" };
    }

    await pool.query(
      "UPDATE tasks SET phase = 'SUBMITTED', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );
    const { enqueueVerification } = await import("./queue");
    await enqueueVerification(taskId, chunkIndex, agentId, commitHash);
    await insertActivity({
      type: "push",
      agent: agentId,
      taskId,
      message: `Submitted chunk ${chunkIndex} at commit ${commitHash}`,
    });
    return { success: true, queued: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getAgentNotifications(
  agentId: string,
  since?: string
): Promise<any[]> {
  const sinceDate = since || new Date(Date.now() - 86_400_000).toISOString();
  const { rows } = await pool.query(
    `SELECT * FROM activity_log
     WHERE agent_id = $1 AND type = 'notification' AND created_at > $2
     ORDER BY created_at DESC LIMIT 50`,
    [agentId, sinceDate]
  );
  return rows;
}
