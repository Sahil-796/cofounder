# Cofounder App — Build Plan (v1)

> Contract document for all build agents. Read `cofounder-ideation.md` first for product vision.
> Date: 2026-07-02. Target: working Tauri 2 desktop app on macOS (darwin arm64).

## 0. Verified facts about the local Hermes install (DO NOT re-research; verify only if something fails)

- Hermes Agent v0.17.0 installed at `/Users/sahil/.hermes/hermes-agent` (source readable — use it as ground truth).
- `hermes` binary at `/Users/sahil/.local/bin/hermes`.
- `hermes serve --port 9119` = headless backend (JSON-RPC/WebSocket gateway the official desktop app uses). `--skip-build` skips npm build of the bundled dashboard. `--status` / `--stop` manage it.
- **Loopback bind (127.0.0.1) requires NO auth** (see `should_require_auth` in `hermes_cli/web_server.py:388`).
- REST API (FastAPI, `hermes_cli/web_server.py`, 14k lines): `/api/status`, `/api/profiles` (GET/POST), `/api/profiles/{name}/soul` (GET/PUT), `/api/profiles/{name}/model` (PUT), `/api/profiles/{name}/description` (PUT), `/api/skills` (GET/POST), `/api/skills/content` (GET/PUT), `/api/skills/toggle`, `/api/sessions`, `/api/sessions/{id}/messages`, `/api/sessions/search`, `/api/cron/jobs` (full CRUD + trigger/pause/resume), `/api/mcp/servers` (CRUD + test + catalog), `/api/fs/list|read-text|write-text`, `/api/files/*`, `/api/config`, `/api/memory`, `/api/model/options|set`, `/api/analytics/usage`.
- WebSocket `/api/ws`: JSON-RPC 2.0 (`{"jsonrpc":"2.0","id":N,"method":"...","params":{...}}`). Dispatch in `tui_gateway/server.py` (methods registered via `@method("name")`), WS adapter in `tui_gateway/ws.py`. Key methods: `session.create`, `session.resume`, `session.list`, `session.history`, `session.status`, `session.interrupt`, `session.close`, `session.delete`, `session.title`, `session.usage`, `prompt.submit`, `prompt.background`, `approval.respond`, `clarify.respond`, `agents.list`, `spawn_tree.list`, `delegation.status`, `subagent.interrupt`, `cron.manage`, `skills.manage`, `skills.reload`, `config.get/set`, `model.options`, `commands.catalog`, `file.attach`, `image.attach`.
- Server → client push frames: `{"jsonrpc":"2.0","method":"event","params":{"type":"<event>","session_id":...}}`. Event types include `gateway.ready`, streaming text/tool events, `subagent.start|text|tool|thinking|complete`. Read `tui_gateway/ws.py` (`_STREAMING_EVENT_TYPES`) and `tui_gateway/server.py` for exact names/payloads.
- The official React dashboard source is at `/Users/sahil/.hermes/hermes-agent/web/` — **crib client patterns from there** (how it opens `/api/ws`, submits prompts, renders streams). The desktop app is at `apps/desktop/`.
- Profiles: `~/.hermes/profiles/<name>/` with own config/skills/memory/state.db. Kanban CLI: `hermes kanban --help` (multi-profile board, SQLite at `~/.hermes/kanban.db`).
- Cofounder profile home will be `~/.hermes/profiles/cofounder/`.

## 1. Architecture

```
┌────────────────────────────── Tauri 2 shell (Rust, minimal) ──────────────────┐
│  - tauri-plugin-shell: spawn/attach `hermes serve --port 9119 --skip-build`   │
│  - health-check loop; expose sidecar status via Tauri command                 │
│  ┌──────────────────── React 18 + TS + Vite + Tailwind ────────────────────┐  │
│  │  src/lib/hermes/   REST + WS JSON-RPC client (typed)                    │  │
│  │  src/lib/cofounder/ bootstrap (profile+skills+workspace), roles data    │  │
│  │  src/state/        zustand stores (connection, sessions, chat, tasks)   │  │
│  │  src/views/        Canvas (org map) + RightPanel (Home/Cofounder/...)   │  │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
                     HTTP/WS → http://127.0.0.1:9119
```

