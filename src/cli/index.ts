#!/usr/bin/env node
import { loadConfig, ConfigError } from "../config/load.js";
import { ConnectorManager, type ConnectorResult } from "../connectors/manager.js";
import { buildAgent, resolveApiKey, AgentBuildError } from "../agent/build.js";

const HELP = `forge — turn a YAML file into a durable agent for your tool stack

Usage:
  forge config validate [--config <path>]     Validate agent.yaml (fail fast, actionable errors)
  forge connectors test  [--config <path>]     Connect to each connector, discover & classify tools
  forge run --message <text> [--config <path>] Run the agent once with a prompt (requires an LLM key)

Options:
  --config <path>   Path to agent.yaml (default: ./agent.yaml)
  --message <text>  Prompt for 'forge run'
  --json            Machine-readable output
  -h, --help        Show this help
`;

interface Args {
  cmd: string[];
  config: string;
  message?: string;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { cmd: [], config: "agent.yaml", json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i] ?? out.config;
    else if (a === "--message" || a === "-m") out.message = argv[++i];
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

function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: "text"; text: string } => (b as any)?.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

async function cmdRun(args: Args): Promise<number> {
  if (!args.message) {
    console.error(RED("✗ 'forge run' requires --message <text>"));
    return 1;
  }
  const { config } = loadConfig(args.config);

  // Preflight: fail fast with an actionable error if no LLM key is resolvable (PRD F53).
  if (!config.agent.llm) {
    console.error(RED("✗ agent.llm is required to run — set provider + model in agent.yaml"));
    return 1;
  }
  const key = resolveApiKey(config.agent.llm.provider, config.agent.llm);
  if (!key) {
    const hint = config.agent.llm.api_key_env ?? `${config.agent.llm.provider.toUpperCase()}_API_KEY`;
    console.error(RED(`✗ no API key for provider "${config.agent.llm.provider}". Set ${hint} in your environment/.env.`));
    return 1;
  }

  const manager = new ConnectorManager(config);
  const results = await manager.onboardAll();
  for (const r of results) {
    if (!r.ok) console.error(YELLOW(`⚠ connector "${r.name}" failed to onboard: ${r.error} (continuing without it)`));
  }

  const { agent, toolCount } = buildAgent(config, manager, (e) => {
    if (e.phase === "gate") {
      const mark = e.decision === "allow" ? GREEN("allow") : RED("block");
      console.log(DIM(`    · gate ${mark} ${e.tool} [${e.opType}]${e.decision === "block" ? " — " + e.reason : ""}`));
    } else {
      console.log(DIM(`    · result ${e.tool} ${e.isError ? RED("error") : "ok"}`));
    }
  });

  console.log(DIM(`agent "${config.agent.name}" · mode=${config.agent.mode} · ${toolCount} tool(s) · ${config.agent.llm.provider}/${config.agent.llm.model}\n`));

  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      console.log(`  ${BOLD("→")} ${event.toolName}`);
    } else if (event.type === "message_end" && (event.message as any)?.role === "assistant") {
      const text = extractText(event.message);
      if (text.trim()) console.log("\n" + text.trim() + "\n");
    }
  });

  try {
    await agent.prompt(args.message);
    await agent.waitForIdle();
  } finally {
    await manager.closeAll();
  }
  const err = agent.state.errorMessage;
  if (err) {
    console.error(RED("✗ run ended with error: " + err));
    return 1;
  }
  return 0;
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
    if (group === "run") return await cmdRun(args);
    console.log(RED(`Unknown command: ${args.cmd.join(" ")}`));
    console.log(HELP);
    return 1;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof AgentBuildError) {
      console.error(RED("✗ " + e.message));
      return 1;
    }
    console.error(RED("✗ unexpected error: " + (e instanceof Error ? e.message : String(e))));
    return 1;
  }
}

main().then((code) => process.exit(code));
