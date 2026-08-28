import { formatUnits } from 'viem'
import type { Address, WalletClient } from 'viem'
import type {
  Activity,
  Agent,
  ApiIssue,
  ApiRecord,
  Bid,
  DisputeRecord,
  FundingMechanism,
  MutationResult,
  PlatformStats,
  Problem,
  ProblemGraphResponse,
  ProblemListResponse,
  ProblemSpec,
  Task,
  WalletAuth,
} from './types'

/**
 * API client for backend requests with authentication support.
 * Read endpoints are public. Write endpoints pass wallet address.
 */

const API_BASE = '/api/v1'
// Browser writes use a request-bound wallet signature. The well-known key is
// retained only for local development utilities and is never embedded in a
// production build.
const API_KEY = import.meta.env.DEV ? 'aiwork-dev-key-001' : ''

interface ApiErrorInit {
  status?: number
  path?: string
  issues?: ApiIssue[]
}

interface ApiFetchOptions extends RequestInit {
  auth?: WalletAuth
}

export class ApiError extends Error {
  readonly status: number
  readonly path: string
  readonly issues: ApiIssue[]

  constructor(message: string, { status = 0, path = '', issues = [] }: ApiErrorInit = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.issues = issues
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Network request failed'
}

export async function walletAuthHeaders(fullPath: string, method: string, body: string, address: Address, walletClient: WalletClient): Promise<Record<string, string>> {
  const bodyBytes = new TextEncoder().encode(body || '')
  const bodyDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bodyBytes)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  const message = [
    'AIWork request v2',
    `origin:${window.location.origin}`,
    `chainId:${Number(import.meta.env.VITE_CHAIN_ID || 31337)}`,
    `method:${method.toUpperCase()}`,
    `path:${fullPath}`,
    `bodySha256:${bodyDigest}`,
    `issuedAt:${new Date().toISOString()}`,
    `nonce:${crypto.randomUUID()}`,
  ].join('\n')
  const signature = await walletClient.signMessage({ account: address, message })
  const encodedMessage = btoa(message).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return {
    'X-Wallet-Address': address,
    'X-Wallet-Message': encodedMessage,
    'X-Wallet-Signature': signature,
  }
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { auth, headers: suppliedHeaders, ...fetchOptions } = options
  const requestBody = typeof options.body === 'string' ? options.body : ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(suppliedHeaders as Record<string, string> | undefined),
  }

  if (auth?.walletClient && auth?.address) {
    const method = (options.method || 'GET').toUpperCase()
    Object.assign(headers, await walletAuthHeaders(`${API_BASE}${path}`, method, requestBody, auth.address, auth.walletClient))
  } else if (options.method && options.method !== 'GET' && API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...fetchOptions,
    })
    const body = res.status === 204 ? null : await res.json().catch(() => ({})) as (ApiRecord & { issues?: ApiIssue[]; error?: string }) | null
    if (!res.ok) {
      const issues = body?.issues || []
      const summary = body?.error || `Request failed with HTTP ${res.status}`
      const details = issues.slice(0, 5).map(issue => `${issue.path || 'request'}: ${issue.message}`).join('; ')
      throw new ApiError(details ? `${summary}. ${details}` : summary, { status: res.status, path, issues })
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(errorMessage(error), { path })
  }
}

// ─── Platform ──────────────────────────────────────────────────
export async function fetchStats(): Promise<PlatformStats> {
  const data = await apiFetch<{ totalAgents?: number; totalTasks?: number; volume?: number | string; avgScore?: number; totalProblems?: number; acceptedContributions?: number; evidenceRecords?: number }>('/platform/stats')
  return {
    agents: data.totalAgents || 0,
    tasks: data.totalTasks || 0,
    volume: `$${Number(data.volume || 0).toLocaleString()}`,
    avgScore: Number(data.avgScore || 0),
    problems: Number(data.totalProblems || 0),
    contributions: Number(data.acceptedContributions || 0),
    evidence: Number(data.evidenceRecords || 0),
  }
}

export async function fetchHealth(): Promise<ApiRecord> {
  return apiFetch<ApiRecord>('/platform/health')
}

// ─── Problem Protocol v1 ──────────────────────────────────────
export async function fetchProblems(filters: Record<string, string | number | undefined> = {}): Promise<ProblemListResponse> {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  })
  return apiFetch<ProblemListResponse>(`/problems${query.size ? `?${query}` : ''}`)
}

export async function fetchProblemGraph(problemId: string, auth?: WalletAuth): Promise<ProblemGraphResponse> {
  return apiFetch<ProblemGraphResponse>(`/problems/${encodeURIComponent(problemId)}/graph`, { auth })
}

export async function createProblem(problem: ProblemSpec, auth: WalletAuth): Promise<{ problem: Problem; safetyReviewRequired?: boolean }> {
  return apiFetch('/problems', { method: 'POST', auth, body: JSON.stringify(problem) })
}

export async function createProblemFunding(problemId: string, funding: { mechanism: FundingMechanism; token: string; committedAmount: string; escrowReference?: string }, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/problems/${encodeURIComponent(problemId)}/funding`, { method: 'POST', auth, body: JSON.stringify(funding) })
}

export async function createProblemWorkstream(problemId: string, workstream: ApiRecord, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/problems/${encodeURIComponent(problemId)}/workstreams`, { method: 'POST', auth, body: JSON.stringify(workstream) })
}

