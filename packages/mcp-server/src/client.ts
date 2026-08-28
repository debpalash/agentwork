/**
 * Collagent API Client (legacy class name retained for compatibility)
 * Used by MCP server and Agent SDK to interact with the Collagent backend.
 */

export interface SearchTasksParams {
  category?: string;
  status?: string;
  minReward?: number;
  maxComplexity?: number;
  paymentModel?: string;
  limit?: number;
}

export class AIWorkClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || process.env.COLLAGENT_API_URL || process.env.AIWORK_API_URL || "http://localhost:3001";
    this.apiKey = apiKey || process.env.COLLAGENT_API_KEY || process.env.AIWORK_API_KEY;
  }

  private async request(path: string, options?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers || {}) },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  // ─── Platform ────────────────────────────────────────────────
  async getStats() {
    return this.request("/api/v1/platform/stats");
  }

  async getContracts() {
    return this.request("/api/v1/platform/contracts");
  }

  // ─── Problem Protocol ───────────────────────────────────────
  async searchProblems(params: { domain?: string; status?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return this.request(`/api/v1/problems${query.size ? `?${query}` : ""}`);
  }

  async getProblemGraph(problemId: string) {
    return this.request(`/api/v1/problems/${encodeURIComponent(problemId)}/graph`);
  }

  async createProblem(spec: Record<string, unknown>) {
    return this.request("/api/v1/problems", { method: "POST", body: JSON.stringify(spec) });
  }

  async addWorkstream(problemId: string, workstream: Record<string, unknown>) {
    return this.request(`/api/v1/problems/${problemId}/workstreams`, { method: "POST", body: JSON.stringify(workstream) });
  }

  async pledgeFunding(problemId: string, pledge: Record<string, unknown>) {
    return this.request(`/api/v1/problems/${problemId}/funding`, { method: "POST", body: JSON.stringify(pledge) });
  }

  async addContribution(problemId: string, contribution: Record<string, unknown>) {
    return this.request(`/api/v1/problems/${problemId}/contributions`, { method: "POST", body: JSON.stringify(contribution) });
  }

  async addEvidence(contributionId: string, evidence: Record<string, unknown>) {
    return this.request(`/api/v1/problems/contributions/${contributionId}/evidence`, { method: "POST", body: JSON.stringify(evidence) });
  }

  async reviewContribution(contributionId: string, review: Record<string, unknown>) {
    return this.request(`/api/v1/problems/contributions/${contributionId}/reviews`, { method: "POST", body: JSON.stringify(review) });
  }

  // ─── Tasks ───────────────────────────────────────────────────
  async searchTasks(params: SearchTasksParams = {}) {
    const query = new URLSearchParams();
    if (params.category) query.set("category", params.category);
    if (params.status) query.set("status", params.status);
    if (params.minReward) query.set("minReward", params.minReward.toString());
    if (params.maxComplexity) query.set("maxComplexity", params.maxComplexity.toString());
    if (params.paymentModel) query.set("paymentModel", params.paymentModel);
    if (params.limit) query.set("limit", params.limit.toString());

    const qs = query.toString();
    return this.request(`/api/v1/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(taskId: string) {
    return this.request(`/api/v1/tasks/${taskId}`);
  }

  async getTaskSpec(taskId: string) {
    return this.request(`/api/v1/tasks/${taskId}/spec`);
  }

  async submitStep(taskId: string, chunkIndex: number, agentId: string, commitHash: string) {
    return this.request(`/api/v1/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify({ chunkIndex, agentId, commitHash }),
    });
  }

  async checkStatus(taskId: string) {
    return this.request(`/api/v1/tasks/${taskId}`);
  }

  // ─── Agents ──────────────────────────────────────────────────
  async getAgent(agentId: string) {
    return this.request(`/api/v1/agents/${encodeURIComponent(agentId)}`);
  }

  async getAgentByWallet(address: string) {
    return this.request(`/api/v1/agents/wallet/${address}`);
  }

  // ─── Bids ───────────────────────────────────────────────────
  async submitBid(taskId: string, data: {
    agentId: string;
    agentAddress: string;
    amount: number | string;
    estimatedHours?: number;
  }) {
    return this.request(`/api/v1/bids/${taskId}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getBids(taskId: string) {
    return this.request(`/api/v1/bids/${taskId}`);
  }

  async getBidStatus(taskId: string) {
    return this.request(`/api/v1/bids/${taskId}/status`);
  }

  // ─── Notifications ──────────────────────────────────────────
  async getNotifications(agentId: string) {
    return this.request(`/api/v1/tasks/notifications/${agentId}`);
  }
}
