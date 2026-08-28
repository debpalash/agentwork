#!/usr/bin/env node
import { Command } from 'commander';
import { createWalletClient, createPublicClient, http, parseAbi, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, hardhat } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'node:crypto';

dotenv.config();

const program = new Command();
program.name('collagent').version('1.0.0').description('Collagent CLI — coordinate and verify work across the open problem network');

const API_BASE = (process.env.COLLAGENT_API_URL || process.env.API_BASE || 'http://localhost:3001/api/v1').replace(/\/$/, '');
const API_KEY = process.env.COLLAGENT_API_KEY || process.env.AIWORK_API_KEY
  || (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(API_BASE) ? 'aiwork-dev-key-001' : undefined);
const FORGEJO_BASE = (process.env.FORGEJO_URL || 'http://localhost:3000').replace(/\/$/, '');
const FORGEJO_ORG = process.env.FORGEJO_ORG || 'aiwork';

// Chain resolution mirrors the backend
const CHAIN_ID = Number(process.env.CHAIN_ID || '31337');
const CHAIN_MAP: Record<number, any> = { 31337: hardhat, 84532: baseSepolia, 8453: base };
const activeChain = CHAIN_MAP[CHAIN_ID] || hardhat;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const TASK_MANAGER_ADDRESS = process.env.TASK_MANAGER_ADDRESS as `0x${string}` | undefined;
const TASK_MANAGER_ABI = parseAbi([
  'function submitStep(bytes32,uint256,bytes32)',
  'function verifyStep(bytes32,uint256,bool,uint256)',
]);
const publicClient = createPublicClient({ chain: activeChain, transport: http(RPC_URL) });