export async function createProblemContribution(problemId: string, contribution: ApiRecord, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/problems/${encodeURIComponent(problemId)}/contributions`, { method: 'POST', auth, body: JSON.stringify(contribution) })
}

export async function createContributionEvidence(contributionId: string, evidence: ApiRecord, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/problems/contributions/${encodeURIComponent(contributionId)}/evidence`, { method: 'POST', auth, body: JSON.stringify(evidence) })
}

export async function createContributionReview(contributionId: string, review: ApiRecord, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/problems/contributions/${encodeURIComponent(contributionId)}/reviews`, { method: 'POST', auth, body: JSON.stringify(review) })
}

// ─── Chain-authoritative disputes ─────────────────────────────
export async function projectDispute(data: { taskId: string; reason: string; openTxHash?: string }, auth: WalletAuth): Promise<DisputeRecord> {
  return apiFetch('/disputes', { method: 'POST', auth, body: JSON.stringify(data) })
}

export async function syncDispute(disputeId: string, txHash?: string): Promise<DisputeRecord> {
  return apiFetch(`/disputes/${encodeURIComponent(disputeId)}/sync`, {
    method: 'POST',
    body: JSON.stringify(txHash ? { txHash } : {}),
  })
}

// ─── Activity Feed ─────────────────────────────────────────────
export async function fetchActivities(limit = 20): Promise<Activity[]> {
  const data = await apiFetch<{ activities?: Activity[] }>(`/webhooks/activity?limit=${limit}`)
  return data.activities || []
}

export function subscribeActivity(onMessage: (activity: Activity) => void, onStatus?: (status: 'live' | 'reconnecting') => void): () => void {
  const es = new EventSource(`${API_BASE}/webhooks/activity/stream`)
  es.onopen = () => onStatus?.('live')
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as Activity
      if (data.type !== 'connected') onMessage(data)
    } catch {}
  }
  es.onerror = () => onStatus?.('reconnecting')
  return () => es.close()
}

// ─── Tasks ─────────────────────────────────────────────────────
export async function fetchTasks(): Promise<Task[]> {
  const data = await apiFetch<{ tasks?: Task[] }>('/tasks')
  return data.tasks || []
}

export async function fetchTaskById(taskId: string): Promise<Task | null> {
  const data = await apiFetch<Task & { taskId?: string; baseReward?: string; status?: string; steps?: Array<{ description: string }>; assignedAgentId?: string }>(`/tasks/${taskId}`)
  if (data && data.taskId) {
    const decimals = Number(import.meta.env.VITE_PAYMENT_TOKEN_DECIMALS || 18)
    return {
      ...data,
      id: data.taskId,
      phase: data.status,
      budget: `${formatUnits(BigInt(data.baseReward || 0), decimals)} USDC`,
      chunkDescriptions: (data.steps || []).map(step => step.description),
      worker_agent: data.assignedAgentId,
    }
  }
  return null
}

export async function createTask(taskData: ApiRecord): Promise<MutationResult> {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(taskData),
  })
}

// ─── Bids ──────────────────────────────────────────────────────
export async function fetchBids(taskId: string): Promise<{ taskId?: string; biddingOpen?: boolean; totalBids?: number; bids: Bid[] }> {
  return apiFetch(`/bids/${taskId}`)
}

export async function submitBid(taskId: string, bidData: { agentAddress: string; agentId: string; amount: number | string; estimatedHours?: number }, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/bids/${taskId}`, {
    method: 'POST',
    auth,
    body: JSON.stringify(bidData),
  })
}

export async function fetchBidStatus(taskId: string): Promise<ApiRecord> {
  return apiFetch(`/bids/${taskId}/status`)
}

// ─── Agents ────────────────────────────────────────────────────
export async function fetchAgentByWallet(address: string): Promise<Agent & { registered: boolean }> {
  return apiFetch(`/agents/wallet/${address}`)
}

export async function fetchAllAgents(): Promise<Agent[]> {
  const data = await apiFetch<{ agents?: Agent[] }>('/agents')
  return data.agents || []
}

export async function registerAgent(agentData: { walletAddress: string; paymentAddress: string; category: number; skills: string[] }, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch('/agents/register', {
    method: 'POST',
    auth,
    body: JSON.stringify(agentData),
  })
}

// ─── Lifecycle ─────────────────────────────────────────────────
export async function awardTask(taskId: string, auth: WalletAuth): Promise<MutationResult> {
  return apiFetch(`/tasks/${taskId}/award`, { method: 'POST', auth })
}

export async function submitWork(taskId: string, data: ApiRecord): Promise<MutationResult> {
  return apiFetch(`/tasks/${taskId}/submit`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function fetchNotifications(agentId: string): Promise<ApiRecord[]> {
  return apiFetch(`/tasks/notifications/${agentId}`)
}

// ─── API Keys ──────────────────────────────────────────────────
export async function createApiKey(data: ApiRecord): Promise<MutationResult & { apiKey?: string }> {
  return apiFetch('/agents/keys', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function fetchApiKeys(walletAddress: string): Promise<ApiRecord[]> {
  return apiFetch(`/agents/keys/${walletAddress}`)
}

export async function revokeApiKey(keyId: string): Promise<MutationResult> {
  return apiFetch(`/agents/keys/${keyId}`, { method: 'DELETE' })
}

// ─── Queue Stats ───────────────────────────────────────────────
export async function fetchQueueStats(): Promise<ApiRecord> {
  return apiFetch('/platform/queues')
}
