/**
 * Read/write classification for discovered tools (PRD F66, docs/03-connector-model.md §4).
 *
 * Mode enforcement (read_only / draft / autonomous) and approval routing depend on knowing
 * which tools MUTATE state. MCP annotations are explicitly untrusted *hints* (the SDK says so),
 * so classification is layered and FAIL-SAFE: when in doubt, treat a tool as `write`.
 *
 *   1. config override      → authority (the human's word wins)
 *   2. destructiveHint=true  → write   (high confidence)
 *   3. readOnlyHint=true     → read    (high confidence, but see note)
 *   4. read-verb heuristic   → read    (LOW confidence — advisory only)
 *   5. default               → write   (fail-safe)
 *
 * Anything not classified as high-confidence read should be gated behind approval by callers.
 */

export type OpType = "read" | "write";

export interface ToolAnnotationHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Classification {
  opType: OpType;
  confidence: "high" | "low";
  reason: string;
}

/** Leading verbs that strongly imply a non-mutating operation. */
const READ_VERB = /^(get|list|search|read|fetch|find|query|describe|show|view|count|lookup|retrieve|export|browse)(?:[_\-A-Z0-9]|$)/;

export function classifyTool(
  name: string,
  annotations: ToolAnnotationHints | undefined,
  override: OpType | undefined,
): Classification {
  if (override) {
    return { opType: override, confidence: "high", reason: "config_override" };
  }
  if (annotations?.destructiveHint === true) {
    return { opType: "write", confidence: "high", reason: "mcp_annotation:destructive" };
  }
  if (annotations?.readOnlyHint === true) {
    return { opType: "read", confidence: "high", reason: "mcp_annotation:readOnly" };
  }
  if (READ_VERB.test(name)) {
    return { opType: "read", confidence: "low", reason: "heuristic:read-verb" };
  }
  return { opType: "write", confidence: "low", reason: "default:fail-safe-write" };
}

/** Whether a tool may run without approval under the given agent mode. */
export function isAllowedInMode(
  c: Classification,
  mode: "read_only" | "draft" | "autonomous",
): boolean {
  if (c.opType === "read") return true;
  // write tools: only autonomous mode may run them without an approval step.
  return mode === "autonomous";
}
