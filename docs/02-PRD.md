# PRD — Forge

> **Status:** Draft v0.2 · **Date:** 2026-06-01 · **Owner:** anuj.agrawal@atlan.com
> **Companion docs:** `00-use-cases-and-tradeoffs.md`, `01-open-source-stack.md`, `03-connector-model.md`
>
> **Working thesis:** A self-hosted, config-defined agent runtime for operating across a user's tools.
> **Primary v0 wedge:** Slack → Linear action items with memory, idempotency, draft mode, and audit logs.
>
> **The product bar — one sentence everything is measured against:** **The config file is the product.**
> Every feature must either make `agent.yaml` more expressive, the runtime safer, or the agent easier to trust.

---

## 1. Summary

Forge is an **open-source, self-hosted runtime that turns one YAML file into a durable AI agent for
your tool stack.** A user describes their connectors (Slack, Linear, Confluence, …), credentials,
memory, approvals, and behavior in one readable config file, and gets a single durable agent — built
on the open-source **Pi** harness, running in containers — that has shared context and access across
all of those tools and can operate across them as one coherent operator.

**Headline capability — generic connector layer (see `03-connector-model.md`):** Forge has **no
hardcoded per-connector support.** The runtime speaks MCP once and **self-onboards any connector by
discovering it** — introspecting its tools and schemas at connect time, classifying read/write, and
mounting them. *"Connect anything that speaks MCP; the agent figures out how to operate it."* Slack
and Linear are the first two **demo** connectors that prove the layer, not special-cased code. The
layer is provider-neutral so spec-driven generation (OpenAPI → MCP, "T2") can be added later without
rearchitecture; agent-writes-its-own-connector ("T3") is a guarded, out-of-scope-for-v0 roadmap item.

**One-liner:** *"Forge turns a YAML file into a durable, self-hosted agent for your tool stack."*

**Positioning (longer):** Define connectors, credentials, memory, approvals, and behavior in one
config file. Forge runs a single durable agent that can safely work across Slack, Linear, Confluence,
Sentry, and other tools — **without handing credentials or data to a managed platform.**

### 1.1 Product promise

The product promise is not "connectors exist." The promise is: a user can describe their operating
environment once, in a readable config file, and get a durable agent that can safely **observe,
remember, decide, ask for approval, and act** across that environment.

In v0, the product should feel like:

```bash
git clone ...
cp .env.example .env
edit agent.yaml
docker compose up
```

Then the user has a working agent that can monitor Slack, create Linear issues in draft mode, avoid
duplicates, and expose enough logs for the operator to trust what happened.

---

## 2. Problem

Today, getting an AI agent to operate across a real toolset is painful:
- Stitching connectors means juggling multiple SDKs, auth models, and mental models.
- Each tool is an isolated integration; nothing reasons *across* tools with shared memory.
- Managed platforms hold your credentials and route your data through them — a non-starter for
  security-sensitive / customer data.
- Rolling your own means rebuilding the agent loop, memory, durability, and retries from scratch.

There is no **simple, open-source, self-hosted** way to say "here are my connectors" and get a
capable cross-tool agent.

### 2.1 Why now

Recent shifts make this newly possible:
- MCP has created a common pattern for exposing external systems as tools.
- Open-source agent harnesses such as Pi reduce the need to build the agent loop from scratch.
- Teams increasingly want agents that operate inside their own security boundary.
- Existing connector platforms optimize for breadth and managed convenience, not self-hosted control.

The gap is now in the thin layer between "I have MCP tools" and "I have a usable, durable, safe agent."

---

## 3. Goals / Non-goals

