import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel, getEnvApiKey, getProviders } from "@earendil-works/pi-ai";
import type { ForgeConfig, AgentMeta } from "../config/schema.js";
import type { ConnectorManager } from "../connectors/manager.js";
import type { Classification } from "../connectors/classify.js";
import { bridgeTool } from "./tools.js";
import { gateToolCall, type AgentMode } from "./mode.js";

export class AgentBuildError extends Error {}

export interface AuditEvent {
  phase: "gate" | "result";
  tool: string;
  opType: string;
  decision?: "allow" | "block";
  reason?: string;
  isError?: boolean;
}
export type AuditSink = (e: AuditEvent) => void;

/** Resolve the LLM model from config. Throws an actionable error on unknown provider/model. */
function resolveModel(llm: AgentMeta["llm"]) {
  if (!llm) {
    throw new AgentBuildError("agent.llm is required to run — set provider + model in agent.yaml");
  }
  try {
    // Config supplies arbitrary strings; getModel is catalog-typed, so we cast.
    return getModel(llm.provider as never, llm.model as never);
  } catch (e) {
    throw new AgentBuildError(
      `Unknown model "${llm.provider}/${llm.model}": ${(e as Error).message}\n` +
        `Known providers: ${getProviders().join(", ")}`,
    );
  }
}

/** Prefer the config-named env var, else the provider's conventional key (e.g. ANTHROPIC_API_KEY). */
export function resolveApiKey(provider: string, llm: AgentMeta["llm"]): string | undefined {
  if (llm?.api_key_env) {
    const v = process.env[llm.api_key_env];
    if (v) return v;
  }
  return getEnvApiKey(provider);
}

function buildSystemPrompt(config: ForgeConfig, manager: ConnectorManager): string {
  const lines: string[] = [];
  if (config.agent.instructions) lines.push(config.agent.instructions.trim(), "");
  lines.push(`You are operating in "${config.agent.mode}" mode.`);
  if (config.agent.mode !== "autonomous") {
    lines.push(
      "Write actions (anything that mutates external state) are gated by the runtime and may be " +
        "blocked pending approval. Prefer read tools to gather context; propose writes clearly.",
    );
  }
  const connectorTools = manager.connectors
    .filter((c) => c.tools.length > 0)
    .map((c) => `- ${c.name}: ${c.tools.length} tool(s)`);
  if (connectorTools.length) {
    lines.push("", "Connected tools:", ...connectorTools);
  }
  return lines.join("\n");
}

export interface BuiltAgent {
  agent: Agent;
  toolCount: number;
  classByName: Map<string, Classification>;
}

/**
 * Build a Pi Agent from config + already-onboarded connectors.
 * Mode enforcement (F32) and audit (F30) are wired via beforeToolCall / afterToolCall.
 */
export function buildAgent(
  config: ForgeConfig,
  manager: ConnectorManager,
  audit?: AuditSink,
): BuiltAgent {
  const tools: AgentTool[] = [];
  const classByName = new Map<string, Classification>();
  for (const c of manager.connectors) {
    for (const dt of c.tools) {
      const at = bridgeTool(dt, c);
      tools.push(at);
      classByName.set(at.name, dt.classification);
    }
  }

  const model = resolveModel(config.agent.llm);
  const mode = config.agent.mode as AgentMode;

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(config, manager),
      model,
      thinkingLevel: "off",
      tools,
      messages: [],
    },
    getApiKey: (provider) => resolveApiKey(provider, config.agent.llm),
    beforeToolCall: async (ctx) => {
      const opType = classByName.get(ctx.toolCall.name)?.opType ?? "write"; // fail-safe
      const gate = gateToolCall(opType, mode);
      audit?.({
        phase: "gate",
        tool: ctx.toolCall.name,
        opType,
        decision: gate.allow ? "allow" : "block",
        reason: gate.reason,
      });
      return gate.allow ? undefined : { block: true, reason: gate.reason };
    },
    afterToolCall: async (ctx) => {
      audit?.({
        phase: "result",
        tool: ctx.toolCall.name,
        opType: classByName.get(ctx.toolCall.name)?.opType ?? "write",
        isError: ctx.isError,
      });
      return undefined;
    },
  });

  return { agent, toolCount: tools.length, classByName };
}
