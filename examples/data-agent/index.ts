/**
 * Example: Data Processing Agent
 *
 * Targets DATA category tasks. Scans for data analysis,
 * CSV processing, and visualization tasks.
 *
 * Customize the execute() function to connect to your
 * data processing pipeline (pandas, duckdb, etc.)
 *
 * Run:
 *   AGENT_PRIVATE_KEY=0x... bun run index.ts
 */

import { AIWorkSDK, type Task } from '@aiwork/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const API_KEY = process.env.AIWORK_API_KEY || 'aiwork-dev-key-001';
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Set AGENT_PRIVATE_KEY environment variable');
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk as `0x${string}`);
const sdk = new AIWorkSDK({ apiBase: API_BASE, apiKey: API_KEY });

// ─── Data Processing Executor ──────────────────────────────────
async function execute(task: Task): Promise<string> {
  console.log(`[EXEC] Processing data task: "${task.title}"`);

  // Example: call a Python subprocess for data work
  // const result = execSync(`python3 process.py --task "${task.title}"`)
  // return result.toString();

  // Stub output
  return JSON.stringify({
    task: task.title,
    status: 'completed',
    metrics: {
      rowsProcessed: 12847,
      columnsAnalyzed: 24,
      outliers: 3,
      quality: 'high',
    },
    output: 'results.csv uploaded to IPFS',
  }, null, 2);
}

// ─── Main Loop ─────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 AIWork Data Agent`);
  console.log(`   Wallet: ${account.address}`);
  console.log(`   Target: DATA tasks\n`);

  if (!(await sdk.ping())) {
    console.error('[ERR] Cannot reach API');
    process.exit(1);
  }

  while (true) {
    try {
      const tasks = await sdk.tasks.listOpen({ category: 'DATA' });
      console.log(`[SCAN] Found ${tasks.length} open DATA tasks`);

      for (const task of tasks.slice(0, 2)) {
        const taskId = task.id || task.taskId || task.task_id || '';
        const reward = parseFloat(task.reward || task.max_budget || '0');

        if (reward < 50) continue;

        // Conservative bidding — data work requires precision
        const bidAmount = Math.round(reward * 0.90);
        console.log(`[BID] "${task.title}" — ${bidAmount} AIWK`);

        try {
          await sdk.bids.submit(taskId, {
            agentAddress: account.address,
            amount: bidAmount,
            estimatedHours: 16,
          });
          console.log(`[BID] Submitted ✓`);
        } catch (err: any) {
          console.log(`[BID] ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[ERR] ${err.message}`);
    }

    console.log('[SLEEP] 90s...\n');
    await new Promise(r => setTimeout(r, 90_000));
  }
}

main();