No Python is written or forked. The app is a Hermes client + a bootstrapper of text assets (profile, SOUL.md, SKILL.md files, workspace folders) exactly as `cofounder-ideation.md` §2/§9 prescribes.

## 2. Repo layout (this repo: /Users/sahil/work/cofounder)

```
app/                      # Tauri app (npm create tauri-app style, pnpm/npm)
  src/                    # React frontend
    lib/hermes/           # client.ts (REST), ws.ts (JSON-RPC over WS), types.ts, events.ts
    lib/cofounder/        # bootstrap.ts, roles.ts, connectors.ts (imports ../../core assets via ?raw)
    state/                # zustand: connection.ts, chat.ts, tasks.ts, org.ts
    views/                # CanvasView, RightPanel, tabs
    components/
  src-tauri/              # Rust shell (sidecar spawn + single window)
core/                     # Cofounder domain assets (plain text, no build deps)
  orchestrator/SOUL.md    # orchestrator system prompt (~200 lines) per ideation §4
  skills/<role>/SKILL.md  # marketing, research, support, operations, finance
  workspace-template/     # folder skeleton + seed .md files per ideation §5
  connectors.json         # suggested MCP connectors per role
PLAN.md                   # this file
cofounder-ideation.md     # product vision
```

## 3. Task breakdown & contracts

