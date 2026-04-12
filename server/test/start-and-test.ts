/**
 * Start Embedded Postgres → Create Schema → Start API → Run Lifecycle
 *
 * Self-contained: no Docker needed.
 * Run: bun run test/start-and-test.ts
 */

import EmbeddedPostgres from "embedded-postgres";
import { readFileSync } from "fs";
import { spawn } from "child_process";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../..");
const SERVER = resolve(ROOT, "server");
const DATA_DIR = resolve(ROOT, ".pg-test-data");

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🐘 Starting Embedded Postgres...");
  console.log("═══════════════════════════════════════════════════════════");

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "aiwork",
    password: "aiwork_secret_change_me",
    port: 5432,
    persistent: false,
  });

  try {
    await pg.initialise();
    await pg.start();
    console.log("  ✅ Postgres running on :5432");

    // Create aiwork database
    try {
      await pg.createDatabase("aiwork");
      console.log("  ✅ Database 'aiwork' created");
    } catch {
      console.log("  ⏭️  Database 'aiwork' already exists");
    }

    // Run schema init
    const schemaSQL = readFileSync(resolve(ROOT, "docker/init.sql"), "utf8")
      .replace("CREATE DATABASE forgejo;", "-- skip forgejo");

    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork",
    });

    // Split by semicolons and run each statement
    const statements = schemaSQL.split(";").filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err: any) {
        if (!err.message.includes("already exists") && !err.message.includes("duplicate")) {
          console.warn(`  ⚠️  ${err.message.slice(0, 60)}`);
        }
      }
    }
    console.log("  ✅ Schema initialized");
    
    // Seed data
    await pool.query(`INSERT INTO agents (agent_id, wallet_address, payment_address, category, status, reputation, skills)
      VALUES ('alpha-agent', '0x1111111111111111111111111111111111111111', '0x1111111111111111111111111111111111111111', 'CODE', 'ACTIVE', 8500, '{typescript,python}')
      ON CONFLICT DO NOTHING`);
    console.log("  ✅ Seed data loaded");
    await pool.end();

    // Start API server
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  🚀 Starting API Server...");
    console.log("═══════════════════════════════════════════════════════════");

    const api = spawn(process.execPath, ["run", "src/index.ts"], {
      cwd: SERVER,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork",
        RATE_LIMIT_MAX: "500",
        NODE_ENV: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for API to be ready
    let output = "";
    api.stdout.on("data", (d) => { output += d.toString(); });
    api.stderr.on("data", (d) => { output += d.toString(); });

    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (output.includes("Started development server")) {
          clearInterval(check);
          resolve();
        }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error("API start timeout")); }, 15000);
    });
    console.log("  ✅ API server ready on :3001\n");

    // Run lifecycle test
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🧪 Running Agent Lifecycle Test...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const test = spawn(process.execPath, ["run", "test/agent-lifecycle.ts"], {
      cwd: SERVER,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork",
      },
      stdio: "inherit",
    });

    const exitCode = await new Promise<number>((resolve) => {
      test.on("exit", (code) => resolve(code || 0));
    });

    // Cleanup
    api.kill("SIGTERM");
    await pg.stop();
    process.exit(exitCode);
  } catch (err: any) {
    console.error("💥 Fatal:", err.message);
    try { await pg.stop(); } catch {}
    process.exit(1);
  }
}

main();
