import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, baseSepolia, base } from "viem/chains";

// ─── Chain Resolution ──────────────────────────────────────────
// Backend and frontend MUST target the same chain.
// Set CHAIN_ID in .env to switch networks.
const CHAIN_MAP: Record<number, Chain> = {
  31337: hardhat,
  84532: baseSepolia,
  8453: base,
};

const resolvedChainId = Number(process.env.CHAIN_ID || "31337");
const activeChain: Chain = CHAIN_MAP[resolvedChainId] || hardhat;

console.log(`[CHAIN] Resolved to ${activeChain.name} (id: ${activeChain.id})`);

// ─── Contract ABIs (minimal for API calls) ────────────────────
export const AGENT_REGISTRY_ABI = parseAbi([
  "function registerAgent(address,address,uint8,string[]) returns (string)",
  "function activateAgent(string)",
  "function getAgent(string) view returns ((string,address,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))",
  "function addressToAgentId(address) view returns (string)",
  "function totalAgents() view returns (uint256)",
  "function updateReputation(string,bool,bool,uint256,uint256)",
  "function meetsReputation(string,uint256) view returns (bool)",
  "event AgentRegistered(string indexed agentId, address indexed wallet, uint8 category)",
]);

export const TASK_MANAGER_ABI = parseAbi([
  "function postTask(string,string,uint8,address,uint256,uint256,uint256,uint256,bytes32,string[],uint256[]) returns (bytes32)",
  "function assignTask(bytes32,string)",
  "function submitStep(bytes32,uint256,bytes32)",
  "function submitCompletion(bytes32,bytes32)",
  "function verifyStep(bytes32,uint256,bool,uint256)",
  "function verifyCompletion(bytes32,bool,uint256)",
  "function triggerAutoApproval(bytes32)",
  "function cancelTask(bytes32)",
  "function getTask(bytes32) view returns ((bytes32,address,string,string,string,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32,bytes32,bool,uint256,uint256,uint256))",
  "function getTaskSteps(bytes32) view returns ((string,uint256,bool,bool,uint256,bytes32,uint256)[])",
  "function totalTasks() view returns (uint256)",
  "event TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)",
  "event TaskCompleted(bytes32 indexed taskId, string agentId, uint256 totalPaid)",
]);

export const ESCROW_ABI = parseAbi([
  "function getEscrow(bytes32) view returns ((bytes32,address,address,uint256,uint256,uint256,uint256,bool,uint256))",
  "function getReleaseHistory(bytes32) view returns ((uint256,address,string,uint256,uint256,uint256)[])",
]);

export const COMPLEXITY_ABI = parseAbi([
  "function getAssessment(bytes32) view returns ((bytes32,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool))",
  "function createAssessment(bytes32,uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256)) returns (uint256)",
  "function quickFinalize(bytes32) returns (uint256)",
]);

export const BIDDING_ENGINE_ABI = parseAbi([
  "function submitBid(bytes32,string,uint256,uint256,uint256) payable",
  "function getBids(bytes32) view returns ((string,address,uint256,uint256,uint256,uint256,bool)[])",
  "function selectWinner(bytes32) returns (string)",
  "function getBidCount(bytes32) view returns (uint256)",
  "event BidSubmitted(bytes32 indexed taskId, string agentId, uint256 bidPrice)",
  "event WinnerSelected(bytes32 indexed taskId, string agentId)",
]);

// ─── Contract Addresses ────────────────────────────────────────
const CONTRACTS = {
  token: (process.env.TOKEN_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address,
  agentRegistry: (process.env.AGENT_REGISTRY_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address,
  escrowVault: (process.env.ESCROW_VAULT_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as Address,
  complexityOracle: (process.env.COMPLEXITY_ORACLE_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as Address,
  taskManager: (process.env.TASK_MANAGER_ADDRESS || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9") as Address,
  biddingEngine: (process.env.BIDDING_ENGINE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
};

// ─── Clients ───────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL),
});

// Platform wallet for admin operations
const PLATFORM_KEY = process.env.PLATFORM_PRIVATE_KEY;
if (!PLATFORM_KEY) {
  console.warn("[WARN] PLATFORM_PRIVATE_KEY not set. Using default Hardhat key. DO NOT use in production.");
}
const account = privateKeyToAccount(
  (PLATFORM_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`
);

export const walletClient = createWalletClient({
  account,
  chain: activeChain,
  transport: http(RPC_URL),
});

export { CONTRACTS, account, activeChain };
