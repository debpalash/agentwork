/**
 * AIWork durable job queue — PostgreSQL SKIP LOCKED workers
 *
 * Uses the existing PostgreSQL control plane for:
 *   1. Task verification — async sandbox runs with DLQ
 *   2. Bidding deadline — cron-based auto-close + auto-award
 *   3. Notifications — reliable delivery to agents
 *
 * API replicas enqueue only. Dedicated scheduler/verifier processes claim jobs
 * atomically, survive restarts, and expose failed jobs as a durable DLQ.
 */

import { randomUUID } from "node:crypto";
import { awardTask } from "./lifecycle";
import { pool, insertActivity } from "../db";
import { publicClient, walletClient, CONTRACTS, TASK_MANAGER_ABI, account } from "./blockchain";
import { keccak256, toHex } from "viem";

type VerificationJob = {
  taskId: string;
  chunkIndex: number;
  agentId: string;
  commitHash?: string;
};
type BiddingDeadlineJob = { taskId: string; title: string };
type NotificationJob = {
  agentId: string;
  taskId: string;
  message: string;
  action: string;
  metadata?: Record<string, unknown>;
};
type QueueName = "verification" | "bidding-deadline" | "notifications";
type ProgressReporter = (progress: number) => Promise<void>;

/**
 * VERIFICATION WORKER
 * Processes chunk submissions in a Daytona sandbox:
 *   1. Clone repo → 2. Install deps → 3. Run tests → 4. Run lint → 5. Score
 * Development can use an explicitly marked deterministic fixture when
 * Daytona is not configured. Production fails closed.
 */