### Goals
- **G1** — Define a complete agent (connectors + credentials + behavior) in **one simple config file**.
- **G2** — Agent has **shared context + access across all connected tools** (a single operator).
- **G3** — **Open-source & self-hosted**; the user holds their own credentials. No vendor lock-in.
- **G4** — Durable: the agent has **memory** and can **resume** interrupted work.
- **G5** — Easy to run: `docker compose up` locally; same images deploy anywhere later.
- **G6** — **Self-onboarding connectors:** add any MCP-speaking connector via config alone, with
  **no Forge code change** (T1 auto-discovery). The connector layer is generic, not per-connector.

### Non-goals (for now)
- **NG1** — Not a no-code GUI builder (config-as-code first; GUI is later, if ever).
- **NG2** — Not a managed SaaS at v0 (self-host first).
- **NG3** — Not a curated 500-connector *catalog* — Forge onboards any MCP server generically rather
  than shipping/maintaining a fixed connector list. Breadth comes from the MCP ecosystem, not from us.
- **NG4** — Not a multi-agent orchestration framework — **one** capable agent first.
- **NG5** — Not building our own harness — we use Pi.

### 3.1 Usability goals
- **U1** — A first-time user can understand the example `agent.yaml` without reading source code.
- **U2** — A user can run the Slack → Linear wedge locally with example config and clear setup docs.
- **U3** — Every agent action is explainable after the fact: what triggered it, what context it used,
  what tools it called, what it wrote, and whether approval was required.
- **U4** — The system fails **visibly and recoverably**. Misconfigured credentials, missing scopes,
  rate limits, and connector downtime produce actionable errors.
- **U5** — The default path is **safe**: read-only or draft mode first, autonomous only when enabled.

---

## 4. Target users & personas

- **P1 — The self-hoster / platform engineer**: clones the OSS project, stands up an agent for a
  workflow quickly on infra they trust. **Primary persona.**
- **P2 — The team lead / ops owner**: wants the *outcome* (issues filed, status synced) without
  caring about the plumbing. Consumes what P1 sets up.

**DECIDED — this is an open-source project.** Implications: docs and DX are first-class; no
Atlan-internal assumptions baked into the code; **one agent per deployment** (each install runs a
single agent defined by its `agent.yaml`); single-tenant per deployment. Multi-tenancy and
managed-SaaS concerns are explicitly out of scope.

### 4.1 Core user journeys

#### Journey A — First local run
1. User clones the repo.
2. User copies `.env.example` to `.env`.
3. User fills in Slack, Linear, database, and LLM credentials.
4. User edits `agent.yaml`.
5. User runs `docker compose up`.
6. System validates config and credentials.
7. Agent starts in draft mode.
8. User posts a test action item in Slack.
9. Agent proposes a Linear issue.
10. User approves the action.
11. Agent creates the Linear issue and posts the link back to Slack.

**Success criteria:** this works without source-code edits.

#### Journey B — Operator reviews what happened
1. User notices the agent created or proposed an issue.
2. User opens the run log.
3. User sees the source Slack message, detected action item, reasoning summary, tool calls, approval
   status, Linear issue payload, and final result.
4. User can understand why the agent acted.

**Success criteria:** the user can debug trust issues without reading raw container logs.

#### Journey C — Add a connector
1. User adds a connector block to `agent.yaml`.
2. User adds its MCP server to compose or enables a bundled server.
3. User adds credentials to `.env` or secret store.
4. User restarts.
5. The agent validates that the connector is available and lists its tools.

**Success criteria:** no core runtime code change required for a connector with an existing MCP server.

---

## 5. Use cases

Full tiering in `00-use-cases-and-tradeoffs.md`. Priority for this PRD:
- **Primary v0 capability: the generic connector layer** — connect any MCP server via config and have
  the agent discover & use its tools (see `03-connector-model.md`).
- **v0 demo workflow: Slack → Linear action items** (detailed below) — the end-to-end proof that runs
  **through the generic layer**, not special-cased code. Slack & Linear are simply the first two
  connectors onboarded this way.
- **Secondary (validates cross-tool + memory):** Incident companion (Sentry → Slack → Linear),
  Status synthesizer (Linear + Slack → Confluence).
