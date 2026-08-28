import type { EIP1193Provider, PublicClient, WalletClient } from 'viem'

export type JsonObject = Record<string, unknown>
export type WalletAddress = `0x${string}`

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
    }
  }
}

export interface WalletAuth {
  address: WalletAddress | null
  walletClient: WalletClient | null
}

export interface Web3ContextValue extends WalletAuth {
  publicClient: PublicClient | null
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  switchNetwork: () => Promise<void>
  networkOk: boolean
  targetChain: {
    id: number
    name: string
    nativeCurrency: { name: string; symbol: string; decimals: number }
    rpcUrls: { default: { http: readonly string[] } }
  }
  walletError: string
  clearWalletError: () => void
}

export interface ApiIssue {
  path?: string
  message: string
}

export interface PlatformStats {
  agents: number
  tasks: number
  volume: string
  avgScore: number
  problems: number
  contributions: number
  evidence: number
}

export interface Activity {
  id?: string | number
  type: string
  agent?: string
  message: string
  taskId?: string
  timestamp?: string | number
  createdAt?: string
  created_at?: string
}

export interface TaskStep {
  index?: number
  description: string
  rewardPercentageBPS?: number
  percentageBPS?: number
  isCompleted?: boolean
  isVerified?: boolean
  qualityScore?: number
}

export interface Task {
  id: string
  taskId?: string
  task_id?: string
  poster?: string
  employer?: string
  title: string
  description?: string
  category: string
  phase?: string
  status?: string
  reward?: string
  budget?: string
  max_budget?: string
  baseReward?: string
  base_reward?: string
  bonusPool?: string
  deadline?: number
  totalSteps?: number
  totalChunks?: number
  total_chunks?: number
  chunks?: string | number
  chunkDescriptions?: string[]
  steps?: TaskStep[]
  assignedAgentId?: string
  worker_agent?: string
  agent?: string
  repo?: string
  awarded_price?: string
  paymentModel?: string
  payment_model?: string
  bids?: number
  createdAt?: string
}

export interface Agent {
  agentId: string
  agent_id?: string
  walletAddress: string
  wallet_address?: string
  category: string
  status: string
  reputation?: number
  reputationScore?: number
  reputationPercent?: string
  tasksCompleted?: number
  tasks_completed?: number
  tasksFailed?: number
  tasks_failed?: number
  currentStreak?: number
  current_streak?: number
  bestStreak?: number
  avgQualityScore?: number
  avg_quality?: number
  totalEarned?: string
  total_earned?: string
  stakedAmount?: string
  registrationTime?: number
  isVerified?: boolean
  skills?: string[]
  registered?: boolean
}

export interface Bid {
  id?: number
  taskId?: string
  agentId?: string
  agentAddress: string
  amount: string
  estimatedHours?: number
  agentReputation?: string
  timestamp?: number
  onChain?: boolean
  txHash?: string
  isAwarded?: boolean
}

export type ProblemDomain = 'SOFTWARE' | 'MATHEMATICS' | 'DATA' | 'AI_ML' | 'RESEARCH' | 'BIOMEDICAL' | 'CLIMATE' | 'ENGINEERING' | 'POLICY' | 'OTHER'
export type ProblemRiskTier = 'LOW' | 'MODERATE' | 'HIGH' | 'RESTRICTED'
export type ProblemStatus = 'DRAFT' | 'OPEN' | 'ACTIVE' | 'REVIEW' | 'COMPLETED' | 'CANCELLED' | 'QUARANTINED'
export type FundingMechanism = 'GRANT' | 'MILESTONE' | 'PRIZE' | 'REPLICATION_BOUNTY' | 'RETROACTIVE'
export type VerificationMode = 'CODE' | 'FORMAL_PROOF' | 'REPRODUCIBLE_RESEARCH' | 'EXPERT_PANEL' | 'HYBRID'

export interface ProblemSpec {
  version: '1.0'
  slug?: string
  title: string
  summary: string
  description: string
  domain: ProblemDomain
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE'
  riskTier: ProblemRiskTier
  tags: string[]
  license: string
  funding: { amount?: string; token?: string; mechanisms: FundingMechanism[] }
  verificationPolicy: {
    mode: VerificationMode
    minimumIndependentReviews: number
    replicationRequired: boolean
    minimumReplications: number
    artifactRequirements: string[]
    acceptanceCriteria: string[]
  }
  governance: JsonObject
  ethics: JsonObject
  metadata: JsonObject
}

export interface Problem extends ProblemSpec {
  id: string
  status: ProblemStatus
  funderId: string
  funderType: string
  contentDigest: string
  createdAt: string
  updatedAt: string
}

export interface FundingPool {
  id: string
  committed_amount: string
  token: string
  mechanism: FundingMechanism
  status: string
}

export interface Workstream {
  id: string
  title: string
  status: string
}

export interface Contribution {
  id: string
  title: string
  status: string
  artifact_type: string
}

export interface EvidenceRecord {
  id: string
  evidence_type: string
  uri: string
}

export interface ReviewRecord {
  id: string
  verdict: string
  score?: number | null
}

export interface CreditRecord {
  contribution_id: string
  contributor_id: string
  role: string
  share_bps: number | string
}

export interface ProblemGraphData {
  workstreams: Workstream[]
  dependencies: JsonObject[]
  contributions: Contribution[]
  evidence: EvidenceRecord[]
  reviews: ReviewRecord[]
  credits: CreditRecord[]
  fundingPools: FundingPool[]
}

export interface ProblemGraphResponse {
  problem: Problem
  graph: ProblemGraphData
  counts: Record<'workstreams' | 'contributions' | 'evidence' | 'reviews' | 'credits', number>
}

export interface ProblemListResponse {
  problems: Problem[]
  hasMore: boolean
  nextCursor: string | null
}

export interface MutationResult {
  success?: boolean
  message?: string
  txHash?: string
  agentId?: string
  error?: string
  contribution?: Contribution
}

export interface Notice {
  type: 'success' | 'error' | 'info'
  message: string
}

export interface DisputeRecord {
  id: string
  task_id?: string
  taskId?: string
  chain_dispute_id?: string
  chainDisputeId?: string
  status: string
  reason?: string
  opened_by?: string
  created_at?: string
  arbiters?: string[]
  resolution?: string
  evidence?: JsonObject[]
  votes?: Array<JsonObject & { vote?: string; voter?: string; arbiter?: string }>
  eligibleArbiters?: string[]
}

export type ApiRecord = Record<string, unknown>
