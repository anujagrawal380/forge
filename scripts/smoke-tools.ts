/**
 * Offline smoke test (no LLM / API key needed):
 *  1. Onboard the everything MCP server, bridge its `echo` tool to a Pi AgentTool, execute it for real.
 *  2. Exercise the runtime mode gate across read/write × modes.
 *
 * Run: npx tsx scripts/smoke-tools.ts
 */
import { loadConfig } from "../src/config/load.js";
import { ConnectorManager } from "../src/connectors/manager.js";
import { bridgeTool } from "../src/agent/tools.js";
import { gateToolCall } from "../src/agent/mode.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("✓", msg);
  }
}

async function main() {
  // --- 1. tool bridge round-trip through a live MCP server ---
  const { config } = loadConfig("examples/everything-demo/agent.yaml");
  const manager = new ConnectorManager(config);
  const results = await manager.onboardAll();
  const everything = manager.connectors.find((c) => c.name === "everything")!;

  assert(results[0]?.ok === true, "everything connector onboarded");

  const echo = everything.tools.find((t) => t.name === "echo");
  assert(!!echo, "discovered the 'echo' tool");
  assert(echo?.classification.opType === "read", "echo classified read (via config_override)");

  const agentTool = bridgeTool(echo!, everything);
  assert(agentTool.name === "everything__echo", `tool name is provider-safe: ${agentTool.name}`);

  const result = await agentTool.execute("smoke-1", { message: "hello forge" });
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  console.log("   echo result:", JSON.stringify(text));
  assert(text.includes("hello forge"), "echo tool executed and returned our input");

  await manager.closeAll();

  // --- 2. mode gate ---
  assert(gateToolCall("read", "read_only").allow === true, "read allowed in read_only");
  assert(gateToolCall("write", "read_only").allow === false, "write blocked in read_only");
  assert(gateToolCall("write", "draft").allow === false, "write blocked in draft (pending approval)");
  assert(gateToolCall("write", "autonomous").allow === true, "write allowed in autonomous");
  assert(gateToolCall("read", "autonomous").allow === true, "read allowed in autonomous");

  console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
