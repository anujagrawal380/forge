import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { McpConnector, DiscoveredTool } from "../connectors/mcp.js";

/**
 * LLM-safe tool name. Providers (e.g. Anthropic) require ^[a-zA-Z0-9_-]{1,64}$ — no dots.
 * We namespace by connector with "__" so tools from different connectors never collide.
 */
export function toolName(connector: string, name: string): string {
  return `${connector}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Map an MCP CallToolResult into Pi's AgentToolResult; throw on tool error (Pi's contract). */
function mapResult(toolLabel: string, res: unknown): AgentToolResult<unknown> {
  const r = res as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const blocks = Array.isArray(r?.content) ? r.content : [];
  const text: TextContent[] = blocks
    .filter((c): c is { type: "text"; text: string } => (c as any)?.type === "text")
    .map((c) => ({ type: "text", text: String(c.text) }));

  if (r?.isError) {
    // Pi: "Throw on failure instead of encoding errors in content."
    throw new Error(text.map((t) => t.text).join("\n") || `${toolLabel} returned an error`);
  }

  const content: TextContent[] =
    text.length > 0
      ? text
      : [{ type: "text", text: JSON.stringify(r?.structuredContent ?? r ?? {}, null, 2) }];

  return { content, details: res };
}

/**
 * Bridge a discovered MCP tool into a Pi AgentTool.
 *
 * Key move: MCP's `inputSchema` (plain JSON Schema) is passed straight through as `parameters`.
 * pi-ai's validateToolArguments natively coerces against JSON Schema when no TypeBox metadata is
 * present, so no schema conversion is needed and the real schema reaches both the validator and
 * the LLM provider.
 */
export function bridgeTool(tool: DiscoveredTool, connector: McpConnector): AgentTool {
  const name = toolName(tool.connector, tool.name);
  return {
    name,
    label: tool.qualifiedName,
    description: tool.description ?? `${tool.name} (via ${tool.connector})`,
    parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as unknown as TSchema,
    execute: async (_toolCallId, params) => {
      const res = await connector.callTool(tool.name, (params ?? {}) as Record<string, unknown>);
      return mapResult(tool.qualifiedName, res);
    },
  };
}
