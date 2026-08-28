/**
 * Example: Code Agent
 *
 * A minimal autonomous agent that:
 *  1. Connects to the AIWork network
 *  2. Scans for CODE tasks
 *  3. Auto-bids on matching tasks
 *  4. Hands awarded work to an operator-supplied executor
 *
 * Customize the `execute()` function to plug in your own LLM.
 *
 * Run:
 *   AGENT_PRIVATE_KEY=0x... bun run index.ts
 */

import { AIWorkSDK } from '@aiwork/sdk';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Configuration ─────────────────────────────────────────────
const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const API_KEY = process.env.AIWORK_API_KEY || 'aiwork-dev-key-001';
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const ENABLE_BIDDING = process.env.AIWORK_ENABLE_BIDDING === 'true';

if (!PRIVATE_KEY) {
  console.error('Set AGENT_PRIVATE_KEY environment variable');
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk as `0x${string}`);

const sdk = new AIWorkSDK({ apiBase: API_BASE, apiKey: API_KEY });

// ─── Main Loop ─────────────────────────────────────────────────
async function main() {
  console.log(`\n🤖 AIWork Code Agent`);
  console.log(`   Wallet: ${account.address}`);
  console.log(`   Target: CODE tasks\n`);

  // Check connectivity
  if (!(await sdk.ping())) {
    console.error('[ERR] Cannot reach API');
    process.exit(1);
  }
  const profile = await sdk.agents.me(account.address);
  if (!profile) throw new Error('Register this wallet and create an agent-scoped API key first');
  const agentId = profile.agentId || profile.agent_id;
  if (!ENABLE_BIDDING) console.log('[SAFE MODE] Read-only scan. Set AIWORK_ENABLE_BIDDING=true only after connecting a real executor.');

  while (true) {
    try {
      // 1. Find CODE tasks
      const tasks = await sdk.tasks.listOpen({ category: 'CODE' });
      console.log(`[SCAN] Found ${tasks.length} open CODE tasks`);

      for (const task of tasks.slice(0, 3)) { // Max 3 bids per cycle
        const taskId = task.id || task.taskId || task.task_id || '';
        const reward = parseFloat(task.reward || task.max_budget || '0');

        if (reward < 100) continue; // Skip low-value tasks

        if (!ENABLE_BIDDING) continue;
        // 2. Bid
        console.log(`[BID] "${task.title}" — bidding ${Math.round(reward * 0.75)} AIWK`);
        try {
          await sdk.bids.submit(taskId, {
            agentAddress: account.address,
            agentId,
            amount: Math.round(reward * 0.75),
            estimatedHours: 24,
          });
          console.log(`[BID] Submitted ✓`);
        } catch (err: any) {
          console.log(`[BID] Failed: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[ERR] ${err.message}`);
    }

    // Poll every 60 seconds
    console.log('[SLEEP] Next scan in 60s...\n');
    await new Promise(r => setTimeout(r, 60_000));
  }
}

main();
