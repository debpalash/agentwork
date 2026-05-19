import { Hono } from "hono";
import {
  publicClient,
  walletClient,
  CONTRACTS,
  TASK_MANAGER_ABI,
  ESCROW_ABI,
  COMPLEXITY_ABI,
  account,
} from "../services/blockchain";
import {
  awardTask,
  submitStep,
  getAgentNotifications,
} from "../services/lifecycle";
import { keccak256, toHex, parseEther } from "viem";
import { pool } from "../db";

export const taskRoutes = new Hono();

// ─── Store/Update Task Spec (Postgres-backed task_specs table) ──────
// Keeps the API shape stable. Reject literal "null"/missing IDs explicitly so
// we never silently collide specs again.
taskRoutes.post("/:taskId/spec", async (c) => {
  const taskId = c.req.param("taskId");
  if (!taskId || taskId === "null" || taskId === "undefined") {
    return c.json({ error: "invalid taskId" }, 400);
  }
  const spec = await c.req.json();
  spec.taskId = taskId;
  spec.version = "2.0";

  try {
    await pool.query(
      `INSERT INTO task_specs (task_id, repo_url, test_command, lint_command, runtime, env_vars, acceptance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (task_id) DO UPDATE SET
         repo_url = EXCLUDED.repo_url,
         test_command = EXCLUDED.test_command,
         lint_command = EXCLUDED.lint_command,
         runtime = EXCLUDED.runtime,
         env_vars = EXCLUDED.env_vars,
         acceptance = EXCLUDED.acceptance`,
      [
        taskId,
        spec.repoUrl || spec.repo_url || null,
        spec.testCommand || spec.test_command || null,
        spec.lintCommand || spec.lint_command || null,
        spec.runtime || null,
        JSON.stringify(spec.envVars || spec.env_vars || {}),
        JSON.stringify(spec.acceptance || spec),
      ]
    );
  } catch (err: any) {
    return c.json({ error: `Failed to store spec: ${err.message}` }, 500);
  }

  return c.json({ success: true, taskId, message: "TaskSpec v2 stored" }, 201);
});

// ─── Get Task Spec ─────────────────────────────────────────────
taskRoutes.get("/:taskId/spec", async (c) => {
  const taskId = c.req.param("taskId");

  try {
    const { rows } = await pool.query(
      "SELECT * FROM task_specs WHERE task_id = $1",
      [taskId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      const spec = {
        taskId: r.task_id,
        version: "2.0",
        repoUrl: r.repo_url,
        testCommand: r.test_command,
        lintCommand: r.lint_command,
        runtime: r.runtime,
        envVars: r.env_vars,
        acceptance: r.acceptance,
      };
      return c.json(spec);
    }
  } catch (err: any) {
    console.warn(`[TASKS] spec read failed for ${taskId}: ${err.message}`);
  }

  // Fallback: build a basic spec from on-chain data
  try {
    const task = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "getTask",
      args: [taskId as `0x${string}`],
    }) as any[];

    return c.json({
      taskId,
      version: "2.0",
      title: task[3],
      category: task[4],
      description: "No structured spec provided. Use task details from the main endpoint.",
      acceptance: {},
      environment: { runtime: "unknown" },
      deliverable: { type: "text" },
      reward: {
        amount: task[7]?.toString(),
        token: "USDC",
        model: ["FULL", "STEP", "FRACTIONAL", "HYBRID"][Number(task[5])],
      },
      constraints: {
        maxDurationHours: 24,
        requiredReputation: 0,
        maxFailedAttempts: 5,
      },
      poster: task[1],
      postedAt: Number(task[10]),
      deadline: Number(task[11]),
      complexityClaim: Number(task[16]) || 5,
    });
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// ─── Post a New Task ───────────────────────────────────────────
taskRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const {
    title,
    category,
    paymentModel, // 0=FULL, 1=STEP, 2=FRACTIONAL, 3=HYBRID
    paymentToken,
    baseReward,
    bonusPool = "0",
    complexityClaim,
    deadlineHours = 24,
    requirements = "",
    steps = [], // [{description, percentageBPS}]
  } = body;

  if (!title || !category || !paymentToken || !baseReward || !complexityClaim) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);
    const requirementsHash = keccak256(toHex(requirements || "none"));

    const stepDescriptions = steps.map((s: any) => s.description);
    const stepPercentages = steps.map((s: any) => BigInt(s.percentageBPS));

    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "postTask",
      args: [
        title,
        category,
        paymentModel,
        paymentToken,
        parseEther(baseReward.toString()),
        parseEther(bonusPool.toString()),
        BigInt(complexityClaim),
        deadline,
        requirementsHash,
        stepDescriptions,
        stepPercentages,
      ],
    });

    return c.json({
      success: true,
      txHash: hash,
      message: "Task posted. Funds locked in escrow.",
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Task ──────────────────────────────────────────────────
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;

  try {
    const task = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "getTask",
      args: [taskId],
    }) as any[];

    const paymentModels = ["FULL_COMPLETION", "STEP_BASED", "FRACTIONAL", "HYBRID"];
    const statuses = [
      "OPEN", "ASSIGNED", "IN_PROGRESS", "STEP_REVIEW",
      "COMPLETED", "PARTIALLY_COMPLETED", "DISPUTED", "CANCELLED", "EXPIRED"
    ];

    // Get steps if step-based
    let steps: any[] = [];
    if (Number(task[5]) === 1 || Number(task[5]) === 3) {
      const rawSteps = await publicClient.readContract({
        address: CONTRACTS.taskManager,
        abi: TASK_MANAGER_ABI,
        functionName: "getTaskSteps",
        args: [taskId],
      }) as any[];

      steps = rawSteps.map((s: any, i: number) => ({
        stepNumber: i,
        description: s[0],
        rewardPercentageBPS: Number(s[1]),
        rewardPercent: (Number(s[1]) / 100).toFixed(1) + "%",
        isCompleted: s[2],
        isVerified: s[3],
        completedAt: Number(s[4]),
        qualityScore: Number(s[6]),
      }));
    }

    // Get escrow info
    const escrow = await publicClient.readContract({
      address: CONTRACTS.escrowVault,
      abi: ESCROW_ABI,
      functionName: "getEscrow",
      args: [taskId],
    }) as any[];

    return c.json({
      taskId: task[0],
      poster: task[1],
      assignedAgentId: task[2] || null,
      title: task[3],
      category: task[4],
      paymentModel: paymentModels[Number(task[5])],
      status: statuses[Number(task[6])],
      baseReward: task[7].toString(),
      bonusPool: task[8].toString(),
      paidOut: task[9].toString(),
      postedAt: Number(task[10]),
      deadline: Number(task[11]),
      assignedAt: Number(task[12]),
      completedAt: Number(task[13]),
      currentStep: Number(task[14]),
      totalSteps: Number(task[15]),
      failedAttempts: Number(task[19]),
      complexityBumps: Number(task[20]),
      steps,
      escrow: {
        totalLocked: escrow[3]?.toString(),
        released: escrow[4]?.toString(),
        remaining: escrow[5]?.toString(),
        isActive: escrow[7],
      },
    });
  } catch (err: any) {
    return c.json({ error: "Task not found" }, 404);
  }
});

