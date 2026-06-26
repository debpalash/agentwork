/**
 * AIWork Job Queue Service — Powered by bunqueue
 *
 * Replaces Redis with SQLite-based job queues for:
 *   1. Task verification — async sandbox runs with DLQ
 *   2. Bidding deadline — cron-based auto-close + auto-award
 *   3. Notifications — reliable delivery to agents
 *   4. Reputation updates — async on-chain writes with retry
 *
 * Uses embedded mode (in-process, zero network overhead).
 */

import { Queue, Worker } from "bunqueue/client";
import {
  completeTask,
  awardTask,
  updateReputation,
} from "./lifecycle";
import { pool, insertActivity } from "../db";
import { VERIFICATION_PASS_THRESHOLD } from "../constants";

// ─── Queue Definitions ─────────────────────────────────────────
const EMBEDDED = { embedded: true };

export const verificationQueue = new Queue<{
  taskId: string;
  chunkIndex: number;
  agentId: string;
  commitHash?: string;
}>("verification", EMBEDDED);

export const biddingDeadlineQueue = new Queue<{
  taskId: string;
  title: string;
}>("bidding-deadline", EMBEDDED);

export const notificationQueue = new Queue<{
  agentId: string;
  taskId: string;
  message: string;
  action: string;
  metadata?: Record<string, unknown>;
}>("notifications", EMBEDDED);

export const reputationQueue = new Queue<{
  agentId: string;
  success: boolean;
  amountEarned: string | number;
}>("reputation", EMBEDDED);

/**
 * VERIFICATION WORKER
 * Processes chunk submissions in a Daytona sandbox:
 *   1. Clone repo → 2. Install deps → 3. Run tests → 4. Run lint → 5. Score
 * Falls back to simulated verification if Daytona is not configured.
 */
const verificationWorker = new Worker(
  "verification",
  async (job) => {
    const { taskId, chunkIndex, agentId, commitHash } = job.data;
    console.log(`[QUEUE:verify] Processing ${taskId.slice(0, 16)}... chunk ${chunkIndex}`);

    // Mark chunk as submitted in DB
    await pool.query(
      `UPDATE chunks SET submitted = true, submitted_at = NOW(), commit_hash = $1
       WHERE task_id = $2 AND chunk_index = $3`,
      [commitHash || null, taskId, chunkIndex]
    );

    await job.updateProgress(10);

    // Run sandbox verification (Daytona or simulated fallback)
    const { verifySandbox, recordVerification } = await import("./sandbox");
    const result = await verifySandbox(taskId, chunkIndex);

    await job.updateProgress(80);

    // Record to verification_jobs table
    await recordVerification(taskId, chunkIndex, result);

    // Mark chunk verified if quality OK
    const verified = result.qualityScore >= VERIFICATION_PASS_THRESHOLD;
    if (verified) {
      await pool.query(
        `UPDATE chunks SET verified = true, verified_at = NOW(), quality_score = $1
         WHERE task_id = $2 AND chunk_index = $3`,
        [result.qualityScore, taskId, chunkIndex]
      );
      await pool.query(
        `UPDATE tasks SET verified_chunks = verified_chunks + 1, updated_at = NOW() WHERE task_id = $1`,
        [taskId]
      );
    }

    // Check if all chunks verified → complete task
    const { rows } = await pool.query(
      "SELECT total_chunks, verified_chunks FROM tasks WHERE task_id = $1",
      [taskId]
    );
    if (rows.length > 0 && rows[0].verified_chunks >= rows[0].total_chunks && rows[0].total_chunks > 0) {
      await completeTask(taskId);
    }

    // Log the result
    await insertActivity({
      type: "verify",
      agent: agentId,
      taskId,
      message: `Chunk ${chunkIndex} ${verified ? "VERIFIED ✓" : "FAILED ✗"} via ${result.mode} (score: ${result.qualityScore}, ${result.executionTimeMs}ms)`,
    });

    // Notify agent
    await notificationQueue.add("chunk-verified", {
      agentId,
      taskId,
      message: `Chunk ${chunkIndex} ${verified ? "verified ✓" : "needs revision"} (${result.mode}: score ${result.qualityScore})`,
      action: verified ? "CHUNK_VERIFIED" : "CHUNK_REJECTED",
    });

    await job.updateProgress(100);
    return { verified, chunkIndex, ...result };
  },
  {
    ...EMBEDDED,
    concurrency: 3,
  }
);

/**
 * BIDDING DEADLINE WORKER
 * Auto-closes bidding and selects winner after deadline.
 * Jobs are delayed — added when bidding opens with a delay.
 */
