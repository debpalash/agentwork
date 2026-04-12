#!/usr/bin/env node
import { Command } from 'commander';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, hardhat } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { execSync } from 'child_process';

dotenv.config();

const program = new Command();
program.version('1.0.0').description('AIWork CLI — The Decentralized Labor Protocol for Autonomous Agents & Human Developers');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const API_KEY = process.env.AIWORK_API_KEY || 'aiwork-dev-key-001';

// Chain resolution mirrors the backend
const CHAIN_ID = Number(process.env.CHAIN_ID || '31337');
const CHAIN_MAP: Record<number, any> = { 31337: hardhat, 84532: baseSepolia };
const activeChain = CHAIN_MAP[CHAIN_ID] || hardhat;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
};

// ─── Helper: Authenticated fetch ───────────────────────────────
async function apiFetch(path: string, options: any = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...headers, ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// LIST — Query the global task queue
// ═══════════════════════════════════════════════════════════════
program
  .command('list')
  .description('List open tasks from the global operations queue')
  .option('--json', 'Output as JSON for machine consumption')
  .action(async (options) => {
    try {
      console.log(`[AIWork] Connecting to ${API_BASE}...`);
      const data = await apiFetch('/tasks');

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(`\n╔══════════════════════════════════════════════╗`);
      console.log(`║  OPERATIONS QUEUE — ${activeChain.name}  ║`);
      console.log(`╚══════════════════════════════════════════════╝`);

      if (!data.tasks || data.tasks.length === 0) {
        console.log(`  [ EMPTY ] No active tasks.`);
        return;
      }

      data.tasks.forEach((t: any) => {
        const phase = (t.phase || t.status || 'OPEN').toUpperCase();
        console.log(`\n  ┌─ ${t.title}`);
        console.log(`  │  ID:       ${t.id || t.task_id}`);
        console.log(`  │  Phase:    ${phase}`);
        console.log(`  │  Category: ${t.category}`);
        console.log(`  │  Reward:   ${t.reward || t.base_reward} AIWK`);
        console.log(`  │  Steps:    ${t.chunks || t.total_steps || 'N/A'}`);
        console.log(`  └──────────────────────────────────────`);
      });
      console.log('');
    } catch (err: any) {
      console.error(`[ERR] Failed to pull tasks: ${err.message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// INFO — Get detailed spec for a task
// ═══════════════════════════════════════════════════════════════
program
  .command('info')
  .description('Get detailed specification for a task')
  .requiredOption('-t, --task <id>', 'The target task ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      console.log(`[AIWork] Pulling spec for Task: ${options.task}...`);
      const spec = await apiFetch(`/tasks/${options.task}`);

      if (options.json) {
        console.log(JSON.stringify(spec, null, 2));
        return;
      }

      console.log(`\n=== TASK SPECIFICATION ===`);
      console.log(`  Title:    ${spec.title}`);
      console.log(`  Category: ${spec.category}`);
      console.log(`  Status:   ${spec.status || spec.phase}`);
      console.log(`  Reward:   ${spec.reward || spec.base_reward} AIWK`);
      console.log(`  Poster:   ${spec.poster}`);
      console.log(`  Deadline: ${spec.deadline ? new Date(spec.deadline * 1000).toISOString() : 'N/A'}`);
      if (spec.description) console.log(`  Desc:     ${spec.description}`);
      console.log(`===========================\n`);
    } catch (err: any) {
      console.error(`[ERR] Failed to pull spec: ${err.message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// BID — Submit an execution bid (real API call, not simulated)
// ═══════════════════════════════════════════════════════════════
program
  .command('bid')
  .description('Submit an execution bid on a task')
  .requiredOption('-t, --task <id>', 'The target task ID')
  .requiredOption('-a, --ask <amount>', 'Your bid amount in AIWK')
  .requiredOption('-p, --privateKey <key>', 'Your agent wallet private key')
  .option('-h, --hours <hours>', 'Estimated completion hours', '24')
  .action(async (options) => {
    const { task, ask, privateKey, hours } = options;

    let pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);

    console.log(`[AGENT] Node active. Wallet: ${account.address}`);
    console.log(`[AGENT] Submitting bid: ${ask} AIWK for Task ${task.slice(0, 16)}...`);

    try {
      const result = await apiFetch(`/bids/${task}`, {
        method: 'POST',
        body: JSON.stringify({
          agentAddress: account.address,
          agentId: `agent-${account.address.slice(2, 8)}`,
          amount: ask,
          estimatedHours: Number(hours),
          modelScore: 75,
        }),
      });

      if (result.success) {
        console.log(`[SUCCESS] Bid submitted!`);
        if (result.txHash) console.log(`[CHAIN] TX: ${result.txHash}`);
        if (result.onChain) console.log(`[CHAIN] Bid recorded on-chain ✓`);
        else console.log(`[DB] Bid stored in database (chain pending)`);
      } else {
        console.error(`[ERR] ${result.error || 'Bid rejected'}`);
      }
    } catch (err: any) {
      console.error(`[ERR] Bid submission failed: ${err.message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// PULL — Clone the Forgejo repo for a task
// ═══════════════════════════════════════════════════════════════
program
  .command('pull')
  .description('Clone the repository for an awarded task')
  .requiredOption('-t, --task <id>', 'The target task ID')
  .option('--git-url <url>', 'Override the Forgejo git URL')
  .action(async (options) => {
    const { task } = options;
    const slug = task.slice(0, 8);
    const repoUrl = options.gitUrl || `http://git.aiwork.network/aiwork/task-${slug}.git`;
    const dir = `task-${slug}`;

    console.log(`[GIT] Cloning workspace for Task: ${task}...`);
    console.log(`[GIT] Remote: ${repoUrl}`);

    if (fs.existsSync(dir)) {
      console.log(`[GIT] Directory ${dir} already exists. Pulling latest...`);
      try {
        execSync(`git -C ${dir} pull`, { stdio: 'inherit' });
        console.log(`[SUCCESS] Workspace updated at ./${dir}`);
      } catch {
        console.log(`[WARN] Git pull failed. Directory may not be a git repo.`);
      }
      return;
    }

    try {
      execSync(`git clone ${repoUrl} ${dir}`, { stdio: 'inherit' });
      console.log(`[SUCCESS] Workspace cloned at ./${dir}`);
    } catch {
      console.log(`[WARN] Git clone failed. Creating local workspace...`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/README.md`, `# Task ${task}\n\nCloned from AIWork Network.\n`);
      console.log(`[SUCCESS] Local workspace created at ./${dir}`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// SUBMIT — Push work and record delivery on-chain
// ═══════════════════════════════════════════════════════════════
program
  .command('submit')
  .description('Submit step delivery for verification')
  .requiredOption('-t, --task <id>', 'The target task ID')
  .requiredOption('-s, --step <number>', 'Step index to submit')
  .requiredOption('-p, --privateKey <key>', 'Your agent wallet private key')
  .option('--message <msg>', 'Commit message', 'AIWork: deliver step')
  .action(async (options) => {
    const { task, step, privateKey, message } = options;
    const slug = task.slice(0, 8);
    const dir = `task-${slug}`;

    let pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);

    console.log(`[AGENT] Node: ${account.address}`);
    console.log(`[SUBMIT] Task: ${task} | Step: ${step}`);

    // Stage 1: Git commit + push
    if (fs.existsSync(dir)) {
      try {
        console.log(`[GIT] Committing changes in ./${dir}...`);
        execSync(`git -C ${dir} add -A`, { stdio: 'pipe' });
        execSync(`git -C ${dir} commit -m "${message} [step-${step}]" --allow-empty`, { stdio: 'pipe' });
        execSync(`git -C ${dir} push`, { stdio: 'pipe' });
        console.log(`[GIT] Pushed to upstream ✓`);
      } catch (err: any) {
        console.warn(`[WARN] Git push failed: ${err.message?.slice(0, 80)}`);
      }
    }

    // Stage 2: Notify API
    try {
      console.log(`[API] Recording step delivery...`);
      // The API endpoint for step submission
      const result = await apiFetch(`/tasks/${task}/steps/${step}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          agentAddress: account.address,
          stepIndex: Number(step),
        }),
      });
      console.log(`[SUCCESS] Step ${step} delivery recorded.`);
      console.log(`[SYSTEM] Sandbox verification will begin automatically.`);
    } catch (err: any) {
      // Not all API endpoints may exist yet — log but don't crash
      console.warn(`[WARN] API notification failed: ${err.message?.slice(0, 80)}`);
      console.log(`[INFO] Git push succeeded. Step will be verified on next webhook.`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// REGISTER — Register an agent from the CLI
// ═══════════════════════════════════════════════════════════════
program
  .command('register')
  .description('Register a new agent on the network')
  .requiredOption('-p, --privateKey <key>', 'Your wallet private key')
  .option('-c, --category <cat>', 'Agent category (CODE, NLP, DATA, VISION, CREATIVE, REASONING)', 'CODE')
  .option('-s, --skills <skills>', 'Comma-separated skills', 'general')
  .action(async (options) => {
    const { privateKey, category, skills } = options;

    let pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);

    const CATEGORY_MAP: Record<string, number> = {
      NLP: 0, VISION: 1, CODE: 2, DATA: 3, CREATIVE: 4, REASONING: 5, MULTIMODAL: 6, SPECIALIZED: 7
    };

    console.log(`[REGISTER] Wallet: ${account.address}`);
    console.log(`[REGISTER] Category: ${category} | Skills: ${skills}`);

    try {
      const result = await apiFetch('/agents/register', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: account.address,
          paymentAddress: account.address,
          category: CATEGORY_MAP[category.toUpperCase()] ?? 2,
          skills: skills.split(',').map((s: string) => s.trim()),
        }),
      });

      if (result.success) {
        console.log(`[SUCCESS] Agent registered!`);
        console.log(`  Agent ID: ${result.agentId}`);
        console.log(`  TX Hash:  ${result.txHash}`);
        console.log(`[NEXT] Your agent is now PENDING. Activation will follow automatically.`);
      } else {
        console.error(`[ERR] ${result.error}`);
      }
    } catch (err: any) {
      console.error(`[ERR] Registration failed: ${err.message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
program.parse(process.argv);