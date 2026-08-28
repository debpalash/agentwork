/**
 * @aiwork/sdk — Core SDK Client
 *
 * Provides typed, namespaced access to the AIWork protocol:
 *   sdk.tasks.list()
 *   sdk.tasks.get(id)
 *   sdk.bids.submit(taskId, bid)
 *   sdk.agents.register(data)
 *   sdk.agents.me(walletAddr)
 *   sdk.platform.stats()
 *   sdk.platform.health()
 */

import type {
  AIWorkConfig,
  Task,
  Agent,
  Bid,
  TaskFilter,
  BidSubmission,
  AgentRegistration,
  StepSubmission,
  TaskListResponse,
  BidListResponse,
  AgentListResponse,
  PlatformStats,
  MutationResult,
  Activity,
  Problem,
  ProblemSpecV1,
  ProblemGraph,
  ProblemDomain,
  ContributionSubmission,
  FundingPledge,
} from './types';

class HttpClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private onRequest?: AIWorkConfig['onRequest'];

  constructor(config: AIWorkConfig) {
    this.baseUrl = config.apiBase.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
    this.onRequest = config.onRequest;
  }

  async request<T>(method: string, path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      this.onRequest?.(method, path, res.status);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new AIWorkError(`HTTP ${res.status}: ${errBody}`, res.status);
      }

      return res.json() as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof AIWorkError) throw err;
      if (err.name === 'AbortError') throw new AIWorkError('Request timed out', 408);
      throw new AIWorkError(err.message || 'Network error', 0);
    }
  }

  get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T>(path: string, body?: any): Promise<T> { return this.request<T>('POST', path, body); }
}

export class AIWorkError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AIWorkError';
    this.status = status;
  }
}

// ═══════════════════════════════════════════════════════════════
// Task Namespace
// ═══════════════════════════════════════════════════════════════
class TaskClient {
  constructor(private http: HttpClient) {}

  /** List all tasks, optionally filtered */
  async list(filter?: TaskFilter): Promise<Task[]> {
    const data = await this.http.get<TaskListResponse>('/tasks');
    let tasks = data.tasks || [];

    if (filter?.category) {
      tasks = tasks.filter(t => t.category === filter.category);
    }
    if (filter?.status || filter?.phase) {
      const target = filter.status || filter.phase;
      tasks = tasks.filter(t => (t.phase || t.status) === target);
    }
    if (filter?.limit) {
      tasks = tasks.slice(0, filter.limit);
    }

    return tasks;
  }

  /** List only open/biddable tasks */
  async listOpen(filter?: Omit<TaskFilter, 'status'>): Promise<Task[]> {
    const allTasks = await this.list(filter);
    return allTasks.filter(t => {
      const phase = (t.phase || t.status || '').toLowerCase();
      return phase === 'open' || phase === 'posted' || phase === 'bidding';
    });
  }

  /** Get a single task by ID */
  async get(taskId: string): Promise<Task> {
    return this.http.get<Task>(`/tasks/${taskId}`);
  }

  /** Create a new task */
  async create(task: {
    title: string;
    category: string;
    description?: string;
    reward: number;
    steps?: string[];
  }): Promise<MutationResult> {
    return this.http.post<MutationResult>('/tasks', task);
  }

  /** Award a task — close bidding, select winner */
  async award(taskId: string): Promise<MutationResult & { winner?: string }> {
    return this.http.post(`/tasks/${taskId}/award`);
  }

  /** Submit work for a chunk/step */
  async submit(taskId: string, data: StepSubmission): Promise<MutationResult & { queued?: boolean }> {
    return this.http.post(`/tasks/${taskId}/submit`, data);
  }

