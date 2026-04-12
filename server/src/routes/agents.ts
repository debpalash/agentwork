import { Hono } from "hono";
import {
  publicClient,
  walletClient,
  CONTRACTS,
  AGENT_REGISTRY_ABI,
  account,
} from "../services/blockchain";
import { authMiddleware } from "../middleware/auth";

export const agentRoutes = new Hono();

// ─── Register Agent (Protected) ────────────────────────────────
agentRoutes.post("/register", authMiddleware, async (c) => {
  const body = await c.req.json();
  const { walletAddress, paymentAddress, category, skills } = body;

  if (!walletAddress || category === undefined || !skills?.length) {
    return c.json({ error: "Missing required fields: walletAddress, category, skills" }, 400);
  }

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "registerAgent",
      args: [
        walletAddress,
        paymentAddress || walletAddress,
        category,
        skills,
      ],
    });

    // Get the agent ID from the address mapping
    const agentId = await publicClient.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "addressToAgentId",
      args: [walletAddress],
    });

    return c.json({
      success: true,
      txHash: hash,
      agentId,
      message: "Agent registered. Status: PENDING. Awaiting activation.",
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Activate Agent (Protected) ────────────────────────────────
agentRoutes.post("/:agentId/activate", authMiddleware, async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "activateAgent",
      args: [agentId],
    });

    return c.json({ success: true, txHash: hash, status: "ACTIVE" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Agent Profile ─────────────────────────────────────────
agentRoutes.get("/:agentId", async (c) => {
  const agentId = c.req.param("agentId");

  try {
    const agent = await publicClient.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getAgent",
      args: [agentId],
    }) as any[];

    const categories = ["NLP", "VISION", "CODE", "DATA", "CREATIVE", "REASONING", "MULTIMODAL", "SPECIALIZED"];
    const statuses = ["PENDING", "ACTIVE", "SUSPENDED", "BANNED", "RETIRED"];

    return c.json({
      agentId: agent[0],
      walletAddress: agent[1],
      paymentAddress: agent[2],
      category: categories[Number(agent[3])] || "UNKNOWN",
      status: statuses[Number(agent[4])] || "UNKNOWN",
      registrationTime: Number(agent[5]),
      reputationScore: Number(agent[6]),
      reputationPercent: (Number(agent[6]) / 100).toFixed(1) + "%",
      totalEarned: agent[7].toString(),
      stakedAmount: agent[8].toString(),
      isVerified: agent[9],
      tasksCompleted: Number(agent[10]),
      tasksFailed: Number(agent[11]),
      tasksPartial: Number(agent[12]),
      avgQualityScore: Number(agent[13]),
      currentStreak: Number(agent[14]),
      bestStreak: Number(agent[15]),
    });
  } catch (err: any) {
    return c.json({ error: "Agent not found" }, 404);
  }
});

// ─── Get Agent by Wallet (full profile) ───────────────────────
agentRoutes.get("/wallet/:address", async (c) => {
  const address = c.req.param("address");

  try {
    const agentId = await publicClient.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "addressToAgentId",
      args: [address as `0x${string}`],
    }) as string;

    if (!agentId || agentId === "") return c.json({ registered: false }, 200);

    // Fetch full profile
    const agent = await publicClient.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getAgent",
      args: [agentId],
    }) as any[];

    const categories = ["NLP", "VISION", "CODE", "DATA", "CREATIVE", "REASONING", "MULTIMODAL", "SPECIALIZED"];
    const statuses = ["PENDING", "ACTIVE", "SUSPENDED", "BANNED", "RETIRED"];

    return c.json({
      registered: true,
      agentId: agent[0],
      walletAddress: agent[1],
      paymentAddress: agent[2],
      category: categories[Number(agent[3])] || "UNKNOWN",
      status: statuses[Number(agent[4])] || "UNKNOWN",
      registrationTime: Number(agent[5]),
      reputationScore: Number(agent[6]),
      reputationPercent: (Number(agent[6]) / 100).toFixed(1) + "%",
      totalEarned: agent[7].toString(),
      stakedAmount: agent[8].toString(),
      isVerified: agent[9],
      tasksCompleted: Number(agent[10]),
      tasksFailed: Number(agent[11]),
      tasksPartial: Number(agent[12]),
      avgQualityScore: Number(agent[13]),
      currentStreak: Number(agent[14]),
      bestStreak: Number(agent[15]),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── List All Agents (indexed from events) ─────────────────────
import { parseAbiItem } from "viem";

agentRoutes.get("/", async (c) => {
  try {
    const totalAgents = await publicClient.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "totalAgents",
    });

    // Get AgentRegistered events — note: agentId is indexed string (hashed),
    // so we use the wallet address instead and look up the real agentId
    const logs = await publicClient.getLogs({
      address: CONTRACTS.agentRegistry,
      event: parseAbiItem("event AgentRegistered(string indexed agentId, address indexed wallet, uint8 category)"),
      fromBlock: 0n,
    });

    const categories = ["NLP", "VISION", "CODE", "DATA", "CREATIVE", "REASONING", "MULTIMODAL", "SPECIALIZED"];
    const statuses = ["PENDING", "ACTIVE", "SUSPENDED", "BANNED", "RETIRED"];

    const agents = await Promise.all(
      logs.map(async (log: any) => {
        try {
          // Use wallet address to look up the actual agentId string
          const walletAddr = log.args.wallet;
          const agentId = await publicClient.readContract({
            address: CONTRACTS.agentRegistry,
            abi: AGENT_REGISTRY_ABI,
            functionName: "addressToAgentId",
            args: [walletAddr],
          }) as string;

          if (!agentId) return null;

          const raw = await publicClient.readContract({
            address: CONTRACTS.agentRegistry,
            abi: AGENT_REGISTRY_ABI,
            functionName: "getAgent",
            args: [agentId],
          }) as any[];

          return {
            agentId: raw[0],
            walletAddress: raw[1],
            category: categories[Number(raw[3])] || "UNKNOWN",
            status: statuses[Number(raw[4])] || "UNKNOWN",
            reputationScore: Number(raw[6]),
            reputationPercent: (Number(raw[6]) / 100).toFixed(1) + "%",
            totalEarned: String(raw[7]),
            isVerified: raw[9],
            tasksCompleted: Number(raw[10]),
            tasksFailed: Number(raw[11]),
            avgQualityScore: Number(raw[13]),
            currentStreak: Number(raw[14]),
          };
        } catch { return null; }
      })
    );

    return c.json({ totalAgents: Number(totalAgents), agents: agents.filter(Boolean) });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// API KEY SELF-SERVICE
// ═══════════════════════════════════════════════════════════════

/** Create a new API key for an agent. Returns plaintext ONCE. */
agentRoutes.post("/keys", authMiddleware, async (c) => {
  const body = await c.req.json();
  const { walletAddress, label, agentId, scope, expiresInDays } = body;

  if (!walletAddress || !label) {
    return c.json({ error: "walletAddress and label required" }, 400);
  }

  // Only admin scope can create admin keys
  const requestedScope = scope || "agent";
  if (requestedScope === "admin" && c.get("scope") !== "admin") {
    return c.json({ error: "Only admins can create admin-scoped keys" }, 403);
  }

  try {
    const { createApiKey } = await import("../services/apikeys");
    const result = await createApiKey({
      walletAddress,
      agentId,
      label,
      scope: requestedScope,
      expiresInDays,
    });

    return c.json({
      success: true,
      key: result.key,
      keyId: result.keyId,
      expiresAt: result.expiresAt,
      message: "⚠️ Save this key now — it will NOT be shown again.",
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/** List all API keys for a wallet (metadata only, no plaintext). */
agentRoutes.get("/keys/:walletAddress", authMiddleware, async (c) => {
  const walletAddress = c.req.param("walletAddress");

  try {
    const { listApiKeys } = await import("../services/apikeys");
    const keys = await listApiKeys(walletAddress);
    return c.json({ walletAddress, keys });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/** Revoke an API key. */
agentRoutes.delete("/keys/:keyId", authMiddleware, async (c) => {
  const keyId = Number(c.req.param("keyId"));
  const walletAddress = c.get("walletAddress");

  if (!walletAddress) {
    return c.json({ error: "Wallet address required (authenticate first)" }, 400);
  }

  try {
    const { revokeApiKey } = await import("../services/apikeys");
    const revoked = await revokeApiKey(keyId, walletAddress);
    return c.json({ success: revoked, message: revoked ? "Key revoked" : "Key not found" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
