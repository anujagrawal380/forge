import { z } from "zod";

/**
 * Forge config schema (`agent.yaml`).
 *
 * Design intent (see docs/03-connector-model.md): the connector layer is GENERIC.
 * A connector is declared as data — a transport + optional overrides — and the runtime
 * discovers its tools at connect time. There is no per-connector code.
 *
 * NOTE: this refines the sketch in docs/02-PRD.md §7.0. We use an explicit, unambiguous
 * `transport` block (a discriminated union) instead of a free-form `server:` string, so the
 * runtime always knows exactly how to reach a server.
 */

export const StdioTransportSchema = z.object({
  type: z.literal("stdio"),
  /** Executable to spawn, e.g. "npx" or "node". */
  command: z.string().min(1),
  /** Arguments, e.g. ["-y", "@modelcontextprotocol/server-everything"]. */
  args: z.array(z.string()).default([]),
  /**
   * Extra env passed to the spawned server. Values support `${VAR}` interpolation,
   * resolved from the Forge process environment (this is how credentials are injected
   * without ever being committed — see PRD F6).
   */
  env: z.record(z.string()).optional(),
});

export const HttpTransportSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  /** Headers (e.g. Authorization) — values support `${VAR}` interpolation. */
  headers: z.record(z.string()).optional(),
});

export const TransportSchema = z.discriminatedUnion("type", [
  StdioTransportSchema,
  HttpTransportSchema,
]);

export const ConnectorSchema = z.object({
  /** Only "mcp" today; the field is the T2 extension point (openapi/graphql later). */
  type: z.literal("mcp").default("mcp"),
  transport: TransportSchema,
  /**
   * Human authority over read/write classification (PRD F66). Wins over all heuristics.
   * e.g. { "jira.add_comment": "write", "jira.search": "read" }
   */
  tool_overrides: z.record(z.enum(["read", "write"])).optional(),
  /** Optional narrowing (channels, teams, projects…). Surfaced to the agent; not enforced yet. */
  scopes: z.record(z.any()).optional(),
});

export const LlmSchema = z.object({
  provider: z.string(),
  model: z.string(),
  api_key_env: z.string().optional(),
});

export const AgentMetaSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["read_only", "draft", "autonomous"]).default("draft"),
  instructions: z.string().optional(),
  llm: LlmSchema.optional(),
});

export const ForgeConfigSchema = z.object({
  agent: AgentMetaSchema,
  connectors: z.record(ConnectorSchema).default({}),
});

export type StdioTransport = z.infer<typeof StdioTransportSchema>;
export type HttpTransport = z.infer<typeof HttpTransportSchema>;
export type Transport = z.infer<typeof TransportSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorSchema>;
export type AgentMeta = z.infer<typeof AgentMetaSchema>;
export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