const biddingDeadlineWorker = new Worker(
  "bidding-deadline",
  async (job) => {
    const { taskId, title } = job.data;
    console.log(`[QUEUE:deadline] Closing bidding on "${title}"`);

    // Award the task
    const result = await awardTask(taskId);

    if (result.success) {
      console.log(`[QUEUE:deadline] 🏆 Winner: ${result.winner}`);

      // Notify all bidders
      const { rows: bids } = await pool.query(
        "SELECT agent_id FROM bids WHERE task_id = $1",
        [taskId]
      );

      for (const bid of bids) {
        const isWinner = bid.agent_id === result.winner;
        await notificationQueue.add("bid-result", {
          agentId: bid.agent_id,
          taskId,
          message: isWinner
            ? `🏆 You won "${title}"! Start working now.`
            : `Bidding closed on "${title}" — another agent was selected.`,
          action: isWinner ? "TASK_AWARDED" : "BID_LOST",
        });
      }
    } else {
      console.log(`[QUEUE:deadline] No bids — task remains open`);
    }

    return result;
  },
  {
    ...EMBEDDED,
    concurrency: 1, // Serial — avoid race conditions on award
  }
);

/**
 * NOTIFICATION WORKER
 * Persists notifications to the database for agent polling.
 * Reliable delivery via DLQ if DB write fails.
 */
const notificationWorker = new Worker(
  "notifications",
  async (job) => {
    const { agentId, taskId, message, action, metadata } = job.data;

    await pool.query(
      `INSERT INTO activity_log (type, agent_id, task_id, message, metadata)
       VALUES ('notification', $1, $2, $3, $4)`,
      [agentId, taskId, message, JSON.stringify({ action, ...metadata })]
    );

    await job.updateProgress(100);
    return { delivered: true };
  },
  {
    ...EMBEDDED,
    concurrency: 5,
  }
);

/**
 * REPUTATION WORKER
 * Updates agent reputation stats in DB and on-chain.
 * Retried 3 times with backoff if on-chain write fails.
 */
const reputationWorker = new Worker(
  "reputation",
  async (job) => {
    const { agentId, success, amountEarned } = job.data;
    console.log(`[QUEUE:reputation] Updating ${agentId}: ${success ? "+200" : "-500"}`);
    await updateReputation(agentId, success, amountEarned);
    return { updated: true };
  },
  {
    ...EMBEDDED,
    concurrency: 2,
  }
);

// ─── Event Logging ─────────────────────────────────────────────
verificationWorker.on("completed", (job, result) => {
  console.log(`[QUEUE:verify] ✅ Job ${job.id} done: chunk ${result?.chunkIndex} verified=${result?.verified}`);
});

verificationWorker.on("failed", (job, error) => {
  console.error(`[QUEUE:verify] ❌ Job ${job.id} failed: ${error.message}`);
});

biddingDeadlineWorker.on("completed", (job, result) => {
  console.log(`[QUEUE:deadline] ✅ Bidding closed for ${job.data.taskId.slice(0, 16)}... winner=${result?.winner || "none"}`);
});

notificationWorker.on("failed", (job, error) => {
  console.error(`[QUEUE:notify] ❌ Failed to deliver to ${job.data.agentId}: ${error.message}`);
});

// ─── Public API ────────────────────────────────────────────────

/**
 * Enqueue a verification job for a submitted chunk.
 */
export async function enqueueVerification(
  taskId: string,
  chunkIndex: number,
  agentId: string,
  commitHash?: string
) {
  await verificationQueue.add(`verify-${taskId}-${chunkIndex}`, {
    taskId,
    chunkIndex,
    agentId,
    commitHash,
  }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

/**
 * Schedule bidding auto-close after N hours.
 */
export async function scheduleBiddingDeadline(
  taskId: string,
  title: string,
  delayHours: number = 48
) {
  await biddingDeadlineQueue.add(`deadline-${taskId}`, {
    taskId,
    title,
  }, {
    delay: delayHours * 60 * 60 * 1000,
    attempts: 2,
  });
  console.log(`[QUEUE] Bidding deadline scheduled: "${title}" in ${delayHours}h`);
}

/**
 * Send a notification to an agent.
 */
export async function enqueueNotification(
  agentId: string,
  taskId: string,
  message: string,
  action: string,
  metadata?: Record<string, unknown>
) {
  await notificationQueue.add(`notify-${agentId}-${Date.now()}`, {
    agentId,
    taskId,
    message,
    action,
    metadata,
  });
}

/**
 * Enqueue a reputation update (deferred to avoid blocking the critical path).
 */
export async function enqueueReputationUpdate(
  agentId: string,
  success: boolean,
  amountEarned: string | number
) {
  await reputationQueue.add(`rep-${agentId}-${Date.now()}`, {
    agentId,
    success,
    amountEarned,
  }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });
}

/**
 * Get queue health stats for monitoring.
 */
export async function getQueueStats() {
  return {
    verification: await verificationQueue.getJobCounts(),
    biddingDeadline: await biddingDeadlineQueue.getJobCounts(),
    notifications: await notificationQueue.getJobCounts(),
    reputation: await reputationQueue.getJobCounts(),
  };
}

console.log("[QUEUE] bunqueue workers started (embedded mode, SQLite WAL)");
console.log("[QUEUE] Queues: verification (3), bidding-deadline (1), notifications (5), reputation (2)");
