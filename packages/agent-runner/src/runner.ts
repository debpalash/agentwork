/**
 * @aiwork/agent-runner — Core Runner Engine
 *
 * Lifecycle:
 *   BOOT → POLL → EVALUATE → BID → MONITOR → EXECUTE → SUBMIT → repeat
 */

import { CollagentSDK, type Task } from '@aiwork/sdk';
import { privateKeyToAccount } from 'viem/accounts';

export interface AgentRunnerConfig {
  privateKey: string;
  apiBase: string;
  apiKey?: string;
  skills: string[];
  categories: string[];
  maxBidAmount: number;
  minReward: number;
  pollIntervalMs: number;
  strategy: 'conservative' | 'balanced' | 'aggressive';
  dryRun: boolean;
  /** Optional custom executor — receives a task and returns a deliverable string */
  executor?: (task: Task) => Promise<string>;
}

// Strategy multipliers for bid pricing
const STRATEGY_MULTIPLIER: Record<string, number> = {
  conservative: 0.95,  // Bid 95% of budget (leave margin)
  balanced: 0.80,      // Bid 80% of budget
  aggressive: 0.60,    // Bid 60% — undercut competition
};

export class AgentRunner {
  private sdk: CollagentSDK;
  private config: AgentRunnerConfig;
  private walletAddress: string;
  private agentId: string | null = null;
  private running = false;
  private bidHistory = new Set<string>(); // Task IDs we've already bid on
  private assignedTasks = new Set<string>(); // Task IDs awarded to us
  private lastNotificationCheck: string | undefined;
  private stats = { polls: 0, bids: 0, wins: 0, errors: 0 };

  constructor(config: AgentRunnerConfig) {
    this.config = config;
    const pk = config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);
    this.walletAddress = account.address;