- **Always-available baseline:** Read-only "ask my stack" Q&A across connected tools.

### 5.1 v0 wedge: Slack → Linear action items

The agent watches configured Slack channels and detects messages that likely represent bugs, tasks,
follow-ups, or customer-impacting issues. In draft mode, it proposes a Linear issue with title,
description, team, labels, priority, source link, and a deduplication key. After approval, it creates
the issue and replies in-thread with the Linear link.

**Example input — Slack message:**
> "Customer Acme is blocked because exports fail when the workspace has more than 10k assets. Can
> someone file this?"

**Expected draft Linear issue:**
- Title: `Exports fail for large workspaces`
- Team: configured default or inferred from channel
- Labels: `bug`, optionally `customer-impacting`
- Priority: inferred or defaulted
- Description includes: Slack permalink, reporter, original message, agent-generated summary, any
  relevant context from memory
- Deduplication key: Slack message ID + channel ID, plus optional semantic duplicate check against
  recent Linear issues

**v0 edge cases the agent must handle:** message already processed · looks like a task but lacks
detail · Linear team/label can't be resolved · thread contains extra context · Linear API fails ·
LLM response malformed · user denies approval · user edits the draft before approval · duplicate
issue already exists.

---

## 6. Product principles

1. **The config file is the product.** Its simplicity is the main differentiator — protect it.
2. **Boring, proven parts; thin novel glue.** Pi for the harness, Postgres for memory, MCP for
   connectors. We build the YAML→agent compiler and the cross-tool experience.
3. **The user owns their keys and data.** Self-hosted, no third-party credential custody.
4. **Cross-tool by default.** A connector is never an island; the agent reasons across all of them.
5. **Safe by default.** Read-only and draft modes before autonomous writes; secrets never logged.

### 6.1 Product experience principles

- **Trust is part of the UX.** The user should never wonder whether the agent silently acted. Every
  write action has an audit trail; in draft mode every proposed action is visible before execution.
- **Configuration degrades gracefully.** A minimal config works. Advanced users add schedules, memory
  settings, tool scopes, rate limits, approval rules, and connector options without making the basic
  path harder.
- **The agent is boring to operate.** This is infrastructure: health checks, logs, migrations,
  deterministic startup validation, and clear failure states.

---

## 7. Functional requirements

### 7.0 Example `agent.yaml`

```yaml
agent:
  name: slack-linear-triage
  mode: draft # read_only | draft | autonomous

  instructions: |
    You are an operations assistant.
    Watch configured Slack channels for actionable bugs or tasks.
    Create clear Linear issues only when there is enough evidence.
    Avoid duplicates. Always include source links.

  llm:
    provider: anthropic
    model: claude-3-5-sonnet
    api_key_env: ANTHROPIC_API_KEY

connectors:
  slack:
    type: mcp
    server: slack-mcp
    credentials:
      bot_token_env: SLACK_BOT_TOKEN
    scopes:
      channels:
        - "#customer-issues"
        - "#eng-triage"

  linear:
    type: mcp
    server: linear-mcp
    credentials:
      api_key_env: LINEAR_API_KEY
    scopes:
      teams:
        - "Platform"
      labels:
        - "bug"
        - "customer-impacting"

memory:
  provider: postgres
  url_env: DATABASE_URL
  embeddings:
    provider: openai
    model: text-embedding-3-small
    api_key_env: OPENAI_API_KEY
  retention:
    raw_events_days: 30
    summaries_days: 180
    idempotency_keys_days: 365

triggers:
  - type: slack_message
    connector: slack
    channels:
      - "#customer-issues"

approvals:
  default: required
  write_actions:
    linear.create_issue: required
    slack.post_message: auto_after_approval

idempotency:
  strategy: source_event_and_semantic_match
  ttl_days: 90

audit:
  enabled: true
  redact_secrets: true
```

