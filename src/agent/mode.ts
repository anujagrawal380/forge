import type { OpType } from "../connectors/classify.js";

export type AgentMode = "read_only" | "draft" | "autonomous";

export interface ToolGate {
  allow: boolean;
  reason: string;
}

/**
 * Runtime enforcement of agent mode (PRD F32: enforced in code, NOT via prompt instructions).
 * This is the single chokepoint every write tool call must pass before executing.
 *
 *   read tool   → always allowed
 *   write tool  → read_only: blocked · draft: blocked pending approval · autonomous: allowed
 *
 * Draft-mode approvals are not wired yet (M1) — until then a write in draft mode is BLOCKED,
 * which is the safe default (better to refuse than to act unapproved).
 */
export function gateToolCall(opType: OpType, mode: AgentMode): ToolGate {
  if (opType === "read") return { allow: true, reason: "read tool" };
  switch (mode) {
    case "read_only":
      return { allow: false, reason: "read_only mode: write tools are blocked" };
    case "draft":
      return {
        allow: false,
        reason: "draft mode: write tools require approval (approval flow not yet implemented — blocked)",
      };
    case "autonomous":
      return { allow: true, reason: "autonomous mode: write allowed" };
  }
}