// ─── Helper: Authenticated fetch ───────────────────────────────
async function apiFetch(path: string, options: any = {}) {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (API_KEY && !requestHeaders['X-Wallet-Signature']) {
    requestHeaders.Authorization = `Bearer ${API_KEY}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: requestHeaders,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function walletAuthHeaders(method: string, path: string, body: string, account: ReturnType<typeof privateKeyToAccount>) {
  const pathname = new URL(`${API_BASE}${path}`).pathname;
  const message = [
    'AIWork request v2',
    `origin:${new URL(API_BASE).origin}`,
    `chainId:${CHAIN_ID}`,
    `method:${method.toUpperCase()}`,
    `path:${pathname}`,
    `bodySha256:${createHash('sha256').update(body).digest('hex')}`,
    `issuedAt:${new Date().toISOString()}`,
    `nonce:${crypto.randomUUID()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  return {
    'X-Wallet-Address': account.address,
    'X-Wallet-Message': Buffer.from(message, 'utf8').toString('base64url'),
    'X-Wallet-Signature': signature,
  };
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
      console.log(`[Collagent] Connecting to ${API_BASE}...`);
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
      console.log(`[Collagent] Pulling spec for Task: ${options.task}...`);
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
      const profile = await apiFetch(`/agents/wallet/${account.address}`);
      if (!profile?.registered || !profile.agentId) {
        throw new Error('This wallet is not a registered agent');
      }
      if (profile.status !== 'ACTIVE') {
        throw new Error(`Agent ${profile.agentId} is ${profile.status}; only ACTIVE agents may bid`);
      }
      const bidPath = `/bids/${task}`;
      const bidBody = JSON.stringify({
        agentAddress: account.address,
        agentId: profile.agentId,
        amount: ask,
        estimatedHours: Number(hours),
      });
      const result = await apiFetch(`/bids/${task}`, {
        method: 'POST',
        headers: await walletAuthHeaders('POST', bidPath, bidBody, account),
        body: bidBody,
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
    if (!/^0x[0-9a-f]{64}$/i.test(task)) throw new Error('task must be a bytes32 ID');
    const slug = task.slice(2, 14);
    const repoUrl = options.gitUrl || `${FORGEJO_BASE}/${FORGEJO_ORG}/task-${slug}.git`;
    const dir = `task-${slug}`;

    console.log(`[GIT] Cloning workspace for Task: ${task}...`);
    console.log(`[GIT] Remote: ${repoUrl}`);

    if (fs.existsSync(dir)) {
      console.log(`[GIT] Directory ${dir} already exists. Pulling latest...`);
      try {
        execFileSync('git', ['-C', dir, 'pull', '--ff-only'], { stdio: 'inherit' });
        console.log(`[SUCCESS] Workspace updated at ./${dir}`);
      } catch {
        console.log(`[WARN] Git pull failed. Directory may not be a git repo.`);
      }
      return;
    }

    try {
      execFileSync('git', ['clone', '--', repoUrl, dir], { stdio: 'inherit' });
      console.log(`[SUCCESS] Workspace cloned at ./${dir}`);
    } catch (err: any) {
      console.error(`[ERR] Git clone failed: ${err.message}`);
      process.exit(1);
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
  .option('--message <msg>', 'Commit message', 'Collagent: deliver step')
  .action(async (options) => {
    const { task, step, privateKey, message } = options;
    if (!/^0x[0-9a-f]{64}$/i.test(task)) throw new Error('task must be a bytes32 ID');
    if (!TASK_MANAGER_ADDRESS) throw new Error('TASK_MANAGER_ADDRESS is required');
    const stepIndex = Number(step);
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error('step must be a non-negative integer');
    const slug = task.slice(2, 14);
    const dir = `task-${slug}`;

    let pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(pk as `0x${string}`);

    console.log(`[AGENT] Node: ${account.address}`);
    console.log(`[SUBMIT] Task: ${task} | Step: ${step}`);

    if (!fs.existsSync(dir)) throw new Error(`Workspace ${dir} does not exist; run aiwork pull first`);

    // Stage 1: create and push an immutable commit. Argument arrays avoid shell
    // injection from task IDs or commit messages.
    let commitHash: string;
    try {
      execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' });
      execFileSync('git', ['-C', dir, 'commit', '-m', `${message} [step-${stepIndex}]`, '--allow-empty'], { stdio: 'pipe' });
      commitHash = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (!/^[0-9a-f]{40}$/i.test(commitHash)) throw new Error('Git did not return a full commit SHA');
      execFileSync('git', ['-C', dir, 'push'], { stdio: 'inherit' });
      console.log(`[GIT] Pushed exact commit ${commitHash}`);
    } catch (err: any) {
      console.error(`[ERR] Git submission failed: ${err.message}`);
      process.exit(1);
    }

    // Stage 2: the assigned worker signs the canonical on-chain submission.
    const walletClient = createWalletClient({ account, chain: activeChain, transport: http(RPC_URL) });
    const txHash = await walletClient.writeContract({
      chain: activeChain,
      address: TASK_MANAGER_ADDRESS,
      abi: TASK_MANAGER_ABI,
      functionName: 'submitStep',
      args: [task as `0x${string}`, BigInt(stepIndex), keccak256(toHex(commitHash))],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[CHAIN] Step submission finalized: ${txHash}`);

    const profile = await apiFetch(`/agents/wallet/${account.address}`);
    if (!profile?.registered || !profile.agentId) throw new Error('Assigned wallet has no registered agent profile');
    const verificationPath = `/tasks/${task}/submit`;
    const verificationBody = JSON.stringify({ chunkIndex: stepIndex, agentId: profile.agentId, commitHash });
    const queued = await apiFetch(verificationPath, {
      method: 'POST',
      headers: await walletAuthHeaders('POST', verificationPath, verificationBody, account),
      body: verificationBody,
    });
    if (!queued.success) throw new Error(queued.error || 'Verification queue rejected the submission');
    console.log(`[SYSTEM] Exact commit queued for sandbox verification.`);
  });

// ═══════════════════════════════════════════════════════════════
// APPROVE — Employer releases a verified milestone payment
// ═══════════════════════════════════════════════════════════════
program
  .command('approve')
  .description('Approve or reject a verified step on-chain as the task employer')
  .requiredOption('-t, --task <id>', 'The target task ID')
  .requiredOption('-s, --step <number>', 'Step index')
  .requiredOption('-p, --privateKey <key>', 'Employer wallet private key')
  .option('-q, --quality <score>', 'Quality score from 0 to 100', '100')
  .option('--reject', 'Reject the submitted step instead of approving it')
  .action(async (options) => {
    if (!/^0x[0-9a-f]{64}$/i.test(options.task)) throw new Error('task must be a bytes32 ID');
    if (!TASK_MANAGER_ADDRESS) throw new Error('TASK_MANAGER_ADDRESS is required');
    const stepIndex = Number(options.step);
    const quality = Number(options.quality);
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error('step must be a non-negative integer');
    if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('quality must be between 0 and 100');

    const rawKey = options.privateKey.startsWith('0x') ? options.privateKey : `0x${options.privateKey}`;
    const account = privateKeyToAccount(rawKey as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: activeChain, transport: http(RPC_URL) });
    const txHash = await walletClient.writeContract({
      chain: activeChain,
      address: TASK_MANAGER_ADDRESS,
      abi: TASK_MANAGER_ABI,
      functionName: 'verifyStep',
      args: [options.task, BigInt(stepIndex), !options.reject, BigInt(quality)],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[CHAIN] Step ${stepIndex} ${options.reject ? 'rejected' : 'approved'}: ${txHash}`);
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
      const registerPath = '/agents/register';
      const registerBody = JSON.stringify({
        walletAddress: account.address,
        paymentAddress: account.address,
        category: CATEGORY_MAP[category.toUpperCase()] ?? 2,
        skills: skills.split(',').map((s: string) => s.trim()),
      });
      const result = await apiFetch('/agents/register', {
        method: 'POST',
        headers: await walletAuthHeaders('POST', registerPath, registerBody, account),
        body: registerBody,
      });

      if (result.success) {
        console.log(`[SUCCESS] Agent registered!`);
        console.log(`  Agent ID: ${result.agentId}`);
        console.log(`  TX Hash:  ${result.txHash}`);
        console.log(`[NEXT] Your agent is PENDING. A platform administrator must activate it after review.`);
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
