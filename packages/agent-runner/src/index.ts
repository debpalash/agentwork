#!/usr/bin/env node
/**
 * @aiwork/agent-runner — Autonomous Agent Daemon
 *
 * Runs a continuous loop that:
 *  1. Polls the task queue for matching open tasks
 *  2. Evaluates task fit against the agent's skill profile
 *  3. Auto-bids on matching tasks within budget constraints
 *  4. Monitors awarded tasks
 *  5. Dispatches work to the execute() handler (user-provided)
 *  6. Auto-submits deliverables
 *
 * Usage:
 *   bun run src/index.ts --key 0x... --skills typescript,react --max-bid 1000
 *
 * Or programmatically:
 *   import { AgentRunner } from '@aiwork/agent-runner'
 *   const runner = new AgentRunner({ ... })
 *   runner.start()
 */

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { AgentRunner, type AgentRunnerConfig } from './runner';

dotenv.config();

const program = new Command();

program
  .name('aiwork-daemon')
  .description('AIWork Autonomous Agent Daemon — earn crypto by completing tasks')
  .version('1.0.0')
  .requiredOption('--key <privateKey>', 'Agent wallet private key (or set AGENT_PRIVATE_KEY env)')
  .option('--api <url>', 'API base URL', process.env.API_BASE || 'http://localhost:3001/api/v1')
  .option('--api-key <key>', 'API key', process.env.AIWORK_API_KEY || 'aiwork-dev-key-001')
  .option('--skills <skills>', 'Comma-separated skill tags', 'general')
  .option('--categories <cats>', 'Comma-separated categories to target', 'CODE,DATA,NLP')
  .option('--max-bid <amount>', 'Maximum bid amount per task', '1000')
  .option('--min-reward <amount>', 'Minimum task reward to consider', '50')
  .option('--interval <seconds>', 'Polling interval in seconds', '30')
  .option('--strategy <type>', 'Bidding strategy: conservative, balanced, aggressive', 'balanced')
  .option('--dry-run', 'Simulate without submitting real bids', false)
  .action(async (options) => {
    const config: AgentRunnerConfig = {
      privateKey: options.key || process.env.AGENT_PRIVATE_KEY || '',
      apiBase: options.api,
      apiKey: options.apiKey,
      skills: options.skills.split(',').map((s: string) => s.trim()),
      categories: options.categories.split(',').map((c: string) => c.trim()),
      maxBidAmount: Number(options.maxBid),
      minReward: Number(options.minReward),
      pollIntervalMs: Number(options.interval) * 1000,
      strategy: options.strategy as 'conservative' | 'balanced' | 'aggressive',
      dryRun: options.dryRun,
    };

    if (!config.privateKey) {
      console.error('[FATAL] --key or AGENT_PRIVATE_KEY required.');
      process.exit(1);
    }

    const runner = new AgentRunner(config);
    await runner.start();
  });

program.parse(process.argv);

export { AgentRunner } from './runner';
export type { AgentRunnerConfig } from './runner';
