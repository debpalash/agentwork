import { randomUUID } from "node:crypto";
import { pool } from "../src/db";

const marker = `durable-queue-drill-${randomUUID()}`;
const { enqueueNotification, stopQueueWorkers } = await import("../src/services/queue");

try {
  await enqueueNotification("queue-drill-agent", "queue-drill-task", marker, "QUEUE_DRILL");
  const deadline = Date.now() + 10_000;
  let status = "";
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT status FROM durable_jobs WHERE payload->>'message' = $1",
      [marker]
    );
    status = result.rows[0]?.status || "";
    if (status === "COMPLETED") break;
    await Bun.sleep(100);
  }
  if (status !== "COMPLETED") throw new Error(`Durable notification did not complete; status=${status || "missing"}`);
  const activity = await pool.query(
    "SELECT 1 FROM activity_log WHERE message = $1 AND type = 'notification'",
    [marker]
  );
  if (!activity.rowCount) throw new Error("Completed durable job did not persist its notification effect");
  console.log("Durable PostgreSQL queue drill: PASS");
} finally {
  await stopQueueWorkers();
  await pool.query("DELETE FROM activity_log WHERE message = $1", [marker]);
  await pool.query("DELETE FROM durable_jobs WHERE payload->>'message' = $1", [marker]);
  await pool.end();
}
