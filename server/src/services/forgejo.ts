/**
 * Forgejo Service — Programmatic git repository management for AIWork
 *
 * Manages private task repos: create, grant access, setup webhooks,
 * and track commit activity for chunk verification.
 */

interface ForgejoConfig {
  baseUrl: string;
  adminToken: string;
  orgName: string;
  webhookUrl: string;
  webhookSecret: string;
}

interface RepoAccess {
  username: string;
  permission: "read" | "write" | "admin";
}

const config: ForgejoConfig = {
  baseUrl: process.env.FORGEJO_URL || "http://localhost:3000",
  adminToken: process.env.FORGEJO_ADMIN_TOKEN || "",
  orgName: process.env.FORGEJO_ORG || "aiwork",
  webhookUrl: process.env.FORGEJO_WEBHOOK_URL || "http://localhost:3001/api/v1/webhooks/push",
  webhookSecret: process.env.FORGEJO_WEBHOOK_SECRET || "aiwork-webhook-secret",
};

class ForgejoService {
  private headers: Record<string, string>;

  constructor() {
    this.headers = {
      Authorization: `token ${config.adminToken}`,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`${config.baseUrl}/api/v1${path}`, {
      ...options,
      headers: { ...this.headers, ...(options.headers || {}) },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Forgejo API error: ${res.status} - ${body}`);
    }

    return res.status === 204 ? null : res.json();
  }

  // ═══════════════════════════════════════════════════════════════
  // REPO LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a private repo for a task
   */
  async createTaskRepo(taskId: string, title: string): Promise<any> {
    const repoName = this.taskIdToRepoName(taskId);

    const repo = await this.request(`/orgs/${config.orgName}/repos`, {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        description: `AIWork Task: ${title}`,
        private: true,
        auto_init: true,
        default_branch: "main",
        readme: "Default",
      }),
    });

    // Setup webhook for push events
    await this.setupWebhook(repoName);

    return {
      repoSlug: `${config.orgName}/${repoName}`,
      cloneUrl: `${config.baseUrl}/${config.orgName}/${repoName}.git`,
      webUrl: `${config.baseUrl}/${config.orgName}/${repoName}`,
    };
  }

  /**
   * Seed the repo with task spec and chunk definitions
   */
  async seedTaskRepo(taskId: string, spec: any, chunks: any[]): Promise<void> {
    const repoName = this.taskIdToRepoName(taskId);
    const owner = config.orgName;

    // Create TASK_SPEC.md
    const specContent = this.formatTaskSpec(spec, chunks);
    await this.createFile(owner, repoName, "TASK_SPEC.md", specContent, "Initialize task spec");

    // Create chunk directories with README
    for (let i = 0; i < chunks.length; i++) {
      const chunkDir = `chunk-${i + 1}`;
      const readme = `# Chunk ${i + 1}: ${chunks[i].description}\n\n` +
        `**Weight:** ${(chunks[i].percentageBPS / 100).toFixed(1)}%\n\n` +
        `**Status:** ⏳ Pending\n\n` +
        `Place your deliverables in this directory.\n`;
      await this.createFile(owner, repoName, `${chunkDir}/README.md`, readme, `Init chunk ${i + 1}`);
    }
  }

  /**
   * Grant access to a user (worker or employer)
   */
  async grantAccess(taskId: string, username: string, permission: "read" | "write"): Promise<void> {
    const repoName = this.taskIdToRepoName(taskId);
    await this.request(`/repos/${config.orgName}/${repoName}/collaborators/${username}`, {
      method: "PUT",
      body: JSON.stringify({ permission }),
    });
  }

  /**
   * Revoke access (after task completion)
   */
  async revokeAccess(taskId: string, username: string): Promise<void> {
    const repoName = this.taskIdToRepoName(taskId);
    await this.request(`/repos/${config.orgName}/${repoName}/collaborators/${username}`, {
      method: "DELETE",
    });
  }

  /**
   * Archive repo (make read-only after completion)
   */
  async archiveRepo(taskId: string): Promise<void> {
    const repoName = this.taskIdToRepoName(taskId);
    await this.request(`/repos/${config.orgName}/${repoName}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // COMMIT TRACKING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get recent commits for a task repo
   */
  async getCommits(taskId: string, limit = 20): Promise<any[]> {
    const repoName = this.taskIdToRepoName(taskId);
    return this.request(`/repos/${config.orgName}/${repoName}/commits?limit=${limit}`);
  }

  /**
   * Get diff for a specific commit
   */
  async getCommitDiff(taskId: string, sha: string): Promise<string> {
    const repoName = this.taskIdToRepoName(taskId);
    const res = await fetch(
      `${config.baseUrl}/api/v1/repos/${config.orgName}/${repoName}/git/commits/${sha}`,
      { headers: this.headers }
    );
    const data = await res.json();
    return data;
  }

  /**
   * Get files changed in a directory (for chunk verification)
   */
  async getDirectoryContents(taskId: string, path: string): Promise<any[]> {
    const repoName = this.taskIdToRepoName(taskId);
    return this.request(`/repos/${config.orgName}/${repoName}/contents/${path}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCESS TOKENS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a scoped access token for a worker agent
   */
  async createAgentToken(username: string, taskId: string): Promise<string> {
    const token = await this.request(`/users/${username}/tokens`, {
      method: "POST",
      body: JSON.stringify({
        name: `aiwork-${taskId.slice(0, 8)}`,
        scopes: ["write:repository"],
      }),
    });
    return token.sha1;
  }

  // ═══════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ═══════════════════════════════════════════════════════════════

  private async setupWebhook(repoName: string): Promise<void> {
    await this.request(`/repos/${config.orgName}/${repoName}/hooks`, {
      method: "POST",
      body: JSON.stringify({
        type: "forgejo",
        config: {
          url: config.webhookUrl,
          content_type: "json",
          secret: config.webhookSecret,
        },
        events: ["push"],
        active: true,
      }),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // USER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a Forgejo user for an agent
   */
  async createUser(username: string, email: string): Promise<any> {
    return this.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        email,
        password: crypto.randomUUID(),
        must_change_password: false,
        visibility: "private",
      }),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private taskIdToRepoName(taskId: string): string {
    // Convert bytes32 taskId to a short repo name
    return `task-${taskId.slice(2, 14)}`;
  }

  private async createFile(
    owner: string, repo: string, path: string,
    content: string, message: string
  ): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: "POST",
      body: JSON.stringify({
        content: Buffer.from(content).toString("base64"),
        message,
      }),
    });
  }

  private formatTaskSpec(spec: any, chunks: any[]): string {
    return `# Task Specification

## ${spec.title || "Untitled Task"}

**Category:** ${spec.category || "General"}
**Max Budget:** ${spec.maxBudget || "N/A"}
**Deadline:** ${spec.deadline ? new Date(spec.deadline * 1000).toISOString() : "N/A"}

## Description
${spec.description || "No description provided."}

## Chunks

${chunks.map((c: any, i: number) => `### Chunk ${i + 1}: ${c.description}
- **Weight:** ${(c.percentageBPS / 100).toFixed(1)}%
- **Directory:** \`chunk-${i + 1}/\``).join("\n\n")}

## Acceptance Criteria
${spec.acceptance ? JSON.stringify(spec.acceptance, null, 2) : "Defined by employer."}

---
*Generated by AIWork Platform*
`;
  }
}

export const forgejo = new ForgejoService();
export type { ForgejoConfig };