    this.sdk = new CollagentSDK({
      apiBase: config.apiBase,
      apiKey: config.apiKey,
    });
  }

  async start() {
    if (!this.config.dryRun && !this.config.executor) {
      throw new Error("A real executor is required unless --dry-run is enabled");
    }
    this.running = true;
    this.printBanner();

    // Check API connectivity
    const alive = await this.sdk.ping();
    if (!alive) {
      console.error('[FATAL] Cannot reach API at ' + this.config.apiBase);
      process.exit(1);
    }
    console.log('[SYS] API connected ✓');

    // Check agent registration
    const agent = await this.sdk.agents.me(this.walletAddress);
    if (agent) {
      this.agentId = agent.agentId || agent.agent_id || null;
      console.log(`[AGENT] Registered as ${this.agentId} | Status: ${agent.status}`);
      console.log(`[AGENT] Reputation: ${agent.reputationPercent || agent.reputation} | Completed: ${agent.tasksCompleted || agent.tasks_completed}`);
    } else {
      console.log('[AGENT] Not registered. Auto-registering...');
      if (!this.config.dryRun) {
        try {
          const catMap: Record<string, number> = { CODE: 2, NLP: 0, DATA: 3, VISION: 1, CREATIVE: 4, REASONING: 5 };
          const catNum = catMap[this.config.categories[0]] ?? 2;
          const result = await this.sdk.agents.register({
            walletAddress: this.walletAddress,
            category: catNum,
            skills: this.config.skills,
          });
          this.agentId = result.agentId || null;
          console.log(`[AGENT] Registered! ID: ${this.agentId}`);
        } catch (err: any) {
          console.warn(`[WARN] Registration failed: ${err.message}`);
        }
      }
    }

    if (!this.config.dryRun && (!this.agentId || agent?.status !== 'ACTIVE')) {
      throw new Error('Live mode requires an ACTIVE registered agent and an agent-scoped API key');
    }

    console.log(`[DAEMON] Starting autonomous loop (every ${this.config.pollIntervalMs / 1000}s)...\n`);

    // Main loop
    while (this.running) {
      try {
        await this.cycle();
      } catch (err: any) {
        this.stats.errors++;
        console.error(`[ERR] Cycle failed: ${err.message}`);
      }
      await this.sleep(this.config.pollIntervalMs);
    }
  }

  stop() {
    this.running = false;
    console.log('\n[SYS] Daemon stopped.');
    this.printStats();
  }

  // ─── Single Cycle ─────────────────────────────────────────────
  private async cycle() {
    this.stats.polls++;
    const prefix = `[POLL #${this.stats.polls}]`;

    // Phase 1: Check notifications for awarded tasks
    if (this.agentId) {
      await this.checkNotifications();
    }

    // Phase 2: Execute any assigned tasks
    await this.executeAssignedTasks();

    // Phase 3: Fetch and bid on open tasks
    const tasks = await this.sdk.tasks.listOpen();
    const eligible = tasks.filter(t => this.isEligible(t));

    if (eligible.length === 0) {
      console.log(`${prefix} ${tasks.length} tasks scanned — 0 eligible. Sleeping...`);
      return;
    }

    console.log(`${prefix} ${tasks.length} tasks scanned — ${eligible.length} eligible:`);

    for (const task of eligible) {
      const taskId = task.id || task.taskId || task.task_id || '';
      if (this.bidHistory.has(taskId)) continue;

      const bidAmount = this.calculateBid(task);
      console.log(`  ├─ "${task.title}" | Reward: ${task.reward || task.max_budget} | Our bid: ${bidAmount}`);

      if (this.config.dryRun) {
        console.log(`  │  [DRY RUN] Would bid ${bidAmount} AIWK`);
        this.bidHistory.add(taskId);
        continue;
      }

      try {
        await this.sdk.bids.submit(taskId, {
          agentAddress: this.walletAddress,
          agentId: this.agentId!,
          amount: bidAmount,
          estimatedHours: this.estimateHours(task),
        });
        this.bidHistory.add(taskId);
        this.stats.bids++;
        console.log(`  │  [BID] Submitted ✓`);
      } catch (err: any) {
        console.log(`  │  [ERR] Bid failed: ${err.message}`);
        this.stats.errors++;
      }
    }
    console.log(`  └─ Cycle complete. Total bids: ${this.stats.bids}\n`);
  }

  // ─── Check Notifications (awarded tasks, payments) ────────────
  private async checkNotifications() {
    try {
      const data = await this.sdk.agents.notifications(this.agentId!, this.lastNotificationCheck);
      this.lastNotificationCheck = new Date().toISOString();

      for (const notif of data.notifications || []) {
        if (notif.action === 'TASK_AWARDED' && notif.taskId) {
          console.log(`[🏆 AWARDED] ${notif.message}`);
          this.assignedTasks.add(notif.taskId);
          this.stats.wins++;
        } else if (notif.action === 'PAYMENT_RELEASED') {
          console.log(`[💰 PAID] ${notif.message}`);
        } else {
          console.log(`[📬 NOTIF] ${notif.message}`);
        }
      }
    } catch (_) {
      // Notification endpoint may not be ready yet — ignore
    }
  }

  // ─── Execute Assigned Tasks ───────────────────────────────────
  private async executeAssignedTasks() {
    if (this.assignedTasks.size === 0) return;

    for (const taskId of this.assignedTasks) {
      console.log(`\n[EXEC] Working on task ${taskId.slice(0, 18)}...`);

      try {
        const task = await this.sdk.tasks.get(taskId);
        const totalChunks = task.totalSteps || task.total_chunks || task.totalChunks || 1;

        for (let i = 0; i < totalChunks; i++) {
          console.log(`  ├─ Chunk ${i}/${totalChunks}: processing...`);

          // Execute work
          let commitHash: string | undefined;
          if (this.config.executor) {
            commitHash = await this.config.executor(task);
            console.log(`  │  Executor returned: ${commitHash?.slice(0, 20) || 'done'}`);
          } else {
            console.log("  │  [DRY RUN] No executor invoked");
          }

          // Submit chunk
          if (!this.config.dryRun) {
            try {
              if (!commitHash || !/^[0-9a-f]{40}$/i.test(commitHash)) {
                throw new Error('Executor must push the work, finalize TaskManager.submitStep, and return its full 40-character Git commit SHA');
              }
              const result = await this.sdk.tasks.submit(taskId, {
                chunkIndex: i,
                agentId: this.agentId!,
                commitHash,
              });
              console.log(`  │  [SUBMIT] ${result.queued ? 'Queued for exact-commit verification' : 'Accepted'}`);
            } catch (err: any) {
              console.log(`  │  [ERR] Submit failed: ${err.message}`);
            }
          } else {
            console.log(`  │  [DRY RUN] Would submit chunk ${i}`);
          }
        }

        console.log(`  └─ Task execution complete.\n`);
        this.assignedTasks.delete(taskId);
      } catch (err: any) {
        console.error(`  └─ [ERR] Task execution failed: ${err.message}`);
        this.stats.errors++;
      }
    }
  }

  // ─── Evaluate if a task matches our profile ───────────────────
  private isEligible(task: Task): boolean {
    const phase = (task.phase || task.status || '').toLowerCase();
    if (phase !== 'open' && phase !== 'posted' && phase !== 'bidding') return false;

    // Category filter — GENERIC matches everything (chain often stores as GENERIC)
    const taskCat = (task.category || '').toUpperCase();
    if (taskCat !== 'GENERIC' && this.config.categories.length > 0 && !this.config.categories.includes(taskCat)) {
      return false;
    }

    // Reward filter
    const reward = parseFloat(task.reward || task.max_budget || task.base_reward || '0');
    if (reward < this.config.minReward) return false;
    if (reward > this.config.maxBidAmount * 2) return false; // Don't bid on tasks way above our range

    return true;
  }

  // ─── Calculate optimal bid based on strategy ──────────────────
  private calculateBid(task: Task): number {
    const reward = parseFloat(task.reward || task.max_budget || task.base_reward || '0');
    const multiplier = STRATEGY_MULTIPLIER[this.config.strategy] || 0.80;
    const bid = Math.round(reward * multiplier);
    return Math.min(bid, this.config.maxBidAmount);
  }

  // ─── Estimate hours based on task complexity ──────────────────
  private estimateHours(task: Task): number {
    const steps = task.totalSteps || task.total_chunks || 1;
    const base = steps * 8; // 8 hours per step baseline
    if (this.config.strategy === 'aggressive') return Math.round(base * 0.7);
    if (this.config.strategy === 'conservative') return Math.round(base * 1.3);
    return base;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private printStats() {
    console.log(`\n┌─── DAEMON STATS ───────────────────────┐`);
    console.log(`│  Polls:   ${this.stats.polls}`);
    console.log(`│  Bids:    ${this.stats.bids}`);
    console.log(`│  Wins:    ${this.stats.wins}`);
    console.log(`│  Errors:  ${this.stats.errors}`);
    console.log(`└────────────────────────────────────────┘`);
  }

  private printBanner() {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          Collagent Agent Daemon v1.0.0                    ║
╠═══════════════════════════════════════════════════════════╣
║  Wallet:     ${this.walletAddress.slice(0, 20)}...          ║
║  Skills:     ${this.config.skills.join(', ').slice(0, 32).padEnd(32)}    ║
║  Categories: ${this.config.categories.join(', ').slice(0, 32).padEnd(32)}    ║
║  Strategy:   ${this.config.strategy.padEnd(32)}    ║
║  Max Bid:    ${String(this.config.maxBidAmount).padEnd(32)} AIWK║
║  Mode:       ${(this.config.dryRun ? 'DRY RUN' : 'LIVE').padEnd(32)}    ║
╚═══════════════════════════════════════════════════════════╝
`);
  }
}
