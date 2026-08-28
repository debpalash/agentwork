/**
 * Fail-closed task verification in an isolated Daytona sandbox.
 *
 * A verification is bound to an immutable Git commit and an employer-owned
 * TaskSpec. Command exit codes are authoritative; output text is diagnostic
 * only. Production never falls back to simulated results.
 */

import { pool } from "../db";

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = process.env.DAYTONA_API_URL || undefined;
const FORGEJO_READ_TOKEN = process.env.FORGEJO_READ_TOKEN || process.env.FORGEJO_ADMIN_TOKEN || "";
const TIMEOUT_SECONDS = Number(process.env.VERIFICATION_TIMEOUT_SECONDS || "180");
const MAX_OUTPUT_BYTES = 5_000;

export interface VerificationRequest {
  taskId: string;
  chunkIndex: number;
  repoUrl: string;
  commitHash: string;
  testCommand: string;
  lintCommand?: string | null;
  runtime?: string | null;
}

export interface VerificationResult {
  testPassed: boolean;
  lintPassed: boolean;
  qualityScore: number;
  testOutput: string;
  lintOutput: string;
  executionTimeMs: number;
  verifiedCommit: string;
  sandboxId?: string;
  mode: "daytona" | "simulated";
}

const GIT_COMMIT_RE = /^[0-9a-f]{40}$/i;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function languageForRuntime(runtime?: string | null): "typescript" | "python" {
  return runtime === "python" ? "python" : "typescript";
}

function installCommand(runtime?: string | null): string {
  switch (runtime) {
    case "python":
      return "if [ -f requirements.txt ]; then pip install --requirement requirements.txt; elif [ -f pyproject.toml ]; then pip install .; fi";
    case "rust":
      return "cargo fetch --locked";
    case "go":
      return "go mod download";
    case "bun":
      return "if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile; elif [ -f package.json ]; then bun install; fi";
    default:
      return "if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile; elif [ -f package-lock.json ]; then npm ci --ignore-scripts=false; elif [ -f package.json ]; then npm install --ignore-scripts=false; fi";
  }
}

function validateRequest(request: VerificationRequest): void {
  if (!request.taskId || request.chunkIndex < 0 || !Number.isInteger(request.chunkIndex)) {
    throw new Error("Invalid verification task or chunk index");
  }
  if (!request.repoUrl) throw new Error("TaskSpec repoUrl is required");
  if (!GIT_COMMIT_RE.test(request.commitHash)) {
    throw new Error("commitHash must be a full 40-character Git commit SHA");
  }
  if (!request.testCommand?.trim()) {
    throw new Error("TaskSpec testCommand is required; verification cannot be subjective");
  }
}

