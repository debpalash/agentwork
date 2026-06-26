// ─── Shared protocol constants ─────────────────────────────────
// Single source of truth for values that were previously duplicated as magic
// numbers across services (and could drift out of sync).

/**
 * Minimum sandbox quality score (0–100) for a chunk to count as verified and
 * eligible for payout. Used by the verification queue worker and the sandbox
 * result handler — keep them in lockstep by importing this, never re-literaling.
 */
export const VERIFICATION_PASS_THRESHOLD = 70;
