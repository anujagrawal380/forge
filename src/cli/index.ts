#!/usr/bin/env node
import { loadConfig, ConfigError } from "../config/load.js";
import { ConnectorManager, type ConnectorResult } from "../connectors/manager.js";

const HELP = `forge — turn a YAML file into a durable agent for your tool stack

Usage:
  forge config validate [--config <path>]     Validate agent.yaml (fail fast, actionable errors)
  forge connectors test  [--config <path>]     Connect to each connector, discover & classify tools

Options:
  --config <path>   Path to agent.yaml (default: ./agent.yaml)
  --json            Machine-readable output
  -h, --help        Show this help
`;

interface Args {
  cmd: string[];
  config: string;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { cmd: [], config: "agent.yaml", json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i] ?? out.config;
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else out.cmd.push(a);
  }
  return out;
}

const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;

function cmdValidate(args: Args): number {
  const { config, path } = loadConfig(args.config);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, path, config }, null, 2));
    return 0;
  }
  const connectorNames = Object.keys(config.connectors);
  console.log(GREEN("✓ config is valid") + DIM(`  (${path})`));
  console.log(`  agent:      ${BOLD(config.agent.name)}  mode=${config.agent.mode}`);
  console.log(`  connectors: ${connectorNames.length ? connectorNames.join(", ") : DIM("(none)")}`);
  if (config.agent.llm) console.log(`  llm:        ${config.agent.llm.provider}/${config.agent.llm.model}`);
  return 0;
}

function opBadge(opType: string, confidence: string): string {
  const label = opType === "read" ? GREEN("read ") : YELLOW("write");
  return confidence === "low" ? `${label}${DIM("?")}` : `${label} `;
}

async function cmdConnectorsTest(args: Args): Promise<number> {
  const { config } = loadConfig(args.config);
  const manager = new ConnectorManager(config);
  const results = await manager.onboardAll();
  await manager.closeAll();

  if (args.json) {
    console.log(JSON.stringify({ results }, null, 2));
    return results.every((r) => r.ok) ? 0 : 1;
  }
  printResults(results);
  return results.every((r) => r.ok) ? 0 : 1;
}

function printResults(results: ConnectorResult[]): void {
  let totalTools = 0;
  let writeTools = 0;
  for (const r of results) {
    if (!r.ok) {
      console.log(`\n${RED("✗")} ${BOLD(r.name)} ${RED("failed to onboard")}`);
      console.log(`  ${RED(r.error ?? "unknown error")}`);
      continue;
    }
    const sv = r.serverVersion;
    const svStr = sv?.name ? DIM(`  [${sv.name}${sv.version ? " " + sv.version : ""}]`) : "";
    console.log(`\n${GREEN("✓")} ${BOLD(r.name)} ${DIM(`— ${r.tools.length} tool(s)`)}${svStr}`);
    for (const t of r.tools) {
      totalTools++;
      if (t.classification.opType === "write") writeTools++;
      const desc = t.description ? DIM(" — " + t.description.split("\n")[0].slice(0, 60)) : "";
      console.log(
        `    ${opBadge(t.classification.opType, t.classification.confidence)}  ${t.name}` +
          `${desc}  ${DIM("(" + t.classification.reason + ")")}`,
      );
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `\n${DIM("summary:")} ${okCount}/${results.length} connector(s) healthy, ` +
      `${totalTools} tool(s) discovered, ${writeTools} write tool(s) ${DIM("(gated by approval unless autonomous)")}`,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.cmd.length === 0) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }
  const [group, sub] = args.cmd;
  try {
    if (group === "config" && sub === "validate") return cmdValidate(args);
    if (group === "connectors" && (sub === "test" || sub === "list")) return await cmdConnectorsTest(args);
    console.log(RED(`Unknown command: ${args.cmd.join(" ")}`));
    console.log(HELP);
    return 1;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(RED("✗ " + e.message));
      return 1;
    }
    console.error(RED("✗ unexpected error: " + (e instanceof Error ? e.message : String(e))));
    return 1;
  }
}

main().then((code) => process.exit(code));
