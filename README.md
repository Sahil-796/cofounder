# Cofounder 🌻

**Your full company in software.** Cofounder gives a startup founder a complete AI business team — marketing, research, support, operations, and finance — as specialized agents that learn and improve with the company over time.

Built as a lightweight **Tauri 2** desktop app on top of [Hermes Agent](https://hermes-agent.nousresearch.com) (not a fork — a pure client). Hermes provides the agent loop, tools, skills, memory, delegation, cron, and MCP integrations; Cofounder provides the orchestrator brain, the role agents, the shared workspace convention, and the UI.

![Architecture](#architecture)

## What you get

- **Cofounder orchestrator** — classifies everything you say (question / command / context), estimates complexity, and silently picks the right behavior: answer directly, do it inline, delegate a micro-task, or back-ask and plan a full initiative. You never think about task granularity.
- **Five role agents** (Hermes skills): `marketing`, `research`, `support`, `operations`, `finance` — each with a charter, preferred tools, and workspace conventions.
- **Shared workspace** (`~/Cofounder-Workspace` by default) — the company's system of record: `.md` docs, `.csv`/`.json` trackers, per-role folders, plus `.cofounder/decisions.md` (decision log) and `.cofounder/learnings/`.
- **Desktop UI** — canvas org map + a five-tab panel:
  - **Home** — greeting, roadmap, live tasks, suggested next actions, quick composer
  - **Cofounder** — streaming chat with tool-call chips, inline clarify/approval cards, interrupt
  - **Company** — workspace file browser + roles/connector grid
  - **Tasks** — Running / Waiting / Done board from Hermes delegation state
  - **Library** — installed skills + memory providers

## Requirements

- macOS (tested), [Hermes Agent](https://hermes-agent.nousresearch.com) installed (`hermes` on PATH or at `~/.local/bin/hermes`) with a model configured (`hermes model`)
- Node 20+, Rust toolchain (for building the Tauri shell)

## Run it

```bash
cd app
npm install
npm run tauri dev     # desktop app (spawns `hermes serve` automatically if not running)
# or frontend-only in a browser:
npm run dev           # http://localhost:1420 (proxies the backend, start it with: hermes serve --port 9119 --skip-build)
```

First launch shows onboarding (your name, company, workspace folder), then bootstraps everything idempotently over the Hermes REST API: the `cofounder` profile, its orchestrator SOUL.md, the five role skills, and the workspace skeleton.

## Repo layout

```
app/            Tauri 2 app — React 18 + TS + Vite + Tailwind v4
  src/lib/hermes/     typed REST + WebSocket JSON-RPC client for hermes serve
  src/lib/cofounder/  bootstrap, roles, config
  src/views/          canvas, tabs, onboarding
  src-tauri/          minimal Rust shell (sidecar spawn + http plugin + mkdir)
core/           Source of truth for domain assets (synced into app/src/assets at build)
  orchestrator/SOUL.md      the orchestrator system prompt
  skills/<role>/SKILL.md    the five role agents
  workspace-template/       workspace folder skeleton + seed files
  connectors.json           suggested MCP connectors per role
  bootstrap.md              the exact idempotent REST bootstrap sequence
PLAN.md         build plan + verified Hermes protocol facts
cofounder-ideation.md   product vision & design decisions
```

## Architecture

```
┌───────────── Cofounder (Tauri 2) ─────────────┐
│ React UI ── typed client ── REST /api/*       │
│                        └── WS /api/ws (JSON-  │
│ Rust shell: spawns/attaches   RPC + streaming)│
│ `hermes serve --port 9119`                    │
└───────────────────────┬───────────────────────┘
                        ▼ 127.0.0.1:9119
┌──────────────── Hermes Agent ─────────────────┐
│ agent loop · tools · skills · profiles ·      │
│ memory · delegation · kanban · cron · MCP     │
│ profile: ~/.hermes/profiles/cofounder/        │
└───────────────────────────────────────────────┘
```

Hard-won integration notes (verified against Hermes v0.17.0 source):

- `hermes serve` is the headless JSON-RPC/WebSocket backend the official desktop app uses. **REST needs `Authorization: Bearer <session token>` even on loopback**; the token is scraped from the hermes-served index page. WS authenticates via `?token=`.
- Hermes's auth middleware 401s CORS preflights, so browser dev routes through a Vite same-origin proxy (`/hermes-api`), and the Tauri build uses the HTTP plugin (Rust-side fetch, no CORS), scope-limited to `127.0.0.1:9119`.
- Hermes scans SOUL.md/context files for prompt-injection patterns and silently blocks them (`[BLOCKED: ...]` as system prompt). Keep orchestrator/skill prose clear of phrases like "pretend you are…" — the assets in `core/` are scanner-clean.
- `session.create {profile: "cofounder"}` binds the session to the profile home; note `info.profile_name` reports the backend's *launch* profile, not the session's — don't use it for detection.
