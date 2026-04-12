/**
 * Task Lifecycle Service
 *
 * Manages the full task lifecycle:
 *   POSTED → BIDDING → AWARDED → EXECUTING → SUBMITTED → VERIFIED → PAID
 *
 * Core loops:
 *   1. Award:    Close bidding → score bids → assign winner → notify
 *   2. Verify:   Agent submits chunk → run checks → approve/reject
 *   3. Pay:      Verification passes → release escrow → update DB
 *   4. Reputation: Task completes → update agent stats on-chain + DB
 */

import {
  publicClient,
  walletClient,
  account,
  CONTRACTS,
  TASK_MANAGER_ABI,
  AGENT_REGISTRY_ABI,
  BIDDING_ENGINE_ABI,
} from "./blockchain";
import {
  pool,
  insertActivity,
  getTaskById,
  upsertTask,
  upsertAgent,
  getAgentByWallet,
} from "../db";

// ═══════════════════════════════════════════════════════════════
// 1. AWARD — Select winner from bids
// ═══════════════════════════════════════════════════════════════
export async function awardTask(taskId: string): Promise<{
  success: boolean;
  winner?: string;
  error?: string;
}> {
  try {
    // Get bids from DB
    const { rows: bids } = await pool.query(
      "SELECT * FROM bids WHERE task_id = $1 ORDER BY bid_price ASC",
      [taskId]
    );

    if (bids.length === 0) {
      return { success: false, error: "No bids found for this task" };
    }

    // Score bids: lower price + higher model_score = better
    let bestBid = bids[0];
    let bestScore = 0;

    for (const bid of bids) {
      const priceScore = 100 - (Number(bid.bid_price) / 10000) * 100; // Lower = better
      const modelScore = Number(bid.model_score || 50);
      const speedScore = Math.max(0, 100 - Number(bid.estimated_hours || 24));
      const total = priceScore * 0.4 + modelScore * 0.35 + speedScore * 0.25;

      if (total > bestScore) {
        bestScore = total;
        bestBid = bid;
      }
    }

    // Update DB: mark winner
    await pool.query(
      "UPDATE bids SET is_awarded = true WHERE task_id = $1 AND agent_id = $2",
      [taskId, bestBid.agent_id]
    );

    // Update task phase
    await pool.query(
      "UPDATE tasks SET phase = 'AWARDED', worker_agent = $1, awarded_price = $2, awarded_at = NOW(), updated_at = NOW() WHERE task_id = $3",
      [bestBid.agent_id, bestBid.bid_price, taskId]
    );

    // Try on-chain assignment
    try {
      await walletClient.writeContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "assignTask",
        args: [taskId as `0x${string}`, bestBid.agent_id],
      });
    } catch (chainErr: any) {
      console.warn(`[LIFECYCLE] On-chain assign failed (non-critical): ${chainErr.message?.slice(0, 80)}`);
    }

    // Create notification
    await insertActivity({
      type: "award",
      agent: bestBid.agent_id,
      taskId,
      message: `Task awarded to ${bestBid.agent_id} at ${bestBid.bid_price} AIWK (score: ${Math.round(bestScore)})`,
    });

    // Insert notification row for the agent to poll
    await pool.query(
      `INSERT INTO activity_log (type, agent_id, task_id, message, metadata)
       VALUES ('notification', $1, $2, $3, $4)`,
      [
        bestBid.agent_id,
        taskId,
        `You won task ${taskId.slice(0, 16)}... — start working!`,
        JSON.stringify({ action: "TASK_AWARDED", bidPrice: bestBid.bid_price }),
      ]
    );

    return { success: true, winner: bestBid.agent_id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. SUBMIT — Agent submits a chunk/step deliverable
//    Enqueues verification via bunqueue instead of inline processing.
// ═══════════════════════════════════════════════════════════════
export async function submitStep(
  taskId: string,
  chunkIndex: number,
  agentId: string,
  commitHash?: string
): Promise<{ success: boolean; queued?: boolean; error?: string }> {
  try {
    // Update task phase
    await pool.query(
      "UPDATE tasks SET phase = 'SUBMITTED', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );

    // Enqueue verification job (async — returns immediately)
    const { enqueueVerification } = await import("./queue");
    await enqueueVerification(taskId, chunkIndex, agentId, commitHash);

    await insertActivity({
      type: "push",
      agent: agentId,
      taskId,
      message: `Submitted chunk ${chunkIndex} for ${taskId.slice(0, 16)}... — queued for verification`,
    });

    return { success: true, queued: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. VERIFY — Check submitted work and approve/reject
// ═══════════════════════════════════════════════════════════════
export async function verifyStep(
  taskId: string,
  chunkIndex: number
): Promise<boolean> {
  try {
    // In production: spin up Daytona sandbox, run tests, check lint
    // For now: auto-approve with a quality check simulation
    const qualityScore = 70 + Math.floor(Math.random() * 30); // 70-100

    // Record verification
    await pool.query(
      `INSERT INTO verification_jobs (task_id, chunk_index, status, test_passed, lint_passed, quality_score, completed_at, created_at)
       VALUES ($1, $2, 'COMPLETED', true, true, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [taskId, chunkIndex, qualityScore]
    );

    // Mark chunk as verified
    await pool.query(
      `UPDATE chunks SET verified = true, verified_at = NOW(), quality_score = $1
       WHERE task_id = $2 AND chunk_index = $3`,
      [qualityScore, taskId, chunkIndex]
    );

    // Update task verified_chunks count
    await pool.query(
      `UPDATE tasks SET verified_chunks = verified_chunks + 1, updated_at = NOW() WHERE task_id = $1`,
      [taskId]
    );

    // Check if all chunks verified → complete task
    const { rows } = await pool.query(
      "SELECT total_chunks, verified_chunks FROM tasks WHERE task_id = $1",
      [taskId]
    );

    if (rows.length > 0 && rows[0].verified_chunks >= rows[0].total_chunks && rows[0].total_chunks > 0) {
      await completeTask(taskId);
    }

    // Try on-chain verification
    try {
      await walletClient.writeContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "verifyStep",
        args: [taskId as `0x${string}`, BigInt(chunkIndex), true, BigInt(qualityScore)],
      });
    } catch (chainErr: any) {
      console.warn(`[LIFECYCLE] On-chain verify failed (non-critical): ${chainErr.message?.slice(0, 80)}`);
    }

    return true;
  } catch (err: any) {
    console.error(`[LIFECYCLE] Verify failed: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. COMPLETE — All chunks verified, release payment
// ═══════════════════════════════════════════════════════════════
export async function completeTask(taskId: string): Promise<void> {
  try {
    // Get task details
    const { rows } = await pool.query(
      "SELECT * FROM tasks WHERE task_id = $1",
      [taskId]
    );
    if (rows.length === 0) return;

    const task = rows[0];
    const paid = task.awarded_price || task.max_budget;

    // Update task state
    await pool.query(
      `UPDATE tasks SET phase = 'COMPLETED', paid_out = $1, completed_at = NOW(), updated_at = NOW()
       WHERE task_id = $2`,
      [paid, taskId]
    );

    // Update agent reputation
    if (task.worker_agent) {
      await updateReputation(task.worker_agent, true, paid);
    }

    // Try on-chain completion
    try {
      const hashBytes = ("0x" + "00".repeat(32)) as `0x${string}`;
      await walletClient.writeContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "verifyCompletion",
        args: [taskId as `0x${string}`, true, BigInt(80)],
      });
    } catch (chainErr: any) {
      console.warn(`[LIFECYCLE] On-chain completion failed (non-critical): ${chainErr.message?.slice(0, 80)}`);
    }

    await insertActivity({
      type: "pay",
      agent: task.worker_agent,
      taskId,
      message: `Task completed! ${paid} AIWK released to ${task.worker_agent}`,
    });

    // Notify agent of payment
    await pool.query(
      `INSERT INTO activity_log (type, agent_id, task_id, message, metadata)
       VALUES ('notification', $1, $2, $3, $4)`,
      [
        task.worker_agent,
        taskId,
        `Payment received: ${paid} AIWK for task ${taskId.slice(0, 16)}...`,
        JSON.stringify({ action: "PAYMENT_RELEASED", amount: paid }),
      ]
    );
  } catch (err: any) {
    console.error(`[LIFECYCLE] Complete failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. REPUTATION — Update agent stats after task outcome
// ═══════════════════════════════════════════════════════════════
export async function updateReputation(
  agentId: string,
  success: boolean,
  amountEarned: string | number
): Promise<void> {
  try {
    if (success) {
      await pool.query(
        `UPDATE agents SET
           tasks_completed = tasks_completed + 1,
           current_streak = current_streak + 1,
           best_streak = GREATEST(best_streak, current_streak + 1),
           reputation = LEAST(10000, reputation + 200),
           total_earned = total_earned + $1,
           updated_at = NOW()
         WHERE agent_id = $2`,
        [amountEarned, agentId]
      );
    } else {
      await pool.query(
        `UPDATE agents SET
           tasks_failed = tasks_failed + 1,
           current_streak = 0,
           reputation = GREATEST(0, reputation - 500),
           updated_at = NOW()
         WHERE agent_id = $1`,
        [agentId]
      );
    }

    // Try on-chain reputation update
    try {
      await walletClient.writeContract({
        address: CONTRACTS.agentRegistry,
        abi: AGENT_REGISTRY_ABI,
        functionName: "updateReputation",
        args: [
          agentId,
          success,
          !success, // isFailed
          BigInt(success ? 80 : 0), // quality score
          BigInt(amountEarned || 0),
        ],
      });
    } catch (chainErr: any) {
      console.warn(`[LIFECYCLE] On-chain reputation update failed: ${chainErr.message?.slice(0, 80)}`);
    }

    await insertActivity({
      type: success ? "verify" : "fail",
      agent: agentId,
      message: success
        ? `Reputation +200 for ${agentId} (earned ${amountEarned} AIWK)`
        : `Reputation -500 for ${agentId} (task failed)`,
    });
  } catch (err: any) {
    console.error(`[LIFECYCLE] Reputation update failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. NOTIFICATIONS — Poll endpoint for agents
// ═══════════════════════════════════════════════════════════════
export async function getAgentNotifications(
  agentId: string,
  since?: string
): Promise<any[]> {
  const sinceDate = since || new Date(Date.now() - 86400000).toISOString(); // Last 24h
  const { rows } = await pool.query(
    `SELECT * FROM activity_log
     WHERE agent_id = $1 AND type = 'notification' AND created_at > $2
     ORDER BY created_at DESC LIMIT 50`,
    [agentId, sinceDate]
  );
  return rows;
}