async function processVerificationJob(data: VerificationJob, updateProgress: ProgressReporter) {
    const { taskId, chunkIndex, agentId, commitHash } = data;
    console.log(`[QUEUE:verify] Processing ${taskId.slice(0, 16)}... chunk ${chunkIndex}`);

    if (!commitHash) throw new Error("A full Git commit SHA is required");

    // Resolve all verification inputs from trusted platform state. Never let a
    // worker choose the repository or acceptance command at submission time.
    const { rows: inputs } = await pool.query(
      `SELECT t.worker_agent, t.phase, c.verified,
              s.repo_url, s.test_command, s.lint_command, s.runtime
       FROM tasks t
       JOIN chunks c ON c.task_id = t.task_id AND c.chunk_index = $2
       JOIN task_specs s ON s.task_id = t.task_id
       WHERE t.task_id = $1
       LIMIT 1`,
      [taskId, chunkIndex]
    );
    if (inputs.length === 0) {
      throw new Error("Task, chunk, or machine-readable TaskSpec not found");
    }

    const input = inputs[0];
    if (input.worker_agent && input.worker_agent !== agentId) {
      throw new Error("Only the awarded agent may submit this chunk");
    }
    if (!input.worker_agent) throw new Error("Task has not been awarded");
    if (!["IN_PROGRESS", "EXECUTING", "SUBMITTED"].includes(input.phase)) {
      throw new Error(`Task cannot be verified in phase ${input.phase}`);
    }
    if (input.verified) throw new Error("Chunk is already verified");
    if (!input.repo_url || !input.test_command) {
      throw new Error("TaskSpec must define repoUrl and testCommand before submission");
    }

    // The API notification is not authority. Require the awarded wallet's
    // finalized on-chain step submission to bind this exact SHA first.
    const chainTask = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "getTask",
      args: [taskId as `0x${string}`],
    }) as unknown as any[];
    if (Number(chainTask[6]) !== 3 || chainTask[2] !== agentId || Number(chainTask[14]) !== chunkIndex) {
      throw new Error("On-chain task is not awaiting review for this agent and chunk");
    }
    const chainSteps = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "getTaskSteps",
      args: [taskId as `0x${string}`],
    }) as unknown as any[];
    const expectedDeliverable = keccak256(toHex(commitHash)).toLowerCase();
    if (!chainSteps[chunkIndex] || String(chainSteps[chunkIndex][5]).toLowerCase() !== expectedDeliverable) {
      throw new Error("Submitted Git SHA does not match the finalized on-chain deliverable hash");
    }

    const verificationRequest = {
      taskId,
      chunkIndex,
      repoUrl: input.repo_url,
      commitHash,
      testCommand: input.test_command,
      lintCommand: input.lint_command,
      runtime: input.runtime,
    };

    const submitted = await pool.query(
      `UPDATE chunks SET submitted = true, submitted_at = NOW(), commit_hash = $1
       WHERE task_id = $2 AND chunk_index = $3 AND verified = false
       RETURNING id`,
      [commitHash, taskId, chunkIndex]
    );
    if (submitted.rowCount !== 1) throw new Error("Chunk cannot be submitted in its current state");

    await updateProgress(10);

    // Run exact-commit verification. Only development may return a result
    // explicitly marked as simulated.
    const { verifySandbox, recordVerification } = await import("./sandbox");
    const result = await verifySandbox(verificationRequest);

    await updateProgress(80);

    // Every independent verifier commits to the same immutable artifact and
    // platform-owned policy. Individual outcomes belong in receipts, not in
    // this digest, otherwise honest verifiers with different scores could not
    // participate in the same on-chain round.
    const evidencePayload = {
      protocol: "aiwork-verification-v2",
      taskId,
      chunkIndex,
      agentId,
      commitHash: commitHash.toLowerCase(),
      repoUrl: input.repo_url,
      testCommand: input.test_command,
      lintCommand: input.lint_command || null,
      runtime: input.runtime || null,
    };
    const evidenceHash = keccak256(toHex(JSON.stringify(evidencePayload)));
    const verificationId = await recordVerification(verificationRequest, result, evidenceHash);

    // Only a real isolated execution can become a settlement attestation.
    // Simulated development results remain visible but can never release funds.
    const localPassed = result.mode === "daytona" && result.testPassed && result.qualityScore >= 70;
    let quorumFinalized = false;
    let quorumPassed = false;
    let quorumReceived = 0;
    let quorumRequired = 0;
    let consensusQuality = 0;
    if (result.mode === "daytona") {
      const attestationTxHash = await walletClient.writeContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "attestVerification",
        args: [taskId as `0x${string}`, BigInt(chunkIndex), evidenceHash, localPassed, BigInt(result.qualityScore)],
      });
      await publicClient.waitForTransactionReceipt({ hash: attestationTxHash });

      const roundId = await publicClient.readContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "verificationRoundIds",
        args: [taskId as `0x${string}`, BigInt(chunkIndex)],
      });
      const round = await publicClient.readContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "verificationRounds",
        args: [taskId as `0x${string}`, BigInt(chunkIndex)],
      }) as unknown as readonly [string, bigint, number, number, number, boolean];

      quorumRequired = Number(round[2]);
      quorumReceived = Number(round[3]);
      quorumFinalized = Boolean(round[5]);
      if (quorumFinalized) {
        const consensus = await publicClient.readContract({
          address: CONTRACTS.taskManager,
          abi: TASK_MANAGER_ABI,
          functionName: "verificationAttestations",
          args: [taskId as `0x${string}`, BigInt(chunkIndex)],
        }) as unknown as readonly [string, bigint, bigint, boolean];
        consensusQuality = Number(consensus[1]);
        quorumPassed = Boolean(consensus[3]);
      }

      await pool.query(
        `INSERT INTO verifier_receipts
           (id, task_id, chunk_index, round_id, verifier_address, evidence_hash,
            passed, quality_score, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [randomUUID(), taskId, chunkIndex, Number(roundId), account.address.toLowerCase(),
          evidenceHash, localPassed, result.qualityScore, attestationTxHash]
      );
      await pool.query(
        `UPDATE verification_jobs
         SET attestation_tx_hash = $1, quorum_finalized = $2, quorum_passed = $3,
             quorum_received = $4, quorum_required = $5
         WHERE id = $6`,
        [attestationTxHash, quorumFinalized, quorumFinalized ? quorumPassed : null,
          quorumReceived, quorumRequired, verificationId]
      );
    }

    // Tests and finalized quorum consensus are mandatory. A local score or an
    // incomplete quorum can never release work.
    const verified = quorumFinalized && quorumPassed;
    if (verified) {
      const updated = await pool.query(
        `UPDATE chunks SET verified = true, verified_at = NOW(), quality_score = $1
         WHERE task_id = $2 AND chunk_index = $3 AND verified = false
         RETURNING id`,
        [consensusQuality, taskId, chunkIndex]
      );
      if (updated.rowCount === 1) {
        await pool.query(
          `UPDATE tasks SET verified_chunks = verified_chunks + 1, updated_at = NOW() WHERE task_id = $1`,
          [taskId]
        );
      }
    }

    // Verification produces evidence; it never releases escrow by itself.
    // The employer must approve the corresponding on-chain submission.
    const { rows } = await pool.query(
      "SELECT total_chunks, verified_chunks FROM tasks WHERE task_id = $1",
      [taskId]
    );
    if (rows.length > 0 && rows[0].verified_chunks >= rows[0].total_chunks && rows[0].total_chunks > 0) {
      await pool.query(
        "UPDATE tasks SET phase = 'AWAITING_APPROVAL', updated_at = NOW() WHERE task_id = $1",
        [taskId]
      );
    }

    const verificationState = result.mode === "simulated"
      ? "SIMULATED — NOT SETTLEABLE"
      : !quorumFinalized
        ? `AWAITING QUORUM ${quorumReceived}/${quorumRequired}`
        : verified ? "VERIFIED ✓" : "FAILED ✗";

    // Log the result
    await insertActivity({
      type: "verify",
      agent: agentId,
      taskId,
      message: `Chunk ${chunkIndex} ${verificationState} via ${result.mode} (local score: ${result.qualityScore}, ${result.executionTimeMs}ms)`,
    });

    // Notify agent
    await enqueueNotification(
      agentId,
      taskId,
      `Chunk ${chunkIndex} ${verificationState.toLowerCase()} (${result.mode}: local score ${result.qualityScore})`,
      verified ? "CHUNK_VERIFIED" : quorumFinalized ? "CHUNK_REJECTED" : "VERIFICATION_QUORUM_PENDING"
    );

    await updateProgress(100);
    return {
      verified,
      quorumFinalized,
      quorumPassed: quorumFinalized ? quorumPassed : null,
      quorumReceived,
      quorumRequired,
      consensusQuality: quorumFinalized ? consensusQuality : null,
      chunkIndex,
      ...result,
    };
}

/**
 * BIDDING DEADLINE WORKER
 * Auto-closes bidding and selects winner after deadline.
 * Jobs are delayed — added when bidding opens with a delay.
 */
async function processBiddingDeadlineJob(data: BiddingDeadlineJob, updateProgress: ProgressReporter) {
    const { taskId, title } = data;
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
        await enqueueNotification(
          bid.agent_id,
          taskId,
          isWinner
            ? `🏆 You won "${title}"! Start working now.`
            : `Bidding closed on "${title}" — another agent was selected.`,
          isWinner ? "TASK_AWARDED" : "BID_LOST"
        );
      }
    } else {
      console.log(`[QUEUE:deadline] No bids — task remains open`);
    }

    await updateProgress(100);
    return result;
}

/**
 * NOTIFICATION WORKER
 * Persists notifications to the database for agent polling.
 * Reliable delivery via DLQ if DB write fails.
 */
async function processNotificationJob(data: NotificationJob, updateProgress: ProgressReporter) {
    const { agentId, taskId, message, action, metadata } = data;

    await pool.query(
      `INSERT INTO activity_log (type, agent_id, task_id, message, metadata)
       VALUES ('notification', $1, $2, $3, $4)`,
      [agentId, taskId, message, JSON.stringify({ action, ...metadata })]
    );

    await updateProgress(100);
    return { delivered: true };
}

// ─── Durable engine ────────────────────────────────────────────

const WORKER_ID = `${process.env.VERIFIER_INSTANCE_ID || "scheduler"}:${process.pid}:${randomUUID()}`;
const defaultWorkerQueues = process.env.NODE_ENV === "production"
  ? []
  : ["verification", "bidding-deadline", "notifications"];
const configuredWorkerQueues = process.env.WORKER_QUEUES === undefined
  ? defaultWorkerQueues
  : process.env.WORKER_QUEUES.split(",").map((value) => value.trim()).filter(Boolean);
const workerQueues = configuredWorkerQueues.filter(
  (value): value is QueueName => ["verification", "bidding-deadline", "notifications"].includes(value)
);
let workerTimer: ReturnType<typeof setInterval> | undefined;
let polling = false;

async function enqueueDurable(
  queue: QueueName,
  dedupKey: string,
  targetId: string,
  payload: VerificationJob | BiddingDeadlineJob | NotificationJob,
  runAt: Date,
  maxAttempts: number
) {
  await pool.query(
    `INSERT INTO durable_jobs
       (id, queue, dedup_key, target_id, payload, run_at, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (queue, dedup_key) DO UPDATE SET
       status = CASE WHEN durable_jobs.status = 'FAILED' THEN 'PENDING' ELSE durable_jobs.status END,
       error = CASE WHEN durable_jobs.status = 'FAILED' THEN NULL ELSE durable_jobs.error END,
       run_at = CASE WHEN durable_jobs.status = 'FAILED' THEN EXCLUDED.run_at ELSE durable_jobs.run_at END,
       updated_at = NOW()`,
    [randomUUID(), queue, dedupKey, targetId, payload, runAt, maxAttempts]
  );
}

async function claimJob(queue: QueueName) {
  const targetId = queue === "verification"
    ? process.env.VERIFIER_INSTANCE_ID || "local"
    : "scheduler";
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT id FROM durable_jobs
       WHERE queue = $1 AND target_id = $2 AND run_at <= NOW()
         AND (status = 'PENDING' OR (status = 'RUNNING' AND locked_at < NOW() - INTERVAL '10 minutes'))
       ORDER BY run_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE durable_jobs j SET status = 'RUNNING', locked_by = $3,
       locked_at = NOW(), attempts = attempts + 1, updated_at = NOW()
     FROM candidate WHERE j.id = candidate.id RETURNING j.*`,
    [queue, targetId, WORKER_ID]
  );
  return rows[0] || null;
}

