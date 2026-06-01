# Sandbox Agent — Open-Source Stack (Decision Record)

> **Status:** Decided — open-source / self-hosted, container-based.
> **Date:** 2026-05-31
> **Supersedes runtime question in** `00-use-cases-and-tradeoffs.md`.

## Decision

Build entirely on **open-source, self-hostable components**, running in **containers (Docker)**.
**No managed-cloud lock-in** (no Cloudflare, no Composio-as-a-dependency for the core path).
v0 runs locally with Docker; same images graduate to any container host (Compose → K8s / Nomad)
with no rewrite.

## Language: TypeScript (decided 2026-06-01)

**Language is downstream of the harness choice, not independent.** We embed Pi's runtime
(`@earendil-works/pi-agent-core`), which is a TypeScript/Node library — so the implementation
language is TypeScript. MCP does not force this (it has first-class TS *and* Python SDKs); Pi does.

Why this is fine despite Python being the "AI default": Forge's in-process job is **I/O-bound
orchestration** (spawn MCP servers, call tools, route approvals, persist runs). The heavy AI work
happens behind language-neutral interfaces — LLMs over an API, vectors in Postgres/pgvector over SQL,
embeddings over an API. So we give up little by not being in Python, and gain a single typed language
across CLI/runtime/connectors. **If we ever reconsider Pi, the language decision reopens with it.**

## The stack, layer by layer

| Layer | Choice | Why | License |
|---|---|---|---|
| **Harness** | **Pi** (`earendil-works/pi`) | The agent loop, tool-calling, state, multi-provider LLM. Already open source & embeddable. | OSS |
| **Sandbox / isolation** | **Docker** (v0) → optionally **gVisor / Firecracker / Kata** later for stronger isolation | Each agent runs in its own container. Pi's bash+fs work natively. Harden isolation only when multi-tenant. | OSS |
| **Connectors / tools** | **Self-hosted MCP servers** (official + community: Slack, Linear, Confluence…) | No third party holds the user's OAuth tokens. Pi mounts them as tools via its MCP client. | OSS |
| **Memory** | **Postgres + pgvector** (start) → optionally **Letta** or **mcp-memory-service** | Durable long-term memory + semantic recall. Self-hosted. Start boring, grow into a memory service. | OSS |
| **Durable execution / resume** | **Pi state** (v0) → **Temporal** (when we need real durability) | "Resume the session" = durable execution. Temporal is the OSS gold standard — and already in your workspace. See note. | OSS |
| **LLM** | Bring-your-own-key (Claude/GPT/…) **or local** via **Ollama / vLLM** | Pi is provider-agnostic and already supports vLLM pods. Fully local is possible for sensitive data. | OSS / BYOK |
| **Config** | `agent.yaml` (our compiler) | The one file the user touches. The product surface. | Ours |

## On durable execution: Pi state vs. Temporal vs. LangGraph

Your original goal said "LangGraph for resuming the session." The real requirement is **durable
execution** — an agent that can pause (for human approval, a long wait, or a crash) and resume
exactly where it left off. Three open-source ways to get it:

- **Pi's built-in state** — simplest. Good enough for short, single-run tasks. Use for v0.
- **Temporal** — the heavyweight, correct answer for long-running / scheduled / crash-proof
  workflows. Durable by design: survives restarts, retries steps, handles human-in-the-loop waits.
  **You already run Temporal in this workspace**, so the operational knowledge is in-house. Strong
  fit for Tier-4 (scheduled/autonomous) use cases.
- **LangGraph checkpointing** — also OSS and good, but it's a second harness competing with Pi.
  Mixing two harnesses adds confusion. Prefer Pi + Temporal over Pi + LangGraph.

**Recommendation:** Pi state for v0 → introduce **Temporal** when the agent needs to run long,
resume after crashes, or run on a schedule. Skip LangGraph to avoid two competing harnesses.

## What "open-source connectors" means concretely

Instead of Composio holding tokens, we run MCP servers ourselves:
- Each connector = a small MCP server container (many already exist OSS for Slack/Linear/etc.).
- Credentials live in **our** secret store (env / Docker secrets / Vault), never a third party.
- Pi connects to them via its multi-server MCP client and exposes their tools to the agent.
- Trade-off accepted: we own connector maintenance + OAuth flows. In return: no vendor, no data
  egress, full control — which satisfies the org security guidelines around external integrations
  and customer-data handling.

## v0 topology (all local, all Docker)

```
┌─────────────────────────────────────────────────────────┐
│ docker compose                                            │
│                                                           │
│  ┌────────────┐   reads    ┌──────────────────────────┐  │
│  │ agent.yaml │ ─────────▶ │  pi-agent (container)      │  │
│  └────────────┘            │   Pi harness + our glue    │  │
│                            └───────┬───────────┬────────┘  │
│                                    │ MCP       │ SQL/vec   │
│                          ┌─────────▼──┐   ┌─────▼───────┐  │
│                          │ MCP: Slack │   │ Postgres +   │  │
│                          │ MCP: Linear│   │ pgvector     │  │
│                          └────────────┘   │ (memory)     │  │
│                                            └──────────────┘  │
│  Secrets: docker secrets / .env (gitignored)               │
└─────────────────────────────────────────────────────────┘
        │  LLM calls (BYOK Claude/…) or local Ollama/vLLM
        ▼
```

## Net v0 path (updated)

1. **Use case:** Slack → Linear action items (Tier-3 wedge).
2. **Runtime:** Docker, local-first. Same image runs anywhere later.
3. **Connectors:** Self-hosted MCP servers (Slack, Linear).
4. **Memory:** Postgres + pgvector.
5. **Durability:** Pi state now; Temporal when we need crash-proof / scheduled runs.
6. **LLM:** BYOK to start.
7. **Config:** Draft the `agent.yaml` contract next.
