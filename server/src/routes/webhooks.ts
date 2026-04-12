/**
 * Webhook Routes — Handle Forgejo push events for chunk verification
 */

import { Hono } from "hono";
import { verifySandbox } from "../services/sandbox";

export const webhookRoutes = new Hono();

// In-memory stores (will migrate to Postgres+Redis)
const activityFeed: any[] = [];
const taskSpecs: Map<string, any> = new Map(); // taskId → spec

// ─── Forgejo Push Webhook ──────────────────────────────────────
webhookRoutes.post("/push", async (c) => {
  const body = await c.req.json();

  // Verify webhook secret
  const signature = c.req.header("X-Forgejo-Signature");
  const expectedSecret = process.env.FORGEJO_WEBHOOK_SECRET || "aiwork-webhook-secret";
  // TODO: verify HMAC-SHA256(body, secret) === signature

  const repoName = body.repository?.name;
  const cloneUrl = body.repository?.clone_url;
  const commits = body.commits || [];
  const pusher = body.pusher?.login;
  const branch = body.ref?.replace("refs/heads/", "");

  console.log(`[WEBHOOK] Push to ${repoName} by ${pusher} on branch ${branch}`);
  console.log(`[WEBHOOK] ${commits.length} commit(s)`);

  // Extract taskId from repo name (task-{first12chars})
  const taskIdMatch = repoName?.match(/^task-(.+)$/);
  const taskIdShort = taskIdMatch?.[1];

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
    addActivity("push", pusher, repoName, `Pushed to ${chunksUpdated.size} chunk(s)`, {
      branch, commits: commits.length, chunks: [...chunksUpdated.keys()],
    });

    // Trigger sandbox verification for each chunk
    if (cloneUrl && taskIdShort) {
      const spec = taskSpecs.get(taskIdShort) || {
        testCommand: "npm test 2>/dev/null || bun test 2>/dev/null || echo 'No tests'",
        lintCommand: "npx eslint . 2>/dev/null || echo 'No lint'",
        runtime: "node",
      };

      // Run verifications in parallel (non-blocking)
      const chunks = [...chunksUpdated.entries()].map(([index, sha]) => ({
        index,
        commitHash: sha,
      }));

      // Fire-and-forget — results come back async via bunqueue
      Promise.all(chunks.map(({ index, commitHash }) =>
        verifySandbox(taskIdShort || repoName, index)
      )).then((results) => {
        results.forEach((result, i) => {
          addActivity(
            result.testPassed ? "verify" : "fail",
            "system",
            repoName,
            `Chunk ${chunks[i].index + 1} ${result.testPassed ? "verified" : "failed"} ` +
            `(quality: ${result.qualityScore}/100, ${result.executionTimeMs}ms, mode: ${result.mode})`,
            { ...result }
          );
        });
      }).catch((err) => {
        console.error(`[WEBHOOK] Verification pipeline error:`, err.message);
      });
    }
  }

  return c.json({ received: true, chunksDetected: [...chunksUpdated.keys()] });
});

// ─── Register Task Spec (for verification config) ──────────────
webhookRoutes.post("/specs/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const spec = await c.req.json();
  taskSpecs.set(taskId, spec);
  return c.json({ stored: true, taskId });
});

// ─── Live Activity Feed ────────────────────────────────────────
webhookRoutes.get("/activity", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20");
  return c.json({
    activities: activityFeed.slice(0, limit),
    total: activityFeed.length,
  });
});

// ─── SSE Activity Stream ───────────────────────────────────────
webhookRoutes.get("/activity/stream", async (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`));

      let lastSent = activityFeed.length;
      const interval = setInterval(() => {
        if (activityFeed.length !== lastSent) {
          const newCount = activityFeed.length - lastSent;
          const newActivities = activityFeed.slice(0, newCount);
          for (const activity of newActivities) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(activity)}\n\n`));
          }
          lastSent = activityFeed.length;
        }
      }, 1000);

      setTimeout(() => { clearInterval(interval); controller.close(); }, 300000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ─── Helper ────────────────────────────────────────────────────
function addActivity(type: string, agent: string | null, task: string | null, message: string, metadata: any = {}) {
  activityFeed.unshift({
    type, agent, task, message, metadata,
    timestamp: Date.now(),
  });
  if (activityFeed.length > 200) activityFeed.length = 200;
}

export { activityFeed };
