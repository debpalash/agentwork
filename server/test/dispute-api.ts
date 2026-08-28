/**
 * Synthetic local-chain dispute drill.
 *
 * Exercises the real wallet → TaskManager → DisputeResolution → EscrowVault
 * path plus the API's receipt projection. It uses only Hardhat accounts and
 * deletes its PostgreSQL projection when complete; no external dispute or
 * institutional decision is represented.
 */
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  keccak256,
  parseEther,
  toHex,
  type Address,
} from "viem";

const apiBase = process.env.API_BASE || "http://localhost:3001/api/v1";
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const chainId = Number(process.env.CHAIN_ID || 31337);
const databaseUrl = process.env.DATABASE_URL
  || "postgres://aiwork:aiwork_secret_change_me@localhost:5432/aiwork";
const addresses = {
  token: process.env.TOKEN_ADDRESS,
  registry: process.env.AGENT_REGISTRY_ADDRESS,
  escrow: process.env.ESCROW_VAULT_ADDRESS,
  taskManager: process.env.TASK_MANAGER_ADDRESS,
  disputes: process.env.DISPUTE_RESOLUTION_ADDRESS,
};

for (const [name, value] of Object.entries(addresses)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value || "")) throw new Error(`${name} address is required`);
}

async function artifact(relativePath: string) {
  return Bun.file(new URL(`../../artifacts/contracts/${relativePath}`, import.meta.url)).json();
}

async function walletHeaders(path: string, method: string, body: string, signer: any) {
  const address = signer.account.address;
  const message = [
    "AIWork request v2",
    "origin:http://localhost:5173",
    `chainId:${chainId}`,
    `method:${method}`,
    `path:${path}`,
    `bodySha256:${createHash("sha256").update(body).digest("hex")}`,
    `issuedAt:${new Date().toISOString()}`,
    `nonce:${randomUUID()}`,
  ].join("\n");
  return {
    "Content-Type": "application/json",
    "X-Wallet-Address": address,
    "X-Wallet-Message": Buffer.from(message).toString("base64url"),
    "X-Wallet-Signature": await signer.signMessage({ message }),
  };
}