### Configuration (`agent.yaml`)
- **F1 [MUST]** Declare connectors by name + the credentials/setup each needs.
- **F2 [MUST]** A 5-line "simple" form must produce a working agent; advanced options optional.
- **F3 [MUST]** Define agent behavior: instructions/persona, which LLM, optional schedule.
- **F4 [SHOULD]** Per-connector scoping (e.g. which Slack channels, which Linear team).
- **F4.1 [MUST] Pre-flight validation.** A local command (`forge config validate`) checks syntax,
  missing env vars, and malformed MCP connections *before* attempting to boot the agent.
- **F4.2 [SHOULD] Starter templates.** `forge init --template slack-to-linear` generates a working
  boilerplate config so the user never starts from a blank file.
- **F19 [MUST]** Validate `agent.yaml` at startup and fail fast with actionable errors.
- **F20 [MUST]** `forge config doctor` checks required fields, missing env vars, connector
  availability, and incompatible settings.
- **F21 [MUST]** Generate a summary of the loaded agent: connectors, mode, triggers, writable tools,
  approval rules, and memory backend.
- **F22 [SHOULD]** Provide a JSON schema for `agent.yaml` for editor autocomplete and validation.
- **F23 [SHOULD]** Dry-run mode: validate config and simulate tool availability without starting the
  agent loop.

### Connectors
- **F5 [MUST]** Each connector mounts as agent tools via self-hosted MCP servers.
- **F6 [MUST]** Credentials injected from a secret store (env / docker secrets / Vault), **never**
  committed; `.env.example` has placeholders only.
- **F7 [SHOULD]** Adding a new connector = add a block + its MCP server; no core code change.
- **F49 [MUST]** Runtime must know which tools are **read-only** and which can **mutate** state.
- **F50 [MUST]** Connector failures must be isolated; one unhealthy connector must not crash the stack.
- **F51 [SHOULD]** Connector tool schemas surfaced to the agent and to validation tooling.
- **F52 [SHOULD]** Connector setup docs include required OAuth scopes / API token permissions.

  *Connector contract — each connector exposes to the runtime:* name · available tools · read/write
  classification per tool · required credentials · required scopes · rate limits (if known) · health
  check method · tool input/output schema.

  **Self-onboarding (generic connector layer — see `03-connector-model.md`):**
- **F61 [MUST]** Onboard any MCP server declared in config with **no Forge code change** (T1).
- **F62 [MUST]** Introspect tools via MCP `tools/list` at connect time and mount them dynamically.
- **F63 [MUST]** Connector layer is provider-neutral: `type:` is an extension point (`mcp` now;
  `openapi`/`graphql` later) so T2 spec-driven generation needs no rearchitecture.
- **F64 [SHOULD]** Cache discovered tool manifests; re-introspect on change / on demand.
- **F65 [SHOULD]** `forge connectors test <name>` connects, lists tools, reports read/write
  classification + health, without starting the agent loop.
- **F66 [MUST]** Read/write classification is layered (MCP annotations → name heuristics → config
  override) and **fail-safe**: unclassified/ambiguous tools default to `write` and require approval.

### Agent runtime (Pi)
- **F8 [MUST]** Run the Pi harness in a container with connector tools + memory wired in.
- **F9 [MUST]** Shared context: the agent can use outputs from one connector as inputs to another.
- **F10 [SHOULD]** Provider-agnostic LLM (BYOK Claude/GPT/… or local Ollama/vLLM). No default committed.
- **F29 [MUST]** Runs are durable run records with status: `queued`, `running`,
  `waiting_for_approval`, `completed`, `failed`, `cancelled`.
- **F30 [MUST]** Tool calls recorded with connector, tool name, input summary, output summary,
  latency, status, and error if any.
- **F31 [MUST]** The agent must distinguish read tools from write tools.
- **F32 [MUST]** The runtime must **enforce mode restrictions at the runtime level**, not rely on
  prompt instructions.
