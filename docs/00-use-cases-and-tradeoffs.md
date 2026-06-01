# Sandbox Agent — Use Cases & Architecture Tradeoffs

> **Status:** Exploration / pre-decision
> **Date:** 2026-05-30
> **Goal (one line):** A user adds their connectors (Slack, Linear, Confluence, …) via a simple
> config, and gets a single durable agent — built on the **Pi harness** — that has context and
> access to all of them and can do the work across them.

---

## 0. The shape of the product

```
agent.yaml  ──compiles to──▶  Pi harness (pi-agent-core)  ──operates──▶  connected tools
  connectors + creds            loop · state · memory · LLM       Slack · Linear · Confluence …
```

Pi (earendil-works/pi) supplies the harness: the agent loop, tool-calling, state management,
multi-provider LLM API, and an extension system. We supply: the YAML→agent compiler, connector
mounting, persistent memory, and the sandbox lifecycle.

The **differentiated slice** is not "an agent that uses tools" (commoditized) — it's
**cross-connector workflows with shared memory, defined in a trivial config.** Everything in this
doc optimizes for proving *that*.

---

## 1. Use cases (decide what the agent is GOOD at, before locking the stack)

Organized by capability tier — risk and value both climb as you go down. The killer tier is #3.

### Tier 1 — Read-only "ask my stack" (lowest risk, fastest demo)
- **Company Q&A:** "What's the status of the billing migration?" → agent reads Linear + Confluence
  + Slack threads and answers with citations.
- **Catch me up:** "What did I miss in #payments this week?" → summarize Slack + linked Linear issues.
- Value: instant, safe (no writes), great for proving the connector+memory loop.

### Tier 2 — Single-tool actions
- **Linear groomer:** triage/label/assign issues, write crisp descriptions.
- **Confluence gardener:** keep a doc in sync with a source of truth.
- **Slack drafter:** draft (not send) replies/summaries into a thread.
- Value: useful, but no different from a single-connector bot. Not the moat.

### Tier 3 — Cross-connector workflows ★ THE WEDGE
These need *one operator with shared context across tools* — exactly what's underserved today.
- **Slack → Linear action items:** watch a channel, detect action items / bugs, file Linear issues
  with the right team/labels, post back the link. (High frequency, painful, demos beautifully.)
- **Incident companion:** Sentry alert → search Slack for related discussion → identify owning team
  → open Linear issue → post a summary back to the incident channel.
- **Status synthesizer:** Linear movement + Slack decisions + (later) commits → write the weekly
  status update into Confluence and announce in Slack.
- **Customer signal router:** request in Slack/Gmail → log to CRM (HubSpot/Salesforce) → create a
  Linear feature request → reply with the tracking link.

### Tier 4 — Autonomous / scheduled (needs memory + durability + guardrails)
- Runs on a schedule, remembers what it did last time, only acts on deltas.
- This is where Pi's **state management** and our **persistent memory** earn their keep.

