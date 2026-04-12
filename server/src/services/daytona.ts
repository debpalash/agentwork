/**
 * Daytona Verification Service
 *
 * Spins up Daytona sandboxes to verify task chunks:
 *   1. Create sandbox
 *   2. Clone Forgejo repo
 *   3. Install dependencies
 *   4. Run test command from TaskSpec
 *   5. Run lint command
 *   6. Score quality → report to on-chain verifyChunk()
 */

interface VerificationResult {
  chunkIndex: number;
  sandboxId: string;
  testPassed: boolean;
  lintPassed: boolean;
  qualityScore: number; // 0-100
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface VerificationRequest {
  taskId: string;
  chunkIndex: number;
  repoUrl: string;
  commitHash: string;
  testCommand: string;
  lintCommand: string;
  runtime: string;
}

const DAYTONA_API = process.env.DAYTONA_API_URL || "http://localhost:3986";
const DAYTONA_KEY = process.env.DAYTONA_API_KEY || "";

class DaytonaVerifier {
  private headers: Record<string, string>;

  constructor() {
    this.headers = {
      "Content-Type": "application/json",
      ...(DAYTONA_KEY ? { Authorization: `Bearer ${DAYTONA_KEY}` } : {}),
    };
  }

  /**
   * Verify a chunk submission in a Daytona sandbox
   */
  async verifyChunk(req: VerificationRequest): Promise<VerificationResult> {
    const start = Date.now();
    let sandboxId = "";

    try {
      // 1. Create sandbox
      console.log(`[VERIFY] Creating sandbox for task ${req.taskId} chunk ${req.chunkIndex}`);
      const sandbox = await this.createSandbox(req.runtime);
      sandboxId = sandbox.id;

      // 2. Clone repo at specific commit
      console.log(`[VERIFY] Cloning repo at ${req.commitHash.slice(0, 8)}`);
      await this.exec(sandboxId, `git clone ${req.repoUrl} /workspace`);
      await this.exec(sandboxId, `cd /workspace && git checkout ${req.commitHash}`);

      // 3. Install dependencies
      console.log(`[VERIFY] Installing deps`);
      const installCmd = this.getInstallCommand(req.runtime);
      await this.exec(sandboxId, `cd /workspace && ${installCmd}`, 120);

      // 4. Run tests
      console.log(`[VERIFY] Running tests: ${req.testCommand}`);
      const testResult = await this.exec(
        sandboxId,
        `cd /workspace && ${req.testCommand}`,
        180
      );
      const testPassed = testResult.exitCode === 0;

      // 5. Run lint
      console.log(`[VERIFY] Running lint: ${req.lintCommand}`);
      const lintResult = await this.exec(
        sandboxId,
        `cd /workspace && ${req.lintCommand}`,
        60
      );
      const lintPassed = lintResult.exitCode === 0;

      // 6. Score quality
      const qualityScore = this.calculateScore(testPassed, lintPassed, testResult, lintResult);

      const result: VerificationResult = {
        chunkIndex: req.chunkIndex,
        sandboxId,
        testPassed,
        lintPassed,
        qualityScore,
        exitCode: testResult.exitCode,
        stdout: testResult.stdout.slice(-2000), // Last 2KB
        stderr: testResult.stderr.slice(-2000),
        durationMs: Date.now() - start,
      };

      console.log(
        `[VERIFY] ✅ Chunk ${req.chunkIndex} — quality: ${qualityScore}/100 ` +
        `(tests: ${testPassed ? 'PASS' : 'FAIL'}, lint: ${lintPassed ? 'PASS' : 'FAIL'}) ` +
        `[${result.durationMs}ms]`
      );

      return result;
    } catch (err: any) {
      console.error(`[VERIFY] ❌ Chunk ${req.chunkIndex} failed: ${err.message}`);
      return {
        chunkIndex: req.chunkIndex,
        sandboxId,
        testPassed: false,
        lintPassed: false,
        qualityScore: 0,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        durationMs: Date.now() - start,
      };
    } finally {
      // Cleanup sandbox
      if (sandboxId) {
        await this.removeSandbox(sandboxId).catch(() => {});
      }
    }
  }