// ─── Assign Agent to Task ──────────────────────────────────────
taskRoutes.post("/:taskId/assign", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;
  const { agentId } = await c.req.json();

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "assignTask",
      args: [taskId, agentId],
    });

    return c.json({ success: true, txHash: hash, status: "IN_PROGRESS" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Submit Step ───────────────────────────────────────────────
taskRoutes.post("/:taskId/steps/:stepNum/submit", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;
  const stepNum = Number(c.req.param("stepNum"));
  const { deliverable } = await c.req.json();

  const deliverableHash = keccak256(toHex(deliverable || ""));

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "submitStep",
      args: [taskId, BigInt(stepNum), deliverableHash],
    });

    return c.json({ success: true, txHash: hash, status: "STEP_REVIEW" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Verify Step ───────────────────────────────────────────────
taskRoutes.post("/:taskId/steps/:stepNum/verify", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;
  const stepNum = Number(c.req.param("stepNum"));
  const { approved, qualityScore } = await c.req.json();

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "verifyStep",
      args: [taskId, BigInt(stepNum), approved, BigInt(qualityScore)],
    });

    return c.json({ success: true, txHash: hash });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Submit Full Completion ────────────────────────────────────
taskRoutes.post("/:taskId/complete", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;
  const { deliverable } = await c.req.json();

  const deliverableHash = keccak256(toHex(deliverable || ""));

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "submitCompletion",
      args: [taskId, deliverableHash],
    });

    return c.json({ success: true, txHash: hash, status: "STEP_REVIEW" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Verify Full Completion ────────────────────────────────────
taskRoutes.post("/:taskId/verify", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;
  const { approved, qualityScore } = await c.req.json();

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "verifyCompletion",
      args: [taskId, approved, BigInt(qualityScore)],
    });

    return c.json({ success: true, txHash: hash });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Cancel Task ───────────────────────────────────────────────
taskRoutes.post("/:taskId/cancel", async (c) => {
  const taskId = c.req.param("taskId") as `0x${string}`;

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "cancelTask",
      args: [taskId],
    });

    return c.json({ success: true, txHash: hash, status: "CANCELLED" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

import { parseAbiItem } from 'viem'

// ─── Platform Task Stats & Live Feed ───────────────────────
taskRoutes.get("/", async (c) => {
  try {
    // 1. Chain tasks
    const totalTasks = await publicClient.readContract({
      address: CONTRACTS.taskManager,
      abi: TASK_MANAGER_ABI,
      functionName: "totalTasks",
    });

    const logs = await publicClient.getLogs({
      address: CONTRACTS.taskManager,
      event: parseAbiItem("event TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)"),
      fromBlock: 0n
    });

    const paymentModels = ["FULL_COMPLETION", "STEP_BASED", "FRACTIONAL", "HYBRID"];
    const statuses = [
      "OPEN", "ASSIGNED", "IN_PROGRESS", "STEP_REVIEW",
      "COMPLETED", "PARTIALLY_COMPLETED", "DISPUTED", "CANCELLED", "EXPIRED"
    ];

    const resolvedTasks = await Promise.all(
      logs.map(async (log: any) => {
        const taskId = log.args.taskId;
        try {
          const taskData = await publicClient.readContract({
            address: CONTRACTS.taskManager,
            abi: TASK_MANAGER_ABI,
            functionName: "getTask",
            args: [taskId],
          }) as any[];

          // Check if DB has a newer phase for this task
          const { rows: dbRows } = await pool.query(
            "SELECT phase, worker_agent, verified_chunks, total_chunks FROM tasks WHERE task_id = $1 LIMIT 1",
            [taskId]
          );
          const dbPhase = dbRows[0]?.phase;

          return {
            id: taskId,
            poster: taskData[1],
            agent: resolveAgent(dbRows, taskData),
            title: taskData[3],
            category: ["CODE", "NLP", "DATA", "VISION", "CREATIVE", "REASONING"][Number(taskData[4])] || "GENERIC",
            paymentModel: paymentModels[Number(taskData[5])],
            phase: dbPhase ? dbPhase.toLowerCase() : statuses[Number(taskData[6])].toLowerCase(),
            reward: `${(Number(taskData[7]) / 1e18).toFixed(2)} USDC`,
            chunks: dbRows[0]
              ? `${dbRows[0].verified_chunks}/${dbRows[0].total_chunks}`
              : `${Number(taskData[14])}/${Number(taskData[15])}`,
            bids: 0,
            postedAt: Number(taskData[10]),
          }
        } catch { return null; }
      })
    );

    const chainTaskIds = new Set(logs.map((l: any) => l.args.taskId));

    // 2. DB-only tasks (not on chain — lifecycle-created)
    const { rows: dbOnlyTasks } = await pool.query(
      `SELECT task_id, title, category, phase, max_budget, total_chunks, verified_chunks, employer, worker_agent, created_at
       FROM tasks WHERE task_id NOT IN (${chainTaskIds.size > 0 ? [...chainTaskIds].map((_, i) => `$${i + 1}`).join(",") : "''"})
       ORDER BY created_at DESC`,
      [...chainTaskIds]
    );

    const dbMapped = dbOnlyTasks.map((t: any) => ({
      id: t.task_id,
      poster: t.employer,
      agent: t.worker_agent || null,
      title: t.title,
      category: t.category || "CODE",
      paymentModel: "STEP_BASED",
      phase: (t.phase || "posted").toLowerCase(),
      reward: `${Number(t.max_budget || 0).toFixed(2)} USDC`,
      chunks: `${t.verified_chunks}/${t.total_chunks}`,
      bids: 0,
      postedAt: t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : 0,
    }));

    const chainTasks = resolvedTasks.filter(t => t !== null).reverse();
    const allTasks = [...dbMapped, ...chainTasks];

    return c.json({ totalTasks: allTasks.length, tasks: allTasks });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

function resolveAgent(rows: any[], taskData: any[]) {
  if (rows[0]?.worker_agent) return rows[0].worker_agent;
  const agent = taskData[2];
  return agent && agent !== "0x0000000000000000000000000000000000000000" ? agent : null;
}

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE: Award Task — close bidding, select winner
// ═══════════════════════════════════════════════════════════════
taskRoutes.post("/:taskId/award", async (c) => {
  const taskId = c.req.param("taskId");

  const result = await awardTask(taskId);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    success: true,
    taskId,
    winner: result.winner,
    message: `Task awarded to ${result.winner}`,
  });
});

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE: Submit Step — agent submits deliverable
// ═══════════════════════════════════════════════════════════════
taskRoutes.post("/:taskId/submit", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json();
  const { chunkIndex, agentId, commitHash } = body;

  if (chunkIndex === undefined || !agentId) {
    return c.json({ error: "chunkIndex and agentId required" }, 400);
  }

  const result = await submitStep(taskId, chunkIndex, agentId, commitHash);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    success: true,
    taskId,
    chunkIndex,
    verified: result.verified,
    message: result.verified
      ? "Chunk submitted and verified ✓"
      : "Chunk submitted, pending manual review",
  });
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS: Agent polls for updates
// ═══════════════════════════════════════════════════════════════
taskRoutes.get("/notifications/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const since = c.req.query("since");

  const notifications = await getAgentNotifications(agentId, since);

  return c.json({
    agentId,
    count: notifications.length,
    notifications: notifications.map((n: any) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      taskId: n.task_id,
      action: n.metadata?.action,
      createdAt: n.created_at,
    })),
  });
});
