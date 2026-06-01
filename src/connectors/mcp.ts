import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConnectorConfig } from "../config/schema.js";
import { classifyTool, type Classification } from "./classify.js";

/** A tool discovered from a connector at connect time — the generic layer's core output. */
export interface DiscoveredTool {
  connector: string;
  name: string;
  /** Fully-qualified name the agent sees, e.g. "slack.send_message". */
  qualifiedName: string;
  description?: string;
  inputSchema: unknown;
  classification: Classification;
}

/** Env that npx/node need to function, inherited only when the user also supplies custom env. */
function safeInheritedEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "APPDATA"];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Wraps one MCP server: connect, introspect (`tools/list`), classify each tool.
 * Knows nothing about Slack/Linear/etc — it is fully generic (PRD F61/F62).
 */
export class McpConnector {
  private client?: Client;
  tools: DiscoveredTool[] = [];

  constructor(
    public readonly name: string,
    private readonly cfg: ConnectorConfig,
  ) {}

  private buildTransport(): Transport {
    const t = this.cfg.transport;
    if (t.type === "stdio") {
      return new StdioClientTransport({
        command: t.command,
        args: t.args,
        // Merge safe inherited env (so npx/node resolve) with user-provided env.
        env: t.env ? { ...safeInheritedEnv(), ...t.env } : undefined,
      });
    }
    return new StreamableHTTPClientTransport(new URL(t.url), {
      requestInit: t.headers ? { headers: t.headers } : undefined,
    });
  }

  async connect(): Promise<void> {
    this.client = new Client({ name: "forge", version: "0.0.0" });
    await this.client.connect(this.buildTransport());
  }

  /** Introspect tools and classify them. Returns the discovered tool set. */
  async discover(): Promise<DiscoveredTool[]> {
    if (!this.client) throw new Error("connect() must be called before discover()");
    const { tools } = await this.client.listTools();
    this.tools = tools.map((t) => ({
      connector: this.name,
      name: t.name,
      qualifiedName: `${this.name}.${t.name}`,
      description: t.description,
      inputSchema: t.inputSchema,
      classification: classifyTool(t.name, t.annotations, this.cfg.tool_overrides?.[t.name]),
    }));
    return this.tools;
  }

  serverInfo() {
    return {
      version: this.client?.getServerVersion(),
      capabilities: this.client?.getServerCapabilities(),
    };
  }

  /** Invoke a discovered tool by its (unqualified) name. */
  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.client) throw new Error("connect() must be called before callTool()");
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