- **F33 [SHOULD]** Support manual re-run of failed runs.
- **F34 [SHOULD]** Support replaying a run in dry-run mode for debugging.

### Memory & durability
- **F11 [MUST]** Persistent memory across runs (Postgres + pgvector); recall relevant prior context.
- **F12 [MUST]** Idempotency for actions ("have I already filed this issue?").
- **F13 [SHOULD]** Resume interrupted work (Pi state v0 → Temporal for crash-proof/scheduled).
- **F35 [MUST]** Memory stores processed source events to support idempotency.
- **F36 [MUST]** Memory stores summaries and references, not unlimited raw data by default.
- **F37 [MUST]** Memory retrieval scoped to the current agent deployment and configured connectors.
- **F38 [SHOULD]** Memory entries include provenance: source connector, object ID, timestamp, reason.
- **F39 [SHOULD]** Users can inspect and delete memory records.
- **F40 [SHOULD]** Configurable retention (see `memory.retention` in the example).

### Safety & control — approvals / human-in-the-loop
- **F14 [MUST]** Modes: **read-only**, **draft** (propose, human approves), **autonomous** (acts).
  Default = draft for write actions.
- **F14.1 [MUST] Approval routing.** In draft mode, define *where* approval happens. Default for the
  v0 wedge: route approvals to a designated Slack DM/channel so the user doesn't leave their workflow.
- **F15 [MUST]** Audit log of every tool call / action taken (structured, no secrets).
- **F16 [SHOULD]** Rate limiting on connector/LLM calls to bound cost & blast radius.
- **F24 [MUST]** Draft mode creates **proposed** actions, not actual writes.
- **F25 [MUST]** Every proposed write action includes a human-readable diff or payload preview.
- **F26 [MUST]** Users can approve, reject, or **edit** proposed actions.
- **F27 [SHOULD]** Approval can happen through Slack for the v0 wedge.
- **F28 [SHOULD]** Approval policy is configurable per tool/action.

### Observability & operations
- **F17 [MUST]** `docker compose up` runs the full stack locally.
- **F18 [SHOULD]** Same images deploy to a single host or K8s (Helm/operator deferred — see staging).
- **F41 [MUST]** Expose health checks for agent runtime, database, connectors, and LLM provider.
- **F42 [MUST]** Structured logs suitable for local debugging and production log shipping.
- **F43 [MUST]** Basic metrics: runs started/completed/failed · tool calls by connector · approval
  wait time · LLM calls/tokens/errors · duplicate actions prevented · connector rate-limit events.
- **F44 [SHOULD]** Lightweight local admin UI or CLI for runs, approvals, and logs.
- **F45 [SHOULD]** OpenTelemetry traces for runs and tool calls.
- **F58 [MUST] State inspection.** A CLI/endpoint to view the agent's current memory and pending
  tasks. "Why did it just do that?" must be answerable in under 2 minutes.
- **F59 [MUST] Graceful degradation & alerting.** If a connector fails (expired token, rate limit),
  the agent must not crash silently. Log the error and optionally notify the user via a working
  connector (e.g. a fallback Slack alert).
- **F60 [SHOULD] Memory reset.** A command to wipe memory per-connector or globally
  (`forge reset-memory --hard`) — crucial for testing and iterative development.

### CLI
The project exposes a small CLI for setup, validation, and operations.
```bash
forge init
forge config validate
forge config doctor
forge connectors list
forge connectors test
forge run once
forge runs list
forge runs inspect <run_id>
forge approvals list
forge approvals approve <approval_id>
forge approvals reject <approval_id>
forge reset-memory --hard
```
- **F46 [MUST]** CLI works inside the container and locally where practical.
- **F47 [MUST]** Output human-readable by default, machine-readable with `--json`.
- **F48 [SHOULD]** CLI is the primary debugging surface before a GUI exists.

