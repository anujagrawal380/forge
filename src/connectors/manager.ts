import type { ForgeConfig } from "../config/schema.js";
import { McpConnector, type DiscoveredTool } from "./mcp.js";

/** Outcome of onboarding a single connector. Failures are isolated (PRD F50). */
export interface ConnectorResult {
  name: string;
  ok: boolean;
  error?: string;
  tools: DiscoveredTool[];
  serverVersion?: { name?: string; version?: string };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Onboards every connector declared in config by discovering its tools.
 * One unhealthy connector must never crash the others (PRD F50).
 */
export class ConnectorManager {
  readonly connectors: McpConnector[] = [];

  constructor(config: ForgeConfig) {
    for (const [name, cfg] of Object.entries(config.connectors)) {
      this.connectors.push(new McpConnector(name, cfg));
    }
  }

  async onboardAll(): Promise<ConnectorResult[]> {
    const results: ConnectorResult[] = [];
    for (const c of this.connectors) {
      try {
        await c.connect();
        const tools = await c.discover();
        const info = c.serverInfo().version;
        results.push({
          name: c.name,
          ok: true,
          tools,
          serverVersion: info ? { name: info.name, version: info.version } : undefined,
        });
      } catch (e) {
        results.push({ name: c.name, ok: false, error: errMsg(e), tools: [] });
      }
    }
    return results;
  }

  async closeAll(): Promise<void> {
    for (const c of this.connectors) {
      try {
        await c.close();
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
