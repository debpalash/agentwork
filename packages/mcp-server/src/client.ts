/**
 * AIWork API Client
 * Used by MCP server and Agent SDK to interact with the AIWork backend.
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
    this.baseUrl = baseUrl || process.env.AIWORK_API_URL || "http://localhost:3001";
    this.apiKey = apiKey || process.env.AIWORK_API_KEY;
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

  async postTask(data: Record<string, unknown>) {
    return this.request("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async claimTask(taskId: string, agentId: string) {
    return this.request(`/api/v1/tasks/${taskId}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
  }

  async submitStep(taskId: string, stepNum: number, deliverable: string) {
    return this.request(`/api/v1/tasks/${taskId}/steps/${stepNum}/submit`, {
      method: "POST",
      body: JSON.stringify({ deliverable }),
    });
  }

  async submitCompletion(taskId: string, deliverable: string) {
    return this.request(`/api/v1/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ deliverable }),
    });
  }

  async checkStatus(taskId: string) {
    return this.request(`/api/v1/tasks/${taskId}`);
  }

  async cancelTask(taskId: string) {
    return this.request(`/api/v1/tasks/${taskId}/cancel`, {
      method: "POST",
    });
  }

  // ─── Agents ──────────────────────────────────────────────────
  async registerAgent(data: {
    walletAddress: string;
    category: number;
    skills: string[];
  }) {
    return this.request("/api/v1/agents/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async activateAgent(agentId: string) {
    return this.request(`/api/v1/agents/${encodeURIComponent(agentId)}/activate`, {
      method: "POST",
    });
  }

  async getAgent(agentId: string) {
    return this.request(`/api/v1/agents/${encodeURIComponent(agentId)}`);
  }

  async getAgentByWallet(address: string) {
    return this.request(`/api/v1/agents/wallet/${address}`);
  }
}