export async function verifySandbox(
  request: VerificationRequest
): Promise<VerificationResult> {
  validateRequest(request);

  if (!DAYTONA_API_KEY) {
    return simulatedVerify(request);
  }

  const start = Date.now();
  let sandboxId: string | undefined;
  let sandbox: any;

  try {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({
      apiKey: DAYTONA_API_KEY,
      ...(DAYTONA_API_URL ? { apiUrl: DAYTONA_API_URL } : {}),
    });

    sandbox = await daytona.create({
      language: languageForRuntime(request.runtime),
      envVars: {
        NODE_ENV: "test",
        CI: "true",
        TASK_ID: request.taskId,
        CHUNK_INDEX: String(request.chunkIndex),
        AIWORK_VERIFICATION: "true",
      },
    });
    sandboxId = sandbox.id || "unknown";

    const authOption = FORGEJO_READ_TOKEN
      ? `-c ${shellQuote(`http.extraHeader=Authorization: token ${FORGEJO_READ_TOKEN}`)}`
      : "";
    const clone = await sandbox.process.executeCommand(
      `git ${authOption} clone --no-checkout -- ${shellQuote(request.repoUrl)} /workspace/task`,
      "/workspace",
      {},
      TIMEOUT_SECONDS
    );
    if (clone.exitCode !== 0) {
      throw new Error(`Repository clone failed: ${clone.result?.slice(-500) || "unknown error"}`);
    }

    const checkout = await sandbox.process.executeCommand(
      `git checkout --detach ${request.commitHash}`,
      "/workspace/task",
      {},
      TIMEOUT_SECONDS
    );
    if (checkout.exitCode !== 0) {
      throw new Error(`Commit checkout failed: ${checkout.result?.slice(-500) || "unknown error"}`);
    }

    const resolved = await sandbox.process.executeCommand(
      "git rev-parse HEAD",
      "/workspace/task",
      {},
      30
    );
    const verifiedCommit = resolved.result.trim().toLowerCase();
    if (resolved.exitCode !== 0 || verifiedCommit !== request.commitHash.toLowerCase()) {
      throw new Error(`Commit mismatch: requested ${request.commitHash}, resolved ${verifiedCommit || "none"}`);
    }

    const install = await sandbox.process.executeCommand(
      installCommand(request.runtime),
      "/workspace/task",
      {},
      TIMEOUT_SECONDS
    );
    if (install.exitCode !== 0) {
      throw new Error(`Dependency installation failed: ${install.result?.slice(-500) || "unknown error"}`);
    }

    const test = await sandbox.process.executeCommand(
      request.testCommand,
      "/workspace/task",
      {},
      TIMEOUT_SECONDS
    );
    const testPassed = test.exitCode === 0;

    let lintPassed = true;
    let lintOutput = "No lint command configured";
    if (request.lintCommand?.trim()) {
      const lint = await sandbox.process.executeCommand(
        request.lintCommand,
        "/workspace/task",
        {},
        TIMEOUT_SECONDS
      );
      lintPassed = lint.exitCode === 0;
      lintOutput = lint.result || "";
    }

    // Tests are the payment gate. Lint affects quality but cannot rescue a
    // failing test suite.
    const qualityScore = testPassed ? (lintPassed ? 100 : 80) : (lintPassed ? 20 : 0);

    return {
      testPassed,
      lintPassed,
      qualityScore,
      testOutput: (test.result || "").slice(-MAX_OUTPUT_BYTES),
      lintOutput: lintOutput.slice(-MAX_OUTPUT_BYTES),
      executionTimeMs: Date.now() - start,
      verifiedCommit,
      sandboxId,
      mode: "daytona",
    };
  } catch (err: any) {
    if (process.env.NODE_ENV === "production") throw err;
    console.error(`[SANDBOX] Daytona failed in development: ${err.message}`);
    return simulatedVerify(request);
  } finally {
    if (sandbox) {
      await sandbox.delete().catch((err: any) => {
        console.warn(`[SANDBOX] Cleanup failed for ${sandboxId}: ${err.message}`);
      });
    }
  }
}

/** Deterministic local-only fixture. It is deliberately marked simulated. */
async function simulatedVerify(
  request: VerificationRequest
): Promise<VerificationResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("DAYTONA_API_KEY is required for production verification");
  }

  console.warn(
    `[DEV-ONLY] Simulated verification for ${request.taskId} chunk ${request.chunkIndex}; no payment should rely on this result`
  );
  return {
    testPassed: true,
    lintPassed: true,
    qualityScore: 100,
    testOutput: "DEV-ONLY deterministic verification",
    lintOutput: "DEV-ONLY deterministic verification",
    executionTimeMs: 0,
    verifiedCommit: request.commitHash.toLowerCase(),
    mode: "simulated",
  };
}

export async function recordVerification(
  request: VerificationRequest,
  result: VerificationResult,
  evidenceHash?: string
): Promise<number> {
  const status = result.mode === "simulated"
    ? "SIMULATED"
    : result.testPassed && result.qualityScore >= 70 ? "COMPLETED" : "FAILED";
  const { rows } = await pool.query(
    `INSERT INTO verification_jobs
       (task_id, chunk_index, status, exit_code, test_passed, lint_passed,
        quality_score, sandbox_id, stdout, stderr, duration_ms, evidence_hash, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
     RETURNING id`,
    [
      request.taskId,
      request.chunkIndex,
      status,
      result.testPassed ? 0 : 1,
      result.testPassed,
      result.lintPassed,
      result.qualityScore,
      result.sandboxId || null,
      result.testOutput,
      result.lintOutput,
      result.executionTimeMs,
      evidenceHash || null,
    ]
  );
  return Number(rows[0].id);
}
