# Forge — Connector Model (Self-Onboarding)

> **Status:** Decided (T1 + T2 design) · **Date:** 2026-06-01
> **Decision:** Forge has **no hardcoded per-connector support.** The connector layer is **generic**:
> the runtime knows how to speak MCP once, and onboards any connector by **discovering** it.
> Slack and Linear are the first two *demo* connectors that prove the layer — not special-cased code.

---

## 1. The principle

> **A connector is data, not code.** Adding one is a config entry + an MCP endpoint, never a core
> code change.

This is possible because **MCP servers are self-describing**: they expose `tools/list`, and every
tool carries a name, description, and input/output JSON schema. The runtime introspects that at
connect time and mounts the tools. The agent reasons about the tools it *discovers*, not tools we
pre-baked.

Side effect: several PRD requirements become *outputs of discovery* rather than hand-maintained
artifacts — F49 (read/write classification), F51 (surface tool schemas), F21 (loaded-agent summary).

---

## 2. The self-onboarding spectrum

| Tier | Meaning | Status in Forge |
|---|---|---|
| **T1 — Auto-discovery** | Point at an existing MCP server → introspect tools → classify read/write → mount. No code. | **Build now. The core.** |
| **T2 — Spec-driven generation** | No MCP server, but an OpenAPI/GraphQL spec exists → generate MCP tools from the spec. | **Design for now, build later.** Connector layer must not assume MCP-only. |
| **T3 — Agentic onboarding** | Agent reads API *docs*, writes/tests a connector itself, registers it. | **Out of scope for v0.** Guarded, human-reviewed roadmap item only. See §6. |

---

## 3. T1 — Auto-discovery flow

```
agent.yaml:
  connectors:
    jira:
      type: mcp
      server: <url | image | command>     # how to reach the MCP server
      credentials: { token_env: JIRA_TOKEN }
      scopes: { projects: ["PLATFORM"] }   # optional narrowing

runtime on startup / connector add:
  1. Launch / connect to the MCP server (container, URL, or stdio).
  2. Handshake + tools/list  → receive tool definitions + JSON schemas.
  3. Classify each tool read vs write (see §4).
  4. Apply scopes + approval policy + rate limits from config.
  5. Register tools with the Pi harness; expose schemas to validation tooling.
  6. Health-check; surface a loaded-agent summary (connectors, tools, modes).
  7. On failure: isolate (don't crash the stack), report actionable error.
```

**Requirements added to the PRD (F-series):**
- **F61 [MUST]** Onboard any MCP server declared in config with **no Forge code change** (T1).
- **F62 [MUST]** Introspect tools via MCP at connect time; mount them dynamically.
- **F63 [MUST]** The connector layer is provider-neutral: `type:` is an extension point
  (`mcp` now; `openapi`, `graphql` later) so T2 needs no rearchitecture.
- **F64 [SHOULD]** Cache discovered tool manifests; re-introspect on change / on demand.
- **F65 [SHOULD]** `forge connectors test <name>` connects, lists tools, and reports read/write
  classification + health without starting the agent loop.

---

## 4. Read/write classification (the safety-critical part)

The runtime **must** know which discovered tools mutate state, because mode enforcement (read-only /
draft / autonomous) and approval routing depend on it (F31, F32, F14). MCP does not always declare
this reliably, so classification is layered, **fail-safe to "write"**:

1. **MCP annotations** if present (some servers mark `readOnlyHint`).
2. **Heuristics** on tool name/verb (`get/list/search/read` → read; `create/update/delete/post/send`
   → write) — advisory only.
3. **Config override** in `agent.yaml` — the human's word wins:
   ```yaml
   connectors:
     jira:
       tool_overrides:
         jira.add_comment: write
         jira.search: read
   ```
4. **Default = write** when uncertain. An unclassified tool is treated as dangerous and gated behind
   approval. Never silently treat an unknown tool as safe.

**F66 [MUST]** Unclassified / ambiguous tools default to `write` and require approval.

---

## 5. What changes in the product framing

- **Headline capability:** *"Connect anything that speaks MCP — Forge discovers and uses it, no
  per-connector code."* (Was: "Slack→Linear action items.")
- **Slack & Linear** are demoted to the **first two demo connectors** proving the generic layer.
- The **v0 wedge workflow** (Slack→Linear action items) still anchors the end-to-end demo and the
  acceptance criteria — but it must run **through the generic layer**, not special-cased code.
- **New acceptance bar:** connect an MCP server *not known at build time* and have the agent use it.

---

## 6. T3 guardrails (for when we get there — not v0)

Agentic onboarding = the agent generates and runs new code with credentials. That crosses several
org security redlines (no untrusted execution; supply-chain pinning; least-privilege tokens; no
secrets in artifacts) and is exposed to prompt injection from the very docs it reads. If/when built:
- Generate in a **locked sandbox**, **no live credentials** during authoring.
- **Mandatory human review** before a generated connector is ever trusted.
- Pin + audit generated output; treat it as untrusted third-party code.
- Requires `#bu-security-and-it` review before shipping.

---

## 7. Net

Forge's moat sharpens: not "we built connectors," but **"you can connect anything, and the agent
figures out how to operate it — safely, inside your own boundary."** T1 delivers that today; T2 is a
config-shaped extension; T3 is a fenced research track.