async function expectJson(response: Response, context: string) {
  const value: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${context}: ${response.status} ${value.error || JSON.stringify(value)}`);
  return value;
}

const chain = defineChain({
  id: chainId,
  name: "AIWork synthetic drill chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });
const accountSource = createWalletClient({ chain, transport });
const db = new Pool({ connectionString: databaseUrl });
let taskId: string | undefined;
let agentId: string | undefined;
let insertedAgent = false;

try {
  const rpcAccounts = await accountSource.getAddresses();
  const signer = (index: number) => createWalletClient({ account: rpcAccounts[index]!, chain, transport });
  const [deployer, worker, poster, arbiter1, arbiter2] = [signer(0), signer(1), signer(7), signer(4), signer(5)];
  const [tokenArtifact, registryArtifact, escrowArtifact, taskArtifact, disputeArtifact] = await Promise.all([
    artifact("AIWorkToken.sol/AIWorkToken.json"),
    artifact("AgentRegistry.sol/AgentRegistry.json"),
    artifact("EscrowVault.sol/EscrowVault.json"),
    artifact("TaskManager.sol/TaskManager.json"),
    artifact("DisputeResolution.sol/DisputeResolution.json"),
  ]);
  const tokenAddress = addresses.token as Address;
  const registryAddress = addresses.registry as Address;
  const escrowAddress = addresses.escrow as Address;
  const taskManagerAddress = addresses.taskManager as Address;
  const disputeAddress = addresses.disputes as Address;
  const workerAddress = worker.account.address;
  const posterAddress = poster.account.address;
  const send = async (client: any, address: Address, abi: any, functionName: string, args: any[] = []) => {
    const hash = await client.writeContract({ address, abi, functionName, args });
    return publicClient.waitForTransactionReceipt({ hash });
  };

  agentId = await publicClient.readContract({
    address: registryAddress, abi: registryArtifact.abi,
    functionName: "addressToAgentId", args: [workerAddress],
  }) as string;
  if (!agentId) {
    await send(deployer, registryAddress, registryArtifact.abi, "registerAgent", [
      workerAddress, workerAddress, 2, ["synthetic-dispute-drill"],
    ]);
    agentId = await publicClient.readContract({
      address: registryAddress, abi: registryArtifact.abi,
      functionName: "addressToAgentId", args: [workerAddress],
    }) as string;
  }
  const profile: any = await publicClient.readContract({
    address: registryAddress, abi: registryArtifact.abi,
    functionName: "getAgent", args: [agentId],
  });
  if (Number(profile.status) === 0) await send(deployer, registryAddress, registryArtifact.abi, "activateAgent", [agentId]);

  const reward = parseEther("100");
  const bond = await publicClient.readContract({
    address: disputeAddress, abi: disputeArtifact.abi, functionName: "disputeBond",
  }) as bigint;
  await send(deployer, tokenAddress, tokenArtifact.abi, "transfer", [posterAddress, reward + bond + parseEther("10")]);
  await send(poster, tokenAddress, tokenArtifact.abi, "approve", [escrowAddress, reward]);
  await send(poster, tokenAddress, tokenArtifact.abi, "approve", [disputeAddress, bond]);

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const postReceipt = await send(poster, taskManagerAddress, taskArtifact.abi, "postTask", [
    `Synthetic dispute drill ${randomUUID()}`,
    "CODE",
    0,
    tokenAddress,
    reward,
    0,
    1,
    deadline,
    keccak256(toHex("synthetic requirements")),
    [],
    [],
  ]);
  const posted = postReceipt.logs
    .filter((log) => log.address.toLowerCase() === taskManagerAddress.toLowerCase())
    .map((log) => { try { return decodeEventLog({ abi: taskArtifact.abi, data: log.data, topics: log.topics }); } catch { return null; } })
    .find((event: any) => event?.eventName === "TaskPosted") as any;
  taskId = posted?.args?.taskId as string | undefined;
  if (!taskId) throw new Error("TaskPosted event missing");
  await send(deployer, taskManagerAddress, taskArtifact.abi, "assignTask", [taskId, agentId]);

  const existingAgent = await db.query("SELECT 1 FROM agents WHERE agent_id = $1", [agentId]);
  insertedAgent = !existingAgent.rowCount;
  await db.query(
    `INSERT INTO agents (agent_id, wallet_address, payment_address, category, status, skills)
     VALUES ($1,$2,$2,'CODE','ACTIVE',$3)
     ON CONFLICT (agent_id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address,
       payment_address = EXCLUDED.payment_address, status = 'ACTIVE'`,
    [agentId, workerAddress, ["synthetic-dispute-drill"]],
  );
  await db.query(
    `INSERT INTO tasks (task_id, employer, worker_agent, title, category, phase, max_budget, deadline)
     VALUES ($1,$2,$3,'Synthetic dispute drill','CODE','IN_PROGRESS',100,to_timestamp($4))`,
    [taskId, posterAddress, agentId, deadline],
  );

  const reason = "Synthetic disagreement for atomic-settlement drill";
  const openReceipt = await send(poster, taskManagerAddress, taskArtifact.abi, "openDispute", [
    taskId, keccak256(toHex(reason)),
  ]);
  const projectionBody = JSON.stringify({ taskId, reason, openTxHash: openReceipt.transactionHash });
  const projection = await expectJson(await fetch(`${apiBase}/disputes`, {
    method: "POST",
    headers: await walletHeaders("/api/v1/disputes", "POST", projectionBody, poster),
    body: projectionBody,
  }), "project dispute");
  const chainDisputeId = BigInt(projection.dispute.chain_dispute_id);
  const indexedId = projection.dispute.id;

  await send(arbiter1, disputeAddress, disputeArtifact.abi, "vote", [chainDisputeId, 1]);
  const resolutionReceipt = await send(arbiter2, disputeAddress, disputeArtifact.abi, "vote", [chainDisputeId, 1]);
  const syncBody = JSON.stringify({ txHash: resolutionReceipt.transactionHash });
  const synced = await expectJson(await fetch(`${apiBase}/disputes/${indexedId}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: syncBody,
  }), "sync dispute");

  const [task, escrowState, indexed] = await Promise.all([
    publicClient.readContract({ address: taskManagerAddress, abi: taskArtifact.abi, functionName: "tasks", args: [taskId] }),
    publicClient.readContract({ address: escrowAddress, abi: escrowArtifact.abi, functionName: "getEscrow", args: [taskId] }),
    db.query("SELECT status, resolution, settlement_status, settlement_tx_hash FROM disputes WHERE id = $1", [indexedId]),
  ]);
  const taskStatus = (task as any).status ?? (task as any)[6];
  const escrowActive = (escrowState as any).isActive ?? (escrowState as any)[7];
  const escrowReleased = (escrowState as any).released ?? (escrowState as any)[4];
  if (Number(taskStatus) !== 4) throw new Error(`Expected COMPLETED task, got status ${taskStatus}`);
  if (escrowActive || escrowReleased !== reward) throw new Error("Escrow was not fully and atomically settled");
  const row = indexed.rows[0];
  if (synced.dispute.settlement_status !== "SETTLED" || row?.resolution !== "FAVOR_WORKER"
      || row?.settlement_tx_hash?.toLowerCase() !== resolutionReceipt.transactionHash.toLowerCase()) {
    throw new Error("Database projection does not match the finalized chain settlement");
  }

  console.log("PASS synthetic dispute API drill: wallet open → panel → 2/3 vote → atomic settlement → receipt sync");
} finally {
  if (taskId) {
    await db.query("DELETE FROM disputes WHERE task_id = $1", [taskId]).catch(() => {});
    await db.query("DELETE FROM tasks WHERE task_id = $1", [taskId]).catch(() => {});
  }
  if (insertedAgent && agentId) await db.query("DELETE FROM agents WHERE agent_id = $1", [agentId]).catch(() => {});
  await db.end();
}
