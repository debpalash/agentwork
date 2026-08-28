// ─── Configuration ─────────────────────────────────────────────
export interface AIWorkConfig {
  /** Base URL of the AIWork API (e.g. http://localhost:3001/api/v1) */
  apiBase: string;
  /** API key for authenticated requests */
  apiKey?: string;
  /** Agent wallet private key (hex, with or without 0x prefix) */
  privateKey?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Called on every API response for logging/telemetry */
  onRequest?: (method: string, path: string, status: number) => void;
}

// ─── Core Entities ─────────────────────────────────────────────
export interface Task {
  id: string;
  taskId?: string;
  task_id?: string;
  poster?: string;
  employer?: string;
  title: string;
  description?: string;
  category: string;
  phase?: string;
  status?: string;
  reward?: string;
  max_budget?: string;
  base_reward?: string;
  bonusPool?: string;
  deadline?: number;
  totalSteps?: number;
  totalChunks?: number;
  total_chunks?: number;
  chunks?: string;
  steps?: TaskStep[];
  assignedAgentId?: string;
  worker_agent?: string;
  paymentModel?: string;
  payment_model?: string;
  createdAt?: string;
}

export interface TaskStep {
  index: number;
  description: string;
  rewardPercentageBPS: number;
  isCompleted: boolean;
  isVerified: boolean;
  qualityScore?: number;
}

export interface Agent {
  agentId: string;
  agent_id?: string;
  walletAddress: string;
  wallet_address?: string;
  category: string;
  status: string;
  reputation?: number;
  reputationScore?: number;
  reputationPercent?: string;
  tasksCompleted?: number;
  tasks_completed?: number;
  tasksFailed?: number;
  tasks_failed?: number;
  currentStreak?: number;
  current_streak?: number;
  bestStreak?: number;
  avgQualityScore?: number;
  avg_quality?: number;
  totalEarned?: string;
  total_earned?: string;
  isVerified?: boolean;
  skills?: string[];
  registered?: boolean;
}

export interface Bid {
  id?: number;
  taskId: string;
  agentId?: string;
  agentAddress: string;
  amount: string;
  estimatedHours?: number;
  agentReputation?: string;
  timestamp?: number;
  onChain?: boolean;
  txHash?: string;
}

export interface Activity {
  id: number;
  type: string;
  agent?: string;
  agent_id?: string;
  message: string;
  taskId?: string;
  task_id?: string;
  createdAt?: string;
  created_at?: string;
}

// ─── Request Types ─────────────────────────────────────────────
export interface TaskFilter {
  category?: string;
  status?: string;
  phase?: string;
  minReward?: number;
  limit?: number;
}

export interface BidSubmission {
  agentAddress: string;
  agentId: string;
  amount: number | string;
  estimatedHours?: number;
}

export interface AgentRegistration {
  walletAddress: string;
  paymentAddress?: string;
  category: number;
  skills: string[];
}

export interface StepSubmission {
  chunkIndex: number;
  agentId: string;
  commitHash: string;
}

// ─── Response Types ────────────────────────────────────────────
export interface TaskListResponse {
  totalTasks?: number;
  tasks: Task[];
}

export interface BidListResponse {
  taskId: string;
  biddingOpen: boolean;
  totalBids: number;
  bids: Bid[];
  source?: string;
}

export interface AgentListResponse {
  totalAgents?: number;
  agents: Agent[];
}

export interface PlatformStats {
  totalAgents: number;
  totalTasks: number;
  health?: string;
}

export interface MutationResult {
  success: boolean;
  txHash?: string;
  agentId?: string;
  error?: string;
  message?: string;
}

// ─── Problem Protocol v1 ──────────────────────────────────────
export type ProblemDomain = "SOFTWARE" | "MATHEMATICS" | "DATA" | "AI_ML" | "RESEARCH" | "BIOMEDICAL" | "CLIMATE" | "ENGINEERING" | "POLICY" | "OTHER";
export type ProblemRiskTier = "LOW" | "MODERATE" | "HIGH" | "RESTRICTED";
export type FundingMechanism = "GRANT" | "MILESTONE" | "PRIZE" | "REPLICATION_BOUNTY" | "RETROACTIVE";

export interface ProblemSpecV1 {
  version: "1.0";
  slug?: string;
  title: string;
  summary: string;
  description: string;
  domain: ProblemDomain;
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  riskTier: ProblemRiskTier;
  tags?: string[];
  license: string;
  funding?: { amount?: string; token?: string; mechanisms?: FundingMechanism[] };
  verificationPolicy: {
    mode: "CODE" | "FORMAL_PROOF" | "REPRODUCIBLE_RESEARCH" | "EXPERT_PANEL" | "HYBRID";
    minimumIndependentReviews: number;
    replicationRequired: boolean;
    minimumReplications?: number;
    artifactRequirements?: string[];
    acceptanceCriteria: string[];
  };
  governance?: Record<string, unknown>;
  ethics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface Problem extends ProblemSpecV1 {
  id: string;
  status: "DRAFT" | "OPEN" | "ACTIVE" | "REVIEW" | "COMPLETED" | "CANCELLED" | "QUARANTINED";
  funderId: string;
  funderType: string;
  contentDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProblemGraph {
  problem: Problem;
  graph: {
    workstreams: unknown[];
    dependencies: unknown[];
    contributions: unknown[];
    evidence: unknown[];
    reviews: unknown[];
    credits: unknown[];
    fundingPools: unknown[];
  };
  counts: { workstreams: number; contributions: number; evidence: number; reviews: number; credits: number };
}

export interface FundingPledge {
  mechanism: FundingMechanism;
  token: string;
  committedAmount: string;
  escrowReference?: string;
}

export interface ContributionSubmission {
  workstreamId?: string;
  title: string;
  summary: string;
  artifactUri: string;
  artifactDigest: string;
  artifactType: "CODE" | "PROOF" | "DATASET" | "MODEL" | "PAPER" | "PROTOCOL" | "EXPERIMENT" | "ANALYSIS" | "REVIEW" | "NEGATIVE_RESULT" | "OTHER";
  license: string;
  provenance: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
