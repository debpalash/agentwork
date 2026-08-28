/**
 * Webhook Routes — Handle Forgejo push events for chunk verification
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createHmac, timingSafeEqual } from "crypto";
import { pool, insertActivity } from "../db";
import { enqueueVerification } from "../services/queue";

export const webhookRoutes = new Hono();

// ─── Forgejo Push Webhook ──────────────────────────────────────
webhookRoutes.post("/push", async (c) => {
  // Read raw body BEFORE parsing JSON so the HMAC matches Forgejo's hash of the bytes.
  const raw = await c.req.raw.clone().text();

  // ─── HMAC-SHA256 verification (Forgejo: X-Forgejo-Signature, hex digest) ────
  const signature = c.req.header("X-Forgejo-Signature") || "";
  const secret = process.env.FORGEJO_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[WEBHOOK] FORGEJO_WEBHOOK_SECRET unset in production — refusing request");
      return c.json({ error: "webhook secret not configured" }, 500);
    }
    console.warn("[WEBHOOK] FORGEJO_WEBHOOK_SECRET unset — dev mode, skipping HMAC check");
  } else {
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (
      sigBuf.length !== expBuf.length ||
      !timingSafeEqual(sigBuf, expBuf)
    ) {
      return c.json({ error: "bad signature" }, 401);
    }
  }

  const body = JSON.parse(raw);

  const repoName = body.repository?.name;
  const commits = body.commits || [];
  const pusher = body.pusher?.login;
  const branch = body.ref?.replace("refs/heads/", "");

  console.log(`[WEBHOOK] Push to ${repoName} by ${pusher} on branch ${branch}`);
  console.log(`[WEBHOOK] ${commits.length} commit(s)`);

  if (!repoName || !/^task-[0-9a-f]{12}$/i.test(repoName)) {
    return c.json({ error: "unrecognized task repository" }, 400);
  }

  // Resolve the short Forgejo repository name back to the canonical task ID.
  // Never verify against an ID or repository URL supplied by the webhook body.
  const { rows: taskRows } = await pool.query(
    `SELECT task_id, worker_agent FROM tasks
     WHERE repo_slug = $1 OR repo_slug = $2
     LIMIT 1`,
    [repoName, `aiwork/${repoName}`]
  );
  if (taskRows.length === 0) {
    return c.json({ error: "repository is not bound to a platform task" }, 404);
  }
  const task = taskRows[0];
  if (!task.worker_agent) return c.json({ error: "task has not been awarded" }, 409);

  // Determine which chunks were updated based on changed files
  const chunksUpdated = new Map<number, string>(); // chunkIndex → commit SHA
  for (const commit of commits) {
    const files = [
      ...(commit.added || []),
      ...(commit.modified || []),
      ...(commit.removed || []),
    ];
    for (const file of files) {
      const match = file.match(/^chunk-(\d+)\//);
      if (match) {
        chunksUpdated.set(parseInt(match[1]) - 1, commit.id); // 0-indexed
      }
    }
  }

  if (chunksUpdated.size > 0) {
    console.log(`[WEBHOOK] Chunks updated: ${[...chunksUpdated.keys()].map(i => i + 1).join(", ")}`);

    // Log activity
    await insertActivity({
      type: "push",
      agent: pusher || "unknown",
      taskId: task.task_id,
      message: `Pushed ${chunksUpdated.size} chunk(s) on ${branch || "unknown branch"} (${commits.length} commits)`,
    });

    const chunks = [...chunksUpdated.entries()].map(([index, sha]) => ({ index, commitHash: sha }));
    await Promise.all(
      chunks.map(({ index, commitHash }) =>
        enqueueVerification(task.task_id, index, task.worker_agent, commitHash)
      )
    );
  }

  return c.json({ received: true, chunksDetected: [...chunksUpdated.keys()] });
});

// ─── Live Activity Feed ────────────────────────────────────────
webhookRoutes.get("/activity", async (c) => {
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const { rows } = await pool.query(
    `SELECT id, type, agent_id, task_id, message, metadata, created_at
     FROM activity_log ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return c.json({
    activities: rows.map(toActivity),
    total: rows.length,
  });
});

// ─── SSE Activity Stream ───────────────────────────────────────
webhookRoutes.get("/activity/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });
    const initial = await pool.query("SELECT COALESCE(MAX(id), 0) AS id FROM activity_log");
    let lastId = Number(initial.rows[0]?.id || 0);
    const expiresAt = Date.now() + 300_000;

    while (!stream.aborted && Date.now() < expiresAt) {
      await stream.sleep(2_000);
      if (stream.aborted) break;

      const { rows } = await pool.query(
        `SELECT id, type, agent_id, task_id, message, metadata, created_at
         FROM activity_log WHERE id > $1 ORDER BY id ASC LIMIT 100`,
        [lastId]
      );
      for (const row of rows) {
        if (stream.aborted) break;
        await stream.writeSSE({
          id: String(row.id),
          event: "activity",
          data: JSON.stringify(toActivity(row)),
        });
        lastId = Number(row.id);
      }
    }
  });
});

function toActivity(row: any) {
  return {
    id: row.id,
    type: row.type,
    agent: row.agent_id,
    task: row.task_id,
    message: row.message,
    metadata: row.metadata || {},
    timestamp: new Date(row.created_at).getTime(),
  };
}