async function reportProgress(jobId: string, progress: number) {
  await pool.query(
    "UPDATE durable_jobs SET progress = $1, updated_at = NOW() WHERE id = $2 AND locked_by = $3",
    [progress, jobId, WORKER_ID]
  );
}

async function executeClaimedJob(job: any) {
  const progress = (value: number) => reportProgress(job.id, value);
  if (job.queue === "verification") {
    return processVerificationJob(job.payload as VerificationJob, progress);
  }
  if (job.queue === "bidding-deadline") {
    return processBiddingDeadlineJob(job.payload as BiddingDeadlineJob, progress);
  }
  return processNotificationJob(job.payload as NotificationJob, progress);
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    for (const queue of workerQueues) {
      const job = await claimJob(queue);
      if (!job) continue;
      try {
        const result = await executeClaimedJob(job);
        await pool.query(
          `UPDATE durable_jobs SET status = 'COMPLETED', progress = 100,
             result = $1, locked_by = NULL, locked_at = NULL, completed_at = NOW(), updated_at = NOW()
           WHERE id = $2 AND locked_by = $3`,
          [result || {}, job.id, WORKER_ID]
        );
        console.log(`[QUEUE:${queue}] ✅ Job ${job.id} completed`);
      } catch (error: any) {
        const exhausted = Number(job.attempts) >= Number(job.max_attempts);
        const retryDelaySeconds = Math.min(300, 2 ** Math.min(Number(job.attempts), 8));
        await pool.query(
          `UPDATE durable_jobs SET status = $1, error = $2,
             run_at = CASE WHEN $1 = 'PENDING' THEN NOW() + ($3 * INTERVAL '1 second') ELSE run_at END,
             locked_by = NULL, locked_at = NULL, updated_at = NOW()
           WHERE id = $4 AND locked_by = $5`,
          [exhausted ? "FAILED" : "PENDING", error.message, retryDelaySeconds, job.id, WORKER_ID]
        );
        console.error(`[QUEUE:${queue}] ❌ Job ${job.id} ${exhausted ? "moved to DLQ" : "will retry"}: ${error.message}`);
      }
    }
  } finally {
    polling = false;
  }
}

