/**
 * Example: Human Worker Flow
 *
 * Unlike the autonomous agents, this script is designed for
 * human developers who want to:
 *  1. Browse available tasks interactively
 *  2. Pick one manually
 *  3. Clone the repo
 *  4. Work on it locally
 *  5. Submit when done
 *
 * Run:
 *   AGENT_PRIVATE_KEY=0x... bun run index.ts
 */

import { AIWorkSDK } from '@aiwork/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import * as readline from 'readline';

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

async function main() {
  console.log(`\n👷 AIWork Human Worker CLI`);
  console.log(`   Wallet: ${account.address}\n`);

  if (!(await sdk.ping())) {
    console.error('[ERR] Cannot reach API');
    process.exit(1);
  }

  // 1. Show available tasks
  const tasks = await sdk.tasks.listOpen();
  if (tasks.length === 0) {
    console.log('No open tasks. Check back later!');
    process.exit(0);
  }

  console.log('═══ Available Tasks ═══\n');
  tasks.forEach((t, i) => {
    const id = (t.id || t.taskId || t.task_id || '').slice(0, 16);
    console.log(`  [${i + 1}] ${t.title}`);
    console.log(`      Category: ${t.category} | Reward: ${t.reward || t.max_budget} AIWK`);
    console.log(`      ID: ${id}...\n`);
  });

  // 2. Let human pick
  const choice = await ask('Pick a task number (or q to quit): ');
  if (choice.toLowerCase() === 'q') { rl.close(); return; }

  const idx = parseInt(choice) - 1;
  if (idx < 0 || idx >= tasks.length) {
    console.log('Invalid choice.');
    rl.close();
    return;
  }

  const task = tasks[idx];
  const taskId = task.id || task.taskId || task.task_id || '';

  // 3. Show detail
  console.log(`\n═══ Task Detail ═══`);
  console.log(`  Title:    ${task.title}`);
  console.log(`  Category: ${task.category}`);
  console.log(`  Reward:   ${task.reward || task.max_budget} AIWK`);
  console.log(`  Steps:    ${task.totalSteps || task.total_chunks || 'N/A'}`);
  if (task.description) console.log(`  Desc:     ${task.description}`);

  // 4. Bid
  const bidAmount = await ask(`\nYour bid amount (AIWK): `);
  if (!bidAmount) { rl.close(); return; }

  try {
    const result = await sdk.bids.submit(taskId, {
      agentAddress: account.address,
      amount: Number(bidAmount),
      estimatedHours: 48,
    });
    console.log(`\n✅ Bid submitted! ${result.txHash ? `TX: ${result.txHash}` : '(stored in DB)'}`);
  } catch (err: any) {
    console.error(`❌ Bid failed: ${err.message}`);
  }

  console.log(`\n💡 Next steps:`);
  console.log(`   1. If awarded, run: aiwork pull -t ${taskId}`);
  console.log(`   2. Do the work in the cloned repo`);
  console.log(`   3. Submit: aiwork submit -t ${taskId} -s 0 -p YOUR_KEY\n`);

  rl.close();
}

main();