### Failure handling
**Expected failure classes:** invalid config · missing env var · invalid credential · missing
connector scope · connector server unavailable · LLM provider unavailable · LLM output invalid · tool
call timeout · rate limit · duplicate action detected · approval expired · database unavailable ·
agent crash mid-run.
- **F53 [MUST]** Startup failures explain exactly what needs to be fixed.
- **F54 [MUST]** Runtime failures recorded on the run record.
- **F55 [MUST]** Retriable failures use bounded retries with backoff.
- **F56 [MUST]** Non-retriable failures stop the run and surface the cause.
- **F57 [SHOULD]** Failed runs can be retried manually after config/credential fixes.

---

## 8. Architecture

Per `01-open-source-stack.md`: Pi harness (container) ← reads `agent.yaml`; connector tools from
self-hosted MCP server containers; memory in Postgres+pgvector; durability via Pi state → Temporal;
LLM BYOK/local; secrets in a self-hosted store. v0 = single `docker compose`.

### 8.1 Architecture diagram

```text
                  ┌────────────────────┐
                  │    agent.yaml       │
                  └─────────┬───────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ YAML → Agent        │
                  │ compiler/validator  │
                  └─────────┬───────────┘
                            │
                            ▼
┌──────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ Slack MCP    │◀▶ │ Pi Agent Runtime    │◀▶ │ Linear MCP          │
└──────────────┘   └─────────┬───────────┘   └────────────────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ Postgres + pgvector │
                  │ memory/audit/runs   │
                  └─────────┬───────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ LLM provider        │
                  │ BYOK/local          │
                  └────────────────────┘
```

### 8.2 Data model

Core runtime tables: `agents` · `connectors` · `runs` · `tool_calls` · `approvals` · `memory_items`
· `idempotency_keys` · `audit_events`.

**`runs`** — `id` · `agent_id` · `trigger_type` · `trigger_source` · `status` · `started_at` ·
`completed_at` · `error` · `summary`

**`tool_calls`** — `id` · `run_id` · `connector` · `tool_name` · `operation_type` (`read`|`write`) ·
`input_redacted` · `output_redacted` · `status` · `latency_ms` · `error`

**`approvals`** — `id` · `run_id` · `proposed_action_type` · `proposed_payload` · `status` ·
`approved_by` · `created_at` · `resolved_at`

**`idempotency_keys`** — `id` · `agent_id` · `source_connector` · `source_object_id` ·
`semantic_hash` · `target_connector` · `target_object_id` · `created_at`

---

## 9. Security requirements (per org guidelines)

- **[MUST]** No secrets in code/config/logs/CI; `.env` gitignored.
- **[MUST]** User credentials held only by the self-hosted deployment, never a third party.
- **[MUST]** Connector tokens scoped least-privilege; expire/refresh handled.
- **[MUST]** Audit log includes contextual IDs (run, connector, user) but never tokens/bodies.
- **[MUST]** Sanitize LLM output before any downstream use; never feed it to eval/shell/SQL/innerHTML.
- **[MUST]** Mask PII/secrets before sending context to an LLM; log *categories* of data, not raw.
- **[SHOULD]** Container images non-root, minimal capabilities, pinned base images.
- **Request manual review** (`#bu-security-and-it`) before this becomes customer-facing or
  multi-tenant, or if we ever route customer data to an external LLM.

### 9.1 Threat model

**Main risks:**
1. Secret leakage through config, logs, prompts, traces, or tool outputs.
2. Prompt injection from connected tools.
3. Unauthorized writes to connected systems.
4. Over-broad connector credentials.
5. Duplicate or incorrect actions.
6. Data exfiltration to external LLMs.
7. Supply-chain risk from connector containers.
8. Cross-agent / cross-tenant leakage if multi-tenancy is introduced later.