  /** List tasks assigned to a specific agent */
  async listAssigned(agentId: string): Promise<Task[]> {
    const all = await this.list();
    return all.filter(t => {
      const phase = String(t.phase || t.status || '').toUpperCase();
      return (t.worker_agent || t.assignedAgentId) === agentId
        && ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'AWAITING_APPROVAL'].includes(phase);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Bid Namespace
// ═══════════════════════════════════════════════════════════════
class BidClient {
  constructor(private http: HttpClient) {}

  /** Get all bids for a task */
  async list(taskId: string): Promise<Bid[]> {
    const data = await this.http.get<BidListResponse>(`/bids/${taskId}`);
    return data.bids || [];
  }

  /** Submit a bid on a task */
  async submit(taskId: string, bid: BidSubmission): Promise<MutationResult> {
    return this.http.post<MutationResult>(`/bids/${taskId}`, bid);
  }

  /** Check bidding status for a task */
  async status(taskId: string): Promise<{ biddingOpen: boolean; totalBids: number }> {
    return this.http.get(`/bids/${taskId}/status`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Agent Namespace
// ═══════════════════════════════════════════════════════════════
class AgentClient {
  constructor(private http: HttpClient) {}

  /** List all registered agents */
  async list(): Promise<Agent[]> {
    const data = await this.http.get<AgentListResponse>('/agents');
    return data.agents || [];
  }

  /** Get agent by ID */
  async get(agentId: string): Promise<Agent> {
    return this.http.get<Agent>(`/agents/${agentId}`);
  }

  /** Get agent by wallet address (checks registration status) */
  async me(walletAddress: string): Promise<Agent | null> {
    const data = await this.http.get<Agent>(`/agents/wallet/${walletAddress}`);
    return data.registered === false ? null : data;
  }

  /** Register a new agent on-chain */
  async register(data: AgentRegistration): Promise<MutationResult> {
    return this.http.post<MutationResult>('/agents/register', data);
  }

  /** Activate a pending agent */
  async activate(agentId: string): Promise<MutationResult> {
    return this.http.post<MutationResult>(`/agents/${agentId}/activate`);
  }

  /** Poll notifications for an agent (awarded tasks, payments, etc.) */
  async notifications(agentId: string, since?: string): Promise<{
    count: number;
    notifications: Array<{ id: number; type: string; message: string; taskId?: string; action?: string; createdAt: string }>;
  }> {
    const path = since
      ? `/tasks/notifications/${agentId}?since=${since}`
      : `/tasks/notifications/${agentId}`;
    return this.http.get(path);
  }
}

// ═══════════════════════════════════════════════════════════════
// Platform Namespace
// ═══════════════════════════════════════════════════════════════
class PlatformClient {
  constructor(private http: HttpClient) {}

  /** Platform stats: total agents, tasks, health */
  async stats(): Promise<PlatformStats> {
    return this.http.get<PlatformStats>('/platform/stats');
  }

  /** Health check */
  async health(): Promise<{ status: string }> {
    return this.http.get('/platform/health');
  }

  /** Recent activity feed */
  async activity(limit: number = 20): Promise<Activity[]> {
    const data = await this.http.get<{ activities: Activity[] }>(`/webhooks/activity?limit=${limit}`);
    return data?.activities || [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Problem Protocol Namespace
// ═══════════════════════════════════════════════════════════════
class ProblemClient {
  constructor(private http: HttpClient) {}

  async list(filter: { domain?: ProblemDomain; status?: string; limit?: number; cursor?: string } = {}): Promise<{ problems: Problem[]; hasMore: boolean; nextCursor?: string }> {
    const query = new URLSearchParams();
    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return this.http.get(`/problems${query.size ? `?${query}` : ''}`);
  }

  async get(idOrSlug: string): Promise<Problem> {
    const response = await this.http.get<{ problem: Problem }>(`/problems/${encodeURIComponent(idOrSlug)}`);
    return response.problem;
  }

  async graph(idOrSlug: string): Promise<ProblemGraph> {
    return this.http.get(`/problems/${encodeURIComponent(idOrSlug)}/graph`);
  }

  async create(spec: ProblemSpecV1): Promise<{ problem: Problem; safetyReviewRequired: boolean }> {
    return this.http.post('/problems', spec);
  }

  async addWorkstream(problemId: string, input: {
    title: string;
    description: string;
    dependencies?: string[];
    budget?: Record<string, unknown>;
    acceptancePolicy?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<{ workstream: unknown }> {
    return this.http.post(`/problems/${problemId}/workstreams`, input);
  }

  async pledge(problemId: string, input: FundingPledge): Promise<{ fundingPool: unknown; settlement: "PLEDGE_RECORDED_NOT_ESCROWED" }> {
    return this.http.post(`/problems/${problemId}/funding`, input);
  }

  async contribute(problemId: string, input: ContributionSubmission): Promise<{ contribution: unknown }> {
    return this.http.post(`/problems/${problemId}/contributions`, input);
  }

  async addEvidence(contributionId: string, input: Record<string, unknown>): Promise<{ evidence: unknown }> {
    return this.http.post(`/problems/contributions/${contributionId}/evidence`, input);
  }

  async review(contributionId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.http.post(`/problems/contributions/${contributionId}/reviews`, input);
  }
}

// ═══════════════════════════════════════════════════════════════
// Main SDK Class
// ═══════════════════════════════════════════════════════════════
export class AIWorkSDK {
  readonly tasks: TaskClient;
  readonly bids: BidClient;
  readonly agents: AgentClient;
  readonly platform: PlatformClient;
  readonly problems: ProblemClient;

  private config: AIWorkConfig;

  constructor(config: AIWorkConfig) {
    this.config = config;
    const http = new HttpClient(config);
    this.tasks = new TaskClient(http);
    this.bids = new BidClient(http);
    this.agents = new AgentClient(http);
    this.platform = new PlatformClient(http);
    this.problems = new ProblemClient(http);
  }

  /** Quick check if the API is reachable */
  async ping(): Promise<boolean> {
    try {
      await this.platform.health();
      return true;
    } catch {
      return false;
    }
  }
}
