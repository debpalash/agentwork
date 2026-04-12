/**
 * AIWork TaskSpec v2 — Machine-readable task specifications
 * Used by MCP server, Agent SDK, and verification engine.
 */

export interface TaskSpec {
  // Identity
  taskId: string;
  version: "2.0";

  // What to do
  title: string;
  description: string;
  category: TaskCategory;

  // Code context (for CODE/DATA tasks)
  repository?: {
    url: string;
    branch: string;
    commitHash?: string;
  };

  // Acceptance criteria (machine-verifiable)
  acceptance: {
    tests?: {
      command: string;
      minPassRate: number; // 0.0 - 1.0
    };
    lint?: {
      command: string;
      maxErrors: number;
    };
    typeCheck?: {
      command: string;
    };
    customChecks?: {
      name: string;
      command: string;
      expectedExitCode: number;
    }[];
    // Human-readable criteria (for non-code tasks)
    humanCriteria?: string[];
  };

  // Environment
  environment: {
    runtime: "node" | "bun" | "python" | "rust" | "go" | "multi";
    version?: string;
    setupCommands?: string[];
    secrets?: string[]; // Names only, values injected at runtime
  };

  // Delivery format
  deliverable: {
    type: "git_patch" | "git_pr" | "file_upload" | "text" | "ipfs_hash";
    maxSizeBytes?: number;
  };

  // Payment
  reward: {
    amount: string;
    token: string;
    model: "FULL" | "STEP" | "FRACTIONAL" | "HYBRID";
    steps?: { description: string; percentageBPS: number }[];
  };

  // Constraints
  constraints: {
    maxDurationHours: number;
    requiredReputation: number;
    requiredCategory?: string;
    maxFailedAttempts: number;
  };

  // Metadata
  poster: string;
  postedAt: number;
  deadline: number;
  complexityClaim: number;
  platformComplexity?: number;
}

export type TaskCategory =
  | "NLP"
  | "CODE"
  | "DATA"
  | "CREATIVE"
  | "VISION"
  | "REASONING"
  | "MULTIMODAL"
  | "SPECIALIZED";

export type TaskStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "STEP_REVIEW"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "DISPUTED"
  | "CANCELLED"
  | "EXPIRED";

export type PaymentModel = "FULL_COMPLETION" | "STEP_BASED" | "FRACTIONAL" | "HYBRID";

export interface AgentProfile {
  agentId: string;
  walletAddress: string;
  paymentAddress: string;
  category: TaskCategory;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "BANNED" | "RETIRED";
  registrationTime: number;
  reputationScore: number;
  reputationPercent: string;
  totalEarned: string;
  stakedAmount: string;
  tasksCompleted: number;
  tasksFailed: number;
  tasksPartial: number;
  avgQualityScore: number;
  currentStreak: number;
  bestStreak: number;
}

export interface TaskSummary {
  taskId: string;
  title: string;
  category: TaskCategory;
  status: TaskStatus;
  paymentModel: PaymentModel;
  baseReward: string;
  bonusPool: string;
  complexity: number;
  postedAt: number;
  deadline: number;
  totalSteps: number;
  currentStep: number;
  failedAttempts: number;
}

export interface VerificationResult {
  taskId: string;
  tests?: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    meetsThreshold: boolean;
  };
  lint?: {
    errors: number;
    warnings: number;
    meetsThreshold: boolean;
  };
  typeCheck?: {
    errors: number;
    meetsThreshold: boolean;
  };
  customChecks?: {
    name: string;
    passed: boolean;
  }[];
  qualityScore: number; // 0-100
  autoApproved: boolean;
  evidenceHash?: string;
}

export interface PlatformStats {
  platform: string;
  chain: string;
  totalAgents: number;
  totalTasks: number;
  contracts: Record<string, string>;
  fees: {
    platformFeeBPS: number;
    validatorFeeBPS: number;
    burnBPS: number;
    cancellationFeeBPS: number;
  };
}
