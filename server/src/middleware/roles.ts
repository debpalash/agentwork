/**
 * Role-based authorization middleware
 *
 * Two roles:
 *   - Employer: can create tasks, award bids, view submissions
 *   - Agent: can bid, execute tasks, submit work
 *
 * Role is determined by:
 *   1. API key scope (from api_keys table)
 *   2. Agent registration status (registered agents = Agent role)
 *   3. Default = Employer (humans who post tasks but aren't registered agents)
 *
 * Usage:
 *   taskRoutes.post("/", requireRole("employer"), async (c) => { ... })
 *   taskRoutes.post("/:id/submit", requireRole("agent"), async (c) => { ... })
 */

import { Context, Next } from "hono";
import { pool } from "../db";

export type UserRole = "admin" | "employer" | "agent" | "readonly";

/**
 * Determine the user's role from context.
 * Sets c.set("role", role) for downstream handlers.
 */
export async function resolveRole(c: Context, next: Next) {
  // Already determined by auth middleware
  const scope = c.get("scope") as string | undefined;

  if (scope === "admin") {
    c.set("role", "admin");
    return next();
  }

  if (scope === "readonly") {
    c.set("role", "readonly");
    return next();
  }

  // Check if the wallet/agent is registered as an agent
  const walletAddress = c.get("walletAddress");
  const agentId = c.get("agentId");

  if (agentId) {
    c.set("role", "agent");
    return next();
  }

  if (walletAddress) {
    try {
      const { rows } = await pool.query(
        "SELECT agent_id FROM agents WHERE wallet_address = $1 AND status = 'ACTIVE'",
        [walletAddress]
      );
      if (rows.length > 0) {
        c.set("role", "agent");
        c.set("agentId", rows[0].agent_id);
        return next();
      }
    } catch (_) {}
  }

  // Default: employer (human who posts tasks)
  c.set("role", "employer");
  return next();
}

/**
 * Middleware factory: require a specific role.
 * Admin can do everything.
 */
export function requireRole(...roles: UserRole[]) {
  return async (c: Context, next: Next) => {
    // Resolve role if not already set
    if (!c.get("role")) {
      await resolveRole(c, async () => {});
    }

    const userRole = c.get("role") as UserRole;

    // Admin bypasses all checks
    if (userRole === "admin") return next();

    if (!roles.includes(userRole)) {
      return c.json({
        error: `Access denied. Required role: ${roles.join(" or ")}. Your role: ${userRole}`,
        hint: userRole === "agent"
          ? "Agents cannot create tasks. Use an employer account."
          : "Register as an agent to access this endpoint.",
      }, 403);
    }

    return next();
  };
}
