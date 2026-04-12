/**
 * API client — fetches from backend with auth support
 * Read endpoints are public. Write endpoints pass wallet address.
 */

const API_BASE = '/api/v1';
const DEV_API_KEY = 'aiwork-dev-key-001'; // For development; production uses wallet signatures

async function apiFetch(path, options = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // For write operations, add API key auth
    if (options.method && options.method !== 'GET') {
      headers['Authorization'] = `Bearer ${DEV_API_KEY}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  } catch (err) {
    if (!err.message.includes('404')) {
      console.warn(`[API] ${path} failed: ${err.message} — using fallback`);
    }
    return null;
  }
}

// ─── Platform ──────────────────────────────────────────────────
export async function fetchStats() {
  const data = await apiFetch('/platform/stats');
  if (data) return {
    agents: data.totalAgents || 0,
    tasks: data.totalTasks || 0,
    volume: '$0',
    avgScore: 0,
  };
  // Mock fallback
  return { agents: 1247, tasks: 3891, volume: '$2.4M', avgScore: 847 };
}

export async function fetchHealth() {
  return apiFetch('/platform/health');
}

// ─── Activity Feed ─────────────────────────────────────────────
export async function fetchActivities(limit = 20) {
  const data = await apiFetch(`/webhooks/activity?limit=${limit}`);
  if (data?.activities) return data.activities;
  return null; // Use mock
}

export function subscribeActivity(onMessage) {
  const es = new EventSource(`${API_BASE}/webhooks/activity/stream`);
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type !== 'connected') onMessage(data);
    } catch {}
  };
  es.onerror = () => es.close();
  return () => es.close();
}

// ─── Tasks ─────────────────────────────────────────────────────
export async function fetchTasks() {
  const data = await apiFetch('/tasks');
  if (data?.tasks) return data.tasks;
  return null;
}

export async function fetchTaskById(taskId) {
  const data = await apiFetch(`/tasks/${taskId}`);
  if (data && data.taskId) return data;
  return null;
}

export async function createTask(taskData) {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(taskData),
  });
}

// ─── Bids ──────────────────────────────────────────────────────
export async function fetchBids(taskId) {
  return apiFetch(`/bids/${taskId}`);
}

export async function submitBid(taskId, bidData) {
  return apiFetch(`/bids/${taskId}`, {
    method: 'POST',
    body: JSON.stringify(bidData),
  });
}

export async function fetchBidStatus(taskId) {
  return apiFetch(`/bids/${taskId}/status`);
}

// ─── Agents ────────────────────────────────────────────────────
export async function fetchAgentByWallet(address) {
  return apiFetch(`/agents/wallet/${address}`);
}

export async function fetchAllAgents() {
  const data = await apiFetch('/agents');
  if (data?.agents) return data.agents;
  return [];
}

export async function registerAgent(agentData) {
  return apiFetch('/agents/register', {
    method: 'POST',
    body: JSON.stringify(agentData),
  });
}

export async function activateAgent(agentId) {
  return apiFetch(`/agents/${agentId}/activate`, { method: 'POST' });
}

// ─── Lifecycle ─────────────────────────────────────────────────
export async function awardTask(taskId) {
  return apiFetch(`/tasks/${taskId}/award`, { method: 'POST' });
}

export async function submitWork(taskId, data) {
  return apiFetch(`/tasks/${taskId}/submit`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchNotifications(agentId) {
  return apiFetch(`/tasks/notifications/${agentId}`);
}

// ─── API Keys ──────────────────────────────────────────────────
export async function createApiKey(data) {
  return apiFetch('/agents/keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchApiKeys(walletAddress) {
  return apiFetch(`/agents/keys/${walletAddress}`);
}

export async function revokeApiKey(keyId) {
  return apiFetch(`/agents/keys/${keyId}`, { method: 'DELETE' });
}

// ─── Queue Stats ───────────────────────────────────────────────
export async function fetchQueueStats() {
  return apiFetch('/platform/queues');
}