### Task A — Scaffold + Hermes client + sidecar (owner: agent A)
1. Scaffold Tauri 2 app in `app/` (React + TS + Vite + Tailwind v4, npm). App id `co.cofounder.app`, window 1600x1000, dark background `#111214`, title "Cofounder".
2. Rust: on launch, check `GET http://127.0.0.1:9119/api/status`; if down, spawn `hermes serve --port 9119 --skip-build --no-open`-equivalent (serve has no --no-open; it's headless already) via tauri-plugin-shell using `/Users/sahil/.local/bin/hermes` with PATH fallback. Kill on app exit ONLY if we spawned it. Tauri command `sidecar_status()`.
3. `src/lib/hermes/`: typed REST client (fetch wrapper, base URL configurable, default `http://127.0.0.1:9119`), WS JSON-RPC client with: id correlation, request timeout, event subscription (`onEvent(type, cb)`), auto-reconnect w/ backoff, connection state observable. Cover at minimum: session.create/resume/list/history/interrupt, prompt.submit, approval.respond, clarify.respond, agents.list, spawn_tree.list, delegation.status. Crib payload shapes from `/Users/sahil/.hermes/hermes-agent/web/` and `tui_gateway/server.py` — do not guess.
4. Minimal functional chat proof: a dev-only `/debug` route with a plain chat box that creates a session on the `cofounder` profile (param on session.create — check how profile_home/profile_name is passed) and streams a reply. This proves the pipe before UI lands.
5. `npm run build` and `cargo check` (in src-tauri) must pass. Vite dev server must run standalone in a plain browser (guard Tauri APIs behind `window.__TAURI__` checks) so UI can be tested without the Rust shell.

### Task B — Cofounder core assets + bootstrap (owner: agent B) — parallel with A
1. `core/orchestrator/SOUL.md`: orchestrator prompt implementing ideation §4 exactly — classify (question/command/context), complexity estimate (inline <2min / micro-task 2-15min / back-ask / plan+execute), back-asking rules table, task hierarchy, delegation to role agents via `delegate_task`, workspace conventions (§5), decision log to `.cofounder/decisions.md`.
2. `core/skills/{marketing,research,support,operations,finance}/SKILL.md` with YAML frontmatter (name, description, triggers) matching Hermes skill format — verify format from `~/.hermes/skills/` examples or `hermes skills --help`. Each: role charter, tools to prefer, workspace folder conventions, output formats (.md/.csv/.json), when to hand back to orchestrator.
3. `core/workspace-template/`: folders marketing/ sales/ operations/ research/ shared/ .cofounder/ with seed README.md + decisions.md + learnings/.
4. `core/connectors.json`: per-role suggested MCP connectors (name, why, hermes mcp catalog id if present — check `GET /api/mcp/catalog` shape in web_server.py) e.g. research→browser/web-search built-ins, support→CRM/ticketing, finance→Stripe/QuickBooks, marketing→GA/Mailchimp, ops→google-workspace.
5. `core/bootstrap.md`: exact idempotent sequence of REST calls to set up the `cofounder` profile: POST /api/profiles {name}, PUT soul, install skills (check whether /api/skills targets active profile or accepts profile param — read web_server.py; if profile-scoped writes are awkward, write skill files directly via /api/fs/write-text into ~/.hermes/profiles/cofounder/skills/), create workspace folder (ask-user path, default ~/Cofounder-Workspace), write template files, PUT profile description + model. Document each call with method/path/body/expected response so Task C/D can implement `bootstrap.ts` mechanically.
No app/ dependency — plain text only.

### Task C — UI per screenshot (owner: agent C, after A)
Reference screenshot description (app.cofounder.co): dark theme (#111214 bg), two zones:
- LEFT (~55%): infinite canvas org map. Center node "Cofounder" (card w/ sunflower emoji 🌻), radial dashed circle, role nodes on the ring: Sales, Operations, Marketing, Finance, Design, Legal, Support, Engineering — each a small pill with emoji + label; artifact/document mini-cards clustered near some roles; subtle dot-grid background; zoom/pan (use `d3-zoom` or hand-rolled transform, no heavy graph lib); bottom-center "+" button; top bar: profile chip (SP ▾ "cofounder"), Upgrade pill, theme/map/search icons; bottom-left notification bell.
- RIGHT (~45%): rounded panel with tab bar: Home | Cofounder | Company | Tasks | Library.
  - Home: serif greeting "Good evening, Sahil" (time-aware, name from config), roadmap banner card (starry-sky gradient image or CSS gradient art, "Cofounder Roadmap", progress % + chevron), TASKS section (list w/ status dot, agent avatar, title, age — wire to session.list/spawn_tree of cofounder profile), SUGGESTED NEXT list (from a static roles-driven suggestions module for v1, refresh icon), ARCHIVED TASKS section, bottom chat composer: "Cofounder" chip + placeholder "Ask Cofounder anything about your company…", plus "+" attach and send buttons.
  - Cofounder tab: chat thread UI with streaming (wire to ws client from Task A; render text deltas, tool-call chips, approval/clarify prompts as inline action cards).
  - Company: workspace browser (fs/list + read-text over the workspace root) + org roles grid.
  - Tasks: board view of delegation/spawn_tree + kanban (read-only v1 ok).
  - Library: skills list (GET /api/skills) + memory summary (GET /api/memory).
- First-run: if `cofounder` profile missing → onboarding flow (company name, founder name, workspace folder) that runs bootstrap per `core/bootstrap.md` (implement `src/lib/cofounder/bootstrap.ts`).
Quality bar: use the frontend-design skill sensibilities — this must look like the screenshot, not a Bootstrap admin panel. Typography: serif display (e.g. 'Instrument Serif' or Georgia fallback) for greeting, Inter/system for UI. Everything keyboard-accessible, loading/empty states for every list.

### Task D — Integration + verify (owner: lead)
- Wire C onto A's client + B's assets, run vite in browser, screenshot-compare against reference, run `cargo tauri dev` smoke, fix, iterate.

## 4. Conventions
- TypeScript strict; zustand for state; no redux; Tailwind v4; no UI kit (hand-rolled to match design).
- All Hermes calls go through `src/lib/hermes/` — no raw fetch in components.
- Keep Rust to sidecar + window only.
- Do not modify anything under `~/.hermes` except via the app's own bootstrap flow when the user runs it.
- Commit nothing; repo hygiene handled by lead.
