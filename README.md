# Forge

> Open-source, self-hosted runtime that turns one YAML file into a durable AI agent for your tool stack.

**The product bar:** *the config file is the product.* You describe your connectors, credentials,
memory, approvals, and behavior in one `agent.yaml`, and get a single durable agent — built on the
[Pi](https://github.com/earendil-works/pi) harness — that can observe, remember, decide, ask for
approval, and act across your tools.

**Headline capability — the generic connector layer:** Forge has *no hardcoded per-connector
support*. It speaks MCP once and **self-onboards any connector by discovering it** — introspecting
its tools at connect time, classifying read vs. write, and mounting them. *Connect anything that
speaks MCP; the agent figures out how to operate it.*

See [`docs/`](./docs) for the PRD, architecture, and connector model.

## Status

Early. Working today (milestone **M0** + Pi harness wiring):
- ✅ Generic MCP connector onboarding from config (stdio + HTTP transports)
- ✅ Tool discovery + fail-safe read/write classification
- ✅ Config load/validate with `${VAR}` credential injection and actionable errors
- ✅ **Pi agent loop** wired: discovered MCP tools bridged into Pi as `AgentTool`s
- ✅ **Runtime mode enforcement** (read_only / draft / autonomous) gating writes in code, not prompt
- ✅ **Audit hooks** on every tool call (before-gate decision + after-result)
- ✅ CLI: `config validate`, `connectors test`, `run --message`

Verified offline (no API key): tool-bridge round-trips through a live MCP server, mode gate correct
across all read/write × mode combinations (`scripts/smoke-tools.ts`). The full LLM `run` loop is
wired and typechecks but is **not yet exercised end-to-end** — needs an LLM API key.

Not built yet: persistence (Postgres+pgvector), the approval flow, durable run/audit records. See the
milestones in [`docs/02-PRD.md`](./docs/02-PRD.md).

## Quickstart (no credentials needed)

```bash
npm install
npm run forge -- connectors test --config examples/everything-demo/agent.yaml
```

This spawns the official MCP "everything" reference server and prints the tools Forge discovered and
how it classified each — proving the generic layer with zero connector-specific code.

```bash
# validate any config (fast, fail-fast)
npm run forge -- config validate --config examples/everything-demo/agent.yaml

# run the agent loop once (needs an LLM key, e.g. ANTHROPIC_API_KEY)
npm run forge -- run --message "what is 21 plus 21?" --config examples/everything-demo/agent.yaml
```

## Configuration

A connector is **data, not code**:

```yaml
agent:
  name: my-agent
  mode: draft          # read_only | draft | autonomous

connectors:
  everything:
    type: mcp
    transport:
      type: stdio       # or: type: http, url: ...
      command: npx
      args: ["-y", "@modelcontextprotocol/server-everything"]
    tool_overrides:     # human-authoritative read/write classification
      echo: read
```

Credentials are injected via `${VAR}` interpolation from your environment / `.env` (never committed).
See [`.env.example`](./.env.example) and [`examples/slack-linear/`](./examples/slack-linear) for the
v0 demo workflow.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run build         # compile to dist/
npm run forge -- ...  # run the CLI via tsx
```