  /**
   * Verify all chunks for a task in parallel
   */
  async verifyAllChunks(
    taskId: string,
    repoUrl: string,
    chunks: { index: number; commitHash: string }[],
    spec: { testCommand: string; lintCommand: string; runtime: string }
  ): Promise<VerificationResult[]> {
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.verifyChunk({
          taskId,
          chunkIndex: chunk.index,
          repoUrl,
          commitHash: chunk.commitHash,
          testCommand: spec.testCommand || "echo 'No tests configured'",
          lintCommand: spec.lintCommand || "echo 'No linting configured'",
          runtime: spec.runtime || "node",
        })
      )
    );

    const passed = results.filter((r) => r.qualityScore >= 50).length;
    console.log(
      `[VERIFY] Task ${taskId}: ${passed}/${results.length} chunks passed verification`
    );

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // DAYTONA API CALLS
  // ═══════════════════════════════════════════════════════════

  private async createSandbox(runtime: string): Promise<{ id: string }> {
    const image = this.getRuntimeImage(runtime);

    const res = await fetch(`${DAYTONA_API}/api/sandboxes`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        image,
        resources: { cpu: 2, memory: "2Gi" },
        timeout: 600, // 10 min max
        env: {
          CI: "true",
          AIWORK_VERIFICATION: "true",
        },
      }),
    });

    if (!res.ok) throw new Error(`Sandbox creation failed: ${res.status}`);
    return res.json();
  }

  private async exec(
    sandboxId: string,
    command: string,
    timeoutSec = 60
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const res = await fetch(`${DAYTONA_API}/api/sandboxes/${sandboxId}/exec`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        command,
        timeout: timeoutSec,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Exec failed: ${res.status} — ${body}`);
    }

    return res.json();
  }

  private async removeSandbox(sandboxId: string): Promise<void> {
    await fetch(`${DAYTONA_API}/api/sandboxes/${sandboxId}`, {
      method: "DELETE",
      headers: this.headers,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SCORING
  // ═══════════════════════════════════════════════════════════

  private calculateScore(
    testPassed: boolean,
    lintPassed: boolean,
    testResult: { stdout: string },
    lintResult: { stdout: string }
  ): number {
    let score = 0;

    // Tests: 60 points
    if (testPassed) {
      score += 60;
      // Bonus for comprehensive test coverage
      const testOutput = testResult.stdout.toLowerCase();
      if (testOutput.includes("coverage")) {
        const coverageMatch = testOutput.match(/(\d+(?:\.\d+)?)%/);
        if (coverageMatch) {
          const coverage = parseFloat(coverageMatch[1]);
          score += Math.min(10, Math.floor(coverage / 10)); // Up to 10 bonus pts
        }
      }
    }

    // Lint: 20 points
    if (lintPassed) {
      score += 20;
    } else {
      // Partial credit if warnings only (no errors)
      const lintOutput = lintResult.stdout.toLowerCase();
      if (!lintOutput.includes("error") && lintOutput.includes("warning")) {
        score += 10; // Warnings-only = half credit
      }
    }

    // Base participation: 10 points (code exists and runs)
    score += 10;

    return Math.min(100, score);
  }

  private getRuntimeImage(runtime: string): string {
    const images: Record<string, string> = {
      node: "node:22-slim",
      bun: "oven/bun:1.3-alpine",
      python: "python:3.13-slim",
      rust: "rust:1-slim",
      go: "golang:1.23-alpine",
      multi: "ubuntu:24.04",
    };
    return images[runtime] || images.node;
  }

  private getInstallCommand(runtime: string): string {
    const cmds: Record<string, string> = {
      node: "npm install --no-audit --no-fund 2>/dev/null || yarn install --frozen-lockfile 2>/dev/null || true",
      bun: "bun install --frozen-lockfile 2>/dev/null || true",
      python: "pip install -r requirements.txt 2>/dev/null || true",
      rust: "cargo build 2>/dev/null || true",
      go: "go mod download 2>/dev/null || true",
      multi: "echo 'Multi-lang: install manually'",
    };
    return cmds[runtime] || cmds.node;
  }

  /**
   * Health check
   */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${DAYTONA_API}/api/health`, {
        headers: this.headers,
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const verifier = new DaytonaVerifier();
