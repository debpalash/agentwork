// Dedicated durable worker entrypoint. API containers enqueue only; verifier
// containers use distinct signer keys and instance IDs.
import "./telemetry";

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

if (process.env.NODE_ENV === "production") {
  const queues = (process.env.WORKER_QUEUES || "").split(",").filter(Boolean);
  const required = ["DATABASE_URL", "PLATFORM_PRIVATE_KEY", "TASK_MANAGER_ADDRESS"];
  if (queues.includes("verification")) {
    required.push("DAYTONA_API_KEY", "VERIFIER_INSTANCE_ID");
  }
  const missing = required.filter((name) => !process.env[name]);
  if (!queues.length) missing.push("WORKER_QUEUES");
  if (missing.length) throw new Error(`[WORKER CONFIG] Missing required variables: ${[...new Set(missing)].join(", ")}`);
}

const { initDB, pool } = await import("./db");
await initDB();
const { stopQueueWorkers } = await import("./services/queue");

console.log(`[WORKER] Ready: ${process.env.WORKER_QUEUES || "development defaults"}`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[WORKER] ${signal} received; stopping claims`);
  await stopQueueWorkers();
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