**Mitigations:** runtime-level enforcement of read/write modes · tool allowlists + per-action
approval policies · secret redaction before logs and LLM calls · prompt-injection guidance in system
instructions and tool-use policies · least-privilege tokens · explicit scoping in `agent.yaml` ·
audit logs for all actions · container hardening · no multi-tenancy in v0.

---

## 10. Success metrics

- v0 success = the Slack→Linear wedge runs end-to-end on real workspaces, files correct issues, and
  does **not** duplicate (idempotency works).
- **Time-to-first-agent:** clone → working agent in **< 15 minutes**.
- **Adding a connector:** **< 30 minutes** for a connector with an existing MCP server.
- **MTTR during setup:** invalid API key → logs identify *which* key failed in **< 1 minute**.
- **Cross-tool task success rate** on the wedge (qualitative at first; measured later).

### 10.1 v0 acceptance criteria
- **A1** — A new user can run the Slack → Linear wedge locally from the README.
- **A2** — The system validates config and reports missing credentials clearly.
- **A3** — The agent detects an actionable Slack message and creates a Linear issue in draft mode.
- **A4** — The user can approve the draft and cause the issue to be created.
- **A5** — The agent posts the Linear issue link back to the Slack thread.
- **A6** — Re-running on the same Slack message does not create a duplicate issue.
- **A7** — Every run has an inspectable audit trail.
- **A8** — The agent can be restarted without losing memory, idempotency state, or pending approvals.
- **A9** — The system can run with at least one configurable external LLM provider.
- **A10** — No secrets appear in logs, audit records, or committed files.
- **A11** — A user can connect an MCP server **not known at build time** (e.g. Jira) via config
  alone, and the agent discovers and uses its tools with no Forge code change.

### 10.2 Negative success metrics (the product is failing if…)
- Users need to edit source code to run the wedge.
- Users cannot tell why the agent acted.
- The agent creates duplicate Linear issues.
- Connector setup takes longer than the agent setup itself.
- Safe modes are bypassable by prompt instruction.
- Logs are too noisy to debug real failures.
- The config file becomes a dumping ground for implementation details.

---

## 11. Milestones / phasing

### M0 — Spike: harness + generic discovery viability
Prove Pi can call MCP tools and persist state, **via the generic connector layer** (no hardcoding).
**Deliverables:** Pi runtime in Docker · generic MCP connect+introspect (`tools/list`) · one MCP
server (Linear) onboarded purely from config · read/write classification · Postgres available · one
manually triggered task · basic run log.
**Exit:** Agent can onboard an MCP server from config and read/write through it from inside the
container — with no connector-specific code.

### M1 — Wedge: Slack → Linear
Prove the first useful workflow.
**Deliverables:** Slack MCP connected · Slack message trigger · action-item detection · Linear draft
generation · approval path · issue creation · Slack reply with link · idempotency by Slack message ID.
**Exit:** End-to-end workflow succeeds on real Slack and Linear workspaces.

### M1.5 — DX basics
Make iteration painless *before* building more flows.
**Deliverables:** `forge config validate` (YAML linter/validator) · `forge reset-memory` · clear
startup/credential error messages.
**Exit:** A developer can wipe memory and retry the wedge in seconds without manual DB surgery.

### M2 — Config contract
Make the wedge fully config-driven.
**Deliverables:** `agent.yaml` schema · config compiler · config validation · example configs ·
`forge config doctor` · no hardcoded channels/teams/labels/models.
**Exit:** A user can change channels, teams, labels, mode, and provider via config only.

### M3 — Memory & audit hardening
Make the agent trustworthy and restartable.
**Deliverables:** durable runs · tool-call audit logs · persistent idempotency keys · restart-safe
pending approvals · memory provenance.
**Exit:** Container restart loses no pending work and causes no duplicate actions.

