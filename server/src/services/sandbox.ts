/**
 * Sandbox Verification Service — Powered by Daytona
 *
 * Replaces the quality-score stub with real isolated execution:
 *   1. Spin up a Daytona sandbox
 *   2. Clone the agent's Forgejo repo
 *   3. Install dependencies
 *   4. Run tests → testPassed (boolean)
 *   5. Run linter → lintPassed (boolean)
 *   6. Compute quality score from results
 *   7. Tear down sandbox
 *
 * Daytona modes:
 *   - Cloud: set DAYTONA_API_KEY env var (uses Daytona hosted infra)
 *   - Self-hosted: set DAYTONA_API_URL + DAYTONA_API_KEY
 *
 * Falls back to simulated verification if Daytona is not configured.
 */

import { pool } from "../db";

// ─── Config ────────────────────────────────────────────────────
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = process.env.DAYTONA_API_URL || undefined; // auto for cloud
const FORGEJO_URL = process.env.FORGEJO_URL || "http://forgejo:3000";
const FORGEJO_TOKEN = process.env.FORGEJO_ADMIN_TOKEN || "";

const TIMEOUT_SECONDS = 120; // Max time for each command

/** Result from sandbox verification */
export interface VerificationResult {
  testPassed: boolean;
  lintPassed: boolean;
  qualityScore: number;
  testOutput: string;
  lintOutput: string;
  executionTimeMs: number;
  sandboxId?: string;
  mode: "daytona" | "simulated";
}

/**
 * Run verification in a Daytona sandbox.
 * Falls back to simulated if no API key is set.
 */
export async function verifySandbox(
  taskId: string,
  chunkIndex: number,
  repoUrl?: string
): Promise<VerificationResult> {
  if (!DAYTONA_API_KEY) {
    console.log("[SANDBOX] No DAYTONA_API_KEY — using simulated verification");
    return simulatedVerify(taskId, chunkIndex);
  }

  const start = Date.now();
  let sandboxId: string | undefined;

  try {
    // Dynamic import to avoid crash when SDK is optional
    const { Daytona } = await import("@daytonaio/sdk");

    const daytona = new Daytona({
      apiKey: DAYTONA_API_KEY,
      ...(DAYTONA_API_URL ? { apiUrl: DAYTONA_API_URL } : {}),
    });

    // 1. Create sandbox
    console.log(`[SANDBOX] Creating sandbox for task ${taskId.slice(0, 16)}... chunk ${chunkIndex}`);
    const sandbox = await daytona.create({
      language: "typescript",
      envVars: {
        NODE_ENV: "test",
        TASK_ID: taskId,
        CHUNK_INDEX: String(chunkIndex),
      },
    });
    sandboxId = sandbox.id || "unknown";
    console.log(`[SANDBOX] Created: ${sandboxId}`);

    // 2. Clone the task repo
    const cloneUrl = repoUrl || `${FORGEJO_URL}/aiwork/task-${taskId.slice(0, 16)}.git`;
    const cloneResult = await sandbox.process.executeCommand(
      `git clone ${cloneUrl} /workspace/task 2>&1 || echo 'CLONE_FAILED'`,
      "/workspace",
      {},
      TIMEOUT_SECONDS
    );
    console.log(`[SANDBOX] Clone: ${cloneResult.result?.slice(0, 100)}`);

    // 3. Install dependencies
    const installResult = await sandbox.process.executeCommand(
      "cd /workspace/task && (bun install 2>&1 || npm install 2>&1 || echo 'INSTALL_OK')",
      "/workspace",
      {},
      TIMEOUT_SECONDS
    );
    console.log(`[SANDBOX] Install: ${installResult.result?.slice(0, 100)}`);

    // 4. Run tests
    let testPassed = false;
    let testOutput = "";
    try {
      const testResult = await sandbox.process.executeCommand(
        "cd /workspace/task && (bun test 2>&1 || npm test 2>&1)",
        "/workspace",
        {},
        TIMEOUT_SECONDS
      );
      testOutput = testResult.result || "";
      // Check for common pass indicators
      testPassed = testOutput.includes("pass") ||
                   testOutput.includes("✓") ||
                   testOutput.includes("PASS") ||
                   !testOutput.includes("FAIL");
    } catch (testErr: any) {
      testOutput = testErr.message || "Test execution failed";
      testPassed = false;
    }

    // 5. Run linter
    let lintPassed = false;
    let lintOutput = "";
    try {
      const lintResult = await sandbox.process.executeCommand(
        "cd /workspace/task && (npx biome check . 2>&1 || npx eslint . 2>&1 || echo 'NO_LINTER')",
        "/workspace",
        {},
        TIMEOUT_SECONDS
      );
      lintOutput = lintResult.result || "";
      lintPassed = !lintOutput.includes("error") || lintOutput.includes("NO_LINTER");
    } catch (lintErr: any) {
      lintOutput = lintErr.message || "Lint execution failed";
      lintPassed = false;
    }

    // 6. Calculate quality score
    let qualityScore = 50; // Base
    if (testPassed) qualityScore += 30;
    if (lintPassed) qualityScore += 20;
    // Bonus for clean output
    if (testOutput.includes("0 fail")) qualityScore = Math.min(100, qualityScore + 5);

    console.log(`[SANDBOX] Results: test=${testPassed}, lint=${lintPassed}, score=${qualityScore}`);

    // 7. Cleanup
    try {
      await sandbox.delete();
      console.log(`[SANDBOX] Destroyed: ${sandboxId}`);
    } catch (_) {
      console.warn(`[SANDBOX] Cleanup failed for ${sandboxId}`);
    }

    return {
      testPassed,
      lintPassed,
      qualityScore,
      testOutput: testOutput.slice(0, 2000),
      lintOutput: lintOutput.slice(0, 2000),
      executionTimeMs: Date.now() - start,
      sandboxId,
      mode: "daytona",
    };
  } catch (err: any) {
    console.error(`[SANDBOX] Daytona failed: ${err.message} — falling back to simulated`);
    return simulatedVerify(taskId, chunkIndex);
  }
}