### Recommendation for v0
Pick **one Tier-3 wedge: "Slack → Linear action items."** It is high-frequency, obviously valuable,
exercises read+write across two connectors, and forces us to build memory ("did I already file
this?"). It is the smallest thing that proves the whole thesis.

---

## 2. TRADEOFF DOC A — Where the agent runs (the sandbox)

### The options
| | A. Cloudflare Workers + Durable Objects | B. Containers (Docker / Fly / Modal) | C. Local-first, then host |
|---|---|---|---|
| Per-agent isolation | ✅ Excellent (DO per agent) | ✅ Good (container per agent/user) | ⚠️ One process, your laptop |
| Durable state / memory | ✅ Built into DO + hibernation | 🔨 You add (Postgres/Redis/volume) | 🔨 Local file/SQLite |
| Hibernate / wake cheaply | ✅ First-class | ⚠️ Scale-to-zero varies by host | n/a |
| **Runs Pi as-is (Node + bash/fs)** | ❌ **See gotcha below** | ✅ Yes, plain Node | ✅ Yes |
| Long-running tasks (minutes+) | ⚠️ CPU/time limits unless container | ✅ Yes | ✅ Yes |
| Multi-tenant security | ✅ Strong isolation primitives | ✅ Good with discipline | ❌ Not for prod |
| Ops burden | ✅ Low (serverless) | ⚠️ Medium (you run it) | ✅ None |
| Dev velocity (today) | ⚠️ Workers constraints slow iteration | ✅ Normal Node DX | ✅ Fastest |
| Cost at idle | ✅ ~0 | ⚠️ Depends | ✅ 0 |

### ⚠️ The gotcha that decides this
**Pi's core tools are Read / Write / Edit / Bash — Bash and a filesystem.** Plain Cloudflare
Workers/DO run V8 JS with **no bash and no real filesystem.** So "Pi on Cloudflare Workers" does
**not** run Pi's core unchanged. Two honest sub-paths:
- **CF Sandbox SDK** (Cloudflare's *container* product) gives you bash+fs — but then you're on
  containers anyway, just Cloudflare-flavored.
- **Pi with bash/fs disabled** — if a connector-only agent never needs bash, you *can* run a trimmed
  Pi loop in a Worker/DO. But you lose much of Pi's skill ecosystem (skills assume a filesystem),
  which erodes the reason to use Pi at all.

**Translation:** Cloudflare is excellent for the *orchestration + memory + hibernation* layer, but
the *execution sandbox* wants a container. Don't pick CF expecting to skip containers.

### Recommendation
**Start C (local-first) → graduate to B (containers).** Treat Cloudflare DO as an *optional later
upgrade* for the durable-state/hibernation layer once the product is proven — not a v0 commitment.
Rationale: Pi runs unchanged, dev velocity is highest, and we don't pay the bash/fs tax while the
thesis is still unproven.

---

## 3. TRADEOFF DOC B — How connectors get tools & auth

### The options
| | A. Managed MCP (Composio / Klavis) | B. Native Pi extensions | C. Hybrid |
|---|---|---|---|
| Time to first 3 connectors | ✅ Days | ❌ Weeks (per-connector OAuth) | ⚠️ Medium |
| Breadth available | ✅ 500+ tools instantly | ❌ Only what you build | ✅ 500+ tail + custom core |
| OAuth token storage/refresh | ✅ Vendor handles it | 🔨 You build & secure | Mixed |
| **Who holds the user's keys** | ⚠️ **Third party** (see below) | ✅ You | Mixed |
| Reliability / control | ⚠️ Vendor-dependent | ✅ Full control | Mixed |
| Data residency / compliance | ⚠️ Data flows through vendor | ✅ Stays with you | Mixed |
| Lock-in | ⚠️ Some | ✅ None | ⚠️ Partial |
| Maintenance when APIs change | ✅ Vendor's problem | 🔨 Yours | Mixed |

### ⚠️ The security consideration that decides this
Managed MCP providers **store the user's OAuth tokens** — i.e. a third party holds the keys to the
user's Slack/Linear/Confluence, and tool calls route through them. Per our org security guidelines,
**new external integrations + secrets handling + anything holding customer credentials warrants a
security review**, and customer data shouldn't flow through external services without an explicit
DPA. This doesn't kill option A — it means: for any *production / customer-facing* deployment,
managed-MCP must clear security review first. For a personal/internal demo, it's fine.

### Recommendation
**Start A (managed MCP) for v0 velocity, plan for C (hybrid).** Get Slack + Linear working in days
via Composio/Klavis to prove the loop. Before anything customer-facing, rewrite the 2–3 critical
connectors as native Pi extensions (so *we* hold those tokens) and keep managed MCP only for the
long tail. Flag the managed-MCP dependency for security review the moment this stops being a demo.

---

## 4. Net recommended v0 path

1. **Use case:** Slack → Linear action items (Tier 3 wedge).
2. **Runtime:** Local-first Pi (`pi-agent-core`), containerize next.
3. **Connectors:** Managed MCP (Composio/Klavis) for Slack + Linear.
4. **Memory:** Start with Pi state + a simple store ("have I filed this already?").
5. **Config:** Draft the `agent.yaml` contract — the real product surface.

Open decisions still owned by the user: confirm runtime path (A/B/C) and connector path (A/B/C)
from the docs above; choose whether v0 wedge is Slack→Linear or another Tier-3 flow.