### M4 — Third connector + T2 design
Prove the generic layer holds beyond the demo pair, and lay groundwork for spec-driven generation.
**Deliverables:** onboard a third connector (e.g. Sentry or Jira) via config only · validate the
`type:` extension point with an `openapi` stub (design, not full build) · a second use case (Sentry →
Slack → Linear incident companion *or* Linear + Slack → Confluence status synthesizer).
**Exit:** Adding the third connector required no core runtime changes; T2 path is designed.

### M5 — Scheduling & durability
Support scheduled and crash-proof runs.
**Deliverables:** scheduled triggers · Temporal integration (or equivalent durable execution) · retry
policies · run cancellation.
**Exit:** Scheduled workflows survive process restarts.

### M6 — Packaging
Make deployment credible beyond local Compose.
**Deliverables:** production compose example · K8s deployment docs · Helm vs operator decision ·
backup/restore docs · upgrade/migration notes.
**Exit:** A platform engineer can deploy this to a single-host production-like environment.

---

## 12. Open questions

**Decided:** OSS project ✓ · one agent per deployment ✓ · LLM provider-agnostic, no default ✓ ·
name = **Forge** ✓ · generic connector layer (T1 now, T2 designed-for, T3 fenced) ✓ · Slack→Linear is
the demo workflow through the generic layer, not special-cased ✓.

- **[OPEN]** Canonical MCP packaging — bundled connector containers, user-provided MCP URLs, or both?
  (Now central, since the connector layer is generic — likely deserves an early decision.)
- **[OPEN]** Where do approvals live in v0 — CLI, Slack, minimal local UI, or all of the above?
- **[OPEN]** Should Slack replies be automatic after approval, or also require approval?
- **[OPEN]** Minimum supported set of LLM providers for v0?
- **[OPEN]** Do we support local-only models in v0, or just design for them?
- **[OPEN]** Memory: store raw snippets, summaries only, or both with retention controls?
- **[OPEN]** Default retention policy for audit logs and memory?
- **[OPEN]** Approval timeout behavior?
- **[OPEN]** Should the agent expose a local web UI in v0, or is CLI + Slack approval enough?
- **[OPEN]** How much prompt-injection protection is required for v0?
- **[OPEN]** What is the boundary between Pi's responsibilities and Forge's? (worth its own doc)
- **[OPEN]** Open-source license?
- **[OPEN]** Should the name reference Pi (e.g. "Pi Forge") or stand alone? (currently: stand alone)

---

## 13. Out of scope (v0)

No-code GUI · managed SaaS · 500-connector catalog · multi-agent orchestration · custom harness ·
Helm/operator packaging · cross-tenant features.

### 13.1 Developer experience (README-driven development)

Because this is an open-source project, the README is part of the product. The repo should include:
`README.md` · `quickstart.md` · `agent.yaml.example` · `.env.example` · `docker-compose.yml` ·
connector setup guides · troubleshooting guide · security model · architecture doc · contribution
guide. The quickstart optimizes for the **first successful local run**, not for explaining the entire
architecture.

### 13.2 Repo structure

```text
/
├── README.md
├── docs/
│   ├── quickstart.md
│   ├── configuration.md
│   ├── connectors/
│   │   ├── slack.md
│   │   └── linear.md
│   ├── security.md
│   ├── architecture.md
│   └── troubleshooting.md
├── examples/
│   └── slack-linear/
│       ├── agent.yaml
│       └── README.md
├── runtime/
├── compiler/
├── cli/
├── connectors/
├── migrations/
├── docker-compose.yml
└── .env.example
```

---

## 14. Definition of done for v0

v0 is done when a platform engineer can:
1. Clone the repo.
2. Configure Slack, Linear, database, and LLM credentials.
3. Run the stack locally.
4. Watch a Slack channel.
5. Get a proposed Linear issue from a Slack message.
6. Approve the issue.
7. See the issue created in Linear.
8. See the Slack thread updated.
9. Restart the stack.
10. Confirm the same message does not create a duplicate.
11. Inspect the audit trail for the entire run.