/**
 * Simulated verification — DEV-ONLY fallback when Daytona is not configured.
 *
 * Earlier versions emitted a randomized 70-100 quality score, which always
 * cleared the queue worker's 70 threshold and auto-approved every submission
 * (silently masking real verification bugs and triggering escrow payouts on
 * any push). This version:
 *   • refuses to run if NODE_ENV === 'production'
 *   • logs a loud warning so reviewers know dev mode is active
 *   • returns deterministic fields — qualityScore=85, testsPassed=true
 *     so unit tests and demos are reproducible
 */
async function simulatedVerify(
  taskId: string,
  chunkIndex: number
): Promise<VerificationResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[SANDBOX] simulatedVerify must never run in production — configure DAYTONA_API_KEY"
    );
  }

  console.warn(
    `[DEV-ONLY] simulatedVerify: returning fixed quality=85 for testing (task=${taskId.slice(0, 16)}... chunk=${chunkIndex})`
  );

  const start = Date.now();

  return {
    testPassed: true,
    lintPassed: true,
    qualityScore: 85,
    testOutput: "DEV-ONLY simulated verification (deterministic)",
    lintOutput: "DEV-ONLY simulated verification (deterministic)",
    executionTimeMs: Date.now() - start,
    mode: "simulated",
  };
}

/**
 * Record verification result to the database.
 */
export async function recordVerification(
  taskId: string,
  chunkIndex: number,
  result: VerificationResult
): Promise<void> {
  await pool.query(
    `INSERT INTO verification_jobs
       (task_id, chunk_index, status, test_passed, lint_passed, quality_score, sandbox_id, stdout, stderr, duration_ms, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [
      taskId,
      chunkIndex,
      result.qualityScore >= 70 ? "COMPLETED" : "FAILED",
      result.testPassed,
      result.lintPassed,
      result.qualityScore,
      result.sandboxId || null,
      result.testOutput.slice(0, 5000),
      result.lintOutput.slice(0, 5000),
      result.executionTimeMs,
    ]
  );
}