if (workerQueues.length > 0) {
  if (workerQueues.includes("verification") && process.env.NODE_ENV === "production" && !process.env.VERIFIER_INSTANCE_ID) {
    throw new Error("VERIFIER_INSTANCE_ID is required for production verification workers");
  }
  workerTimer = setInterval(() => void pollOnce(), 500);
  void pollOnce();
  console.log(`[QUEUE] PostgreSQL worker ${WORKER_ID} started: ${workerQueues.join(", ")}`);
} else {
  console.log("[QUEUE] API enqueue-only mode; dedicated PostgreSQL workers required");
}

export async function stopQueueWorkers() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = undefined;
  while (polling) await Bun.sleep(25);
}

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
  if (!commitHash) throw new Error("commitHash is required");
  const verifierTargets = (process.env.VERIFIER_INSTANCE_IDS || (process.env.NODE_ENV === "production" ? "" : "local"))
    .split(",").map((value) => value.trim()).filter(Boolean);
  const quorum = Number(process.env.VERIFIER_QUORUM || (process.env.NODE_ENV === "production" ? "3" : "1"));
  if (new Set(verifierTargets).size < quorum) {
    throw new Error(`VERIFIER_INSTANCE_IDS must provide at least ${quorum} independent worker targets`);
  }
  await Promise.all(verifierTargets.map((targetId) => enqueueDurable(
    "verification",
    `${taskId}:${chunkIndex}:${commitHash.toLowerCase()}:${targetId}`,
    targetId,
    { taskId, chunkIndex, agentId, commitHash },
    new Date(),
    3
  )));
}

/**
 * Schedule bidding auto-close after N hours.
 */
export async function scheduleBiddingDeadline(
  taskId: string,
  title: string,
  delayHours: number = 48
) {
  await enqueueDurable(
    "bidding-deadline",
    taskId,
    "scheduler",
    { taskId, title },
    new Date(Date.now() + delayHours * 60 * 60 * 1000),
    3
  );
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
  const id = randomUUID();
  await enqueueDurable(
    "notifications",
    id,
    "scheduler",
    { agentId, taskId, message, action, metadata },
    new Date(),
    5
  );
}

/**
 * Get queue health stats for monitoring.
 */
export async function getQueueStats() {
  const { rows } = await pool.query(
    `SELECT queue, status, COUNT(*)::int AS count FROM durable_jobs
     GROUP BY queue, status ORDER BY queue, status`
  );
  const stats: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const queueStats = stats[row.queue] ||= {};
    queueStats[row.status.toLowerCase()] = Number(row.count);
  }
  return stats;
}
