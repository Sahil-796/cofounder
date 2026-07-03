# Cofounder — Ideation & Design Decisions

> Captured 2026-06-30. This is the living design doc for the multi-role AI agent suite for startup founders, built on Hermes Agent.

---

## 1. Core Concept

**Cofounder** — an open-source multi-role AI agent suite on Hermes that gives startup founders a full business team (marketing, sales, ops, finance, HR, support) that learns and improves with their company over time.

Value prop: "Your full company in software." A founder runs every business function through specialized agents without hiring headcount.

---

## 2. Architecture Decision: Do NOT Fork Hermes

**Decision: Build on top of Hermes, not a fork. Dont know how to do this**

Rationale:
- Hermes is 13,748+ commits, 206k stars, 37.3k forks — massive project
- Maintaining a fork means perpetually merging upstream changes
- Forking provides no benefit: every extension point we need already exists

Would have to make an app which runs on top of it. 

**How we build on Hermes:**

| Layer | What we use |
|---|---|
| **Cofounder Orchestrator** | Hermes profile with custom system prompt + tools |
| **Role Agents** | Hermes skills (SKILL.md + tool references per role) |
| **Task Board** | Hermes built-in Kanban |
| **Delegation** | Hermes `delegate_task` built-in |
| **Shared Workspace** | File system directory per agent + Git-backed |
| **Integrations** | MCP servers configured in hermes config |
| **Cron / Recurring** | Hermes `cronjob` built-in |
| **Memory** | Hermes memory system |
| **UI** | Standalone app |

basically we need a new app working on top of hermes as a backbone.


Basically 
---

## 3. Hermes Architecture (for reference)

### Tech Stack
- **Python 3.11-3.13** — Core agent loop, tools, gateway, MCP client, cron
- **Entry point:** `hermes_cli.main:main` (packaged on PyPI as `hermes-agent`)
- **Desktop app** (`apps/desktop/`): Electron shell + React/TypeScript, bundles Python backend via subprocess IPC
- **Web dashboard** (`hermes_cli/web_dist/`): FastAPI backend + React SPA (Vite-built), served via `hermes dashboard`
- **TUI** (`hermes_cli/tui_dist/`): Ink/React terminal UI
- **MCP**: Built-in MCP client — connects stdio or HTTP MCP servers, auto-discovers tools
- **Gateway**: Message platform adapters for 20+ platforms

### Extension Points (in order of preference)
1. **Skills** — `~/.hermes/skills/*.md` — markdown loaded into agent context
2. **Profiles** — `~/.hermes/profiles/<name>/` — isolated config, skills, memory
3. **MCP Servers** — `~/.hermes/config.yaml` — connect external APIs as tools
4. **Plugins** — `~/.hermes/plugins/` — Python modules with plugin.yaml manifest
5. **Custom tools (core)** — only if none of the above work

---

## 4. Cofounder Orchestrator Design (Settled)

### Decision Tree

```
Founder says something
         │
         ▼
  ┌──────────────────┐
  │   CLASSIFY       │  ───  question / command / context
  └────────┬─────────┘
           │
     ┌─────┴──────┐──────┐
     ▼            ▼      ▼
  Question     Command   Context
  (answer,     (plan)    (save to memory,
   no task)              maybe suggest task)

           COMMAND ──► ┌─────────────────────────┐
                       │  ESTIMATE COMPLEXITY     │
                       │  Ask itself:             │
                       │  • < 2 min? → INLINE     │
                       │  • 2-15 min? → MICROTASK │
                       │  • 15min+ / vague?       │
                       │    → BACK-ASK + PLAN     │
                       └──────────────────────────┘
```

### Granularity Modes

| Classification | Effort | Behavior | User Sees |
|---|---|---|---|
| **Question** | N/A | Answer from context/memory | Direct answer |
| **Inline** | <2 min | Execute now, no ceremony | "Done. Sent that email." |
| **Micro-task** | 2-15 min | Auto-delegate, auto-resolve | "I'll draft an outline now. Here's the direction..." |
| **Back-ask** | Vague/big | Ask clarifying questions first | "What budget? Audience? Timeline?" |
| **Plan + Execute** | 15min+ | Show full plan, ask approval, then delegate | Full task breakdown with subtasks |

### Back-asking Rules

| Request Clarity | Complexity | Back-asks |
|---|---|---|
| Clear + simple ("send email to Acme") | Inline | None. Just do it. |
| Clear + medium ("write a blog post") | Micro-task | Brief confirmation: "I'll draft outline first draft, sound good?" |
| Clear + big ("build Q3 marketing campaign") | Big work | Full questions + plan shown. "What budget? Target audience? Timeline? Here's my plan..." |
| Vague ("improve our marketing") | Vague/big | Start with questions before planning: "What specifically? Content? Ads? SEO? What's the goal?" |
| Vague + small ("check if we have Acme emails") | Inline | Just do it. No questions. |

### Key Rule
**The founder never thinks about granularity.** They say what they need. The Cofounder decides if it's a 10-second inline action or a 3-week initiative.

### Task Hierarchy
```
Initiative (epic-level, multi-day)
  └── Task (defined outcome, tracked on board)
       └── Subtask (unit of work)
            └── Action (atomic, executed inline, not tracked)
```

---

## 5. Shared Workspace (Settled Concept)

Each role agent gets a folder for their artifacts. Real companies run on sheets + docs. For agents:

| Format | Human Analogy | How Agents Use It |
|---|---|---|
| `.md` files | Documents | Briefs, research notes, playbooks, documentation |
| `.csv` / `.json` | Sheets | Structured data — pipeline tracking, budgets, content calendars, competitive intel |
| `.md` + frontmatter | Database rows | Tasks, status, metadata |

### Proposed Structure

```
workspace/
├── marketing/
│   
├── sales/
│  
├── operations/
│   
├── research/                    # Dedicated research agent workspace
│   
├── shared/
│  
└── .cofounder/
    ├── decisions.md             # Log of key decisions made
    └── learnings/               # Accumulated context across sessions
```

Agents read/write to this workspace using Hermes file tools. And they can make md, csv etc in their own workspace. Ask user which folder to use as root for the whole workspace. 

---

## 6. Role Agents (Priority Order)

1. **Marketing Agent** — campaigns, content, SEO, brand, social, analytics
   - Key tools: browser (research), web search, social/xurl, MCP (Google Analytics, LinkedIn Ads, Mailchimp, etc.)
2. **Research Agent** — competitor analysis, market research, company intel, trends
   - Key tools: browser, web search, arxiv, blogwatcher, RSS, web scraping

3. **Customer Support Agent** — tickets, FAQs, triage, escalation
   - Key tools: gateway (multi-platform DM), email, knowledge base, ticket system MCP

4. **Operations Agent** — process, scheduling, reporting, calendar
   - Key tools: google-workspace, calendar, cron, kanban
5. **Finance Agent** — budgeting, invoicing, expense tracking
   - Key tools: MCP (QuickBooks, Stripe, Xero), sheets

basically implement this for now, with appropriate tools and also prompt for connects as and when required. Do some setup for that. suggest good connectors to use. EG support agent might need to connect to a CRM or ticketing system. research needs browser, web search etc. 

---

---

## 8. Open Questions & Next Steps

### Questions To Research
- How does Hermes web dashboard work internally? Can Cofounder extend it or needs its own web UI?
- What's the best way to scope memory per role agent?
  - Hermes already has profile-level memory. Role agents could each have their own profile.
- What's the IPC protocol between Electron desktop app and Python backend?


### Design Principles
- Founder never thinks about task granularity — Cofounder decides
- Small work → no ceremony, just do it
- Big work → back-ask + show plan before executing
- Agents get better with use (Hermes skill learning loop)
- Every agent reads/writes to shared workspace
- No black boxes — founders own their data, memory, and workflows


## 9. Hermes "Grow With You" System — How It Works

This is the actual mechanism behind the marketing claim. Here's every storage layer Hermes uses and what it stores:

### Filesystem Layout (~/.hermes/)

| Path | What It Stores | Persistence |
|---|---|---|
| `skills/` | Reusable procedures saved as SKILL.md files with YAML frontmatter | Forever (until curated/pruned) |
| `state.db` | All session transcripts (SQLite + FTS5) | Forever (searchable) |
| `config.yaml` | User settings, tool configs, MCP server definitions | Forever |
| `.env` | API keys and secrets | Forever |
| `auth.json` | OAuth tokens and credential pools | Forever (until revoked) |
| `profiles/<name>/` | Isolated config, skills, memory, sessions per profile | Forever |
| `plugins/` | Python plugin modules | Until removed |
| `cache/` | Temp data, model catalogs, screenshots | Ephemeral (can be cleared) |
| `logs/` | Gateway and error logs | Rolling |
| `sessions/` | Gateway routing index, request dumps | Until pruned |

### The Learning Loop

```
User corrects agent or agent discovers a pattern
         │
         ▼
  ┌─────────────────────┐
  │  1. SKILL SYNTHESIS │  ← agent saves a SKILL.md
  │                     │     with the correct approach
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  2. MEMORY SAVE     │  ← agent persists facts about
  │                     │     the user and environment
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  3. FUTURE SESSIONS │  ← skills + memory auto-load
  │     LOAD CONTEXT    │     in every new conversation
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  4. CURATOR         │  ← background maintenance:
  │                     │     archives stale skills,
  │                     │     consolidates overlapping ones
  └─────────────────────┘
```

### What This Means for Cofounder

Every role agent inherits this loop automatically because it's built into Hermes's engine:

| Cofounder Feature | Hermes Mechanic |
|---|---|
| Marketing agent remembers what subject lines worked | Skills → marketing agent saves "email patterns that convert" as a skill |
| Sales agent remembers prospect preferences | Memory → per-company context persists |
| Cofounder learns how you like decisions communicated | User profile → preference modeling |
| Task patterns get faster over time | Recurring tasks → cron + skill templates |
| Agents improve from corrections | Skill curation → curator consolidates improved approaches |

**Cofounder's additional storage** (on top of Hermes):

```
~/.hermes/profiles/cofounder/     ← the Cofounder profile (isolated from your personal Hermes)
  ├── config.yaml                 ← Cofounder-specific settings
  ├── skills/                     ← Cofounder's accumulated skills
  ├── memory/                     ← Company context, decisions, learnings
  └── workspace/                  ← Shared agent workspace (see section 5)
```

The workspace/ directory is the new layer we add — Hermes doesn't have this concept natively. It's a shared filesystem area where all role agents dump and read artifacts, structured as folders with .md, .csv, and .json files.

---

## 10. Hermes Architecture — Full Breakdown

### High-Level View

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SURFACES (Entry Points)                      │
│                                                                      │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │   CLI    │ │  TUI   │ │  DESKTOP │ │ DASHBOARD│ │  GATEWAY    │  │
│  │ (python) │ │ (ink)  │ │(electron)│ │(fastapi) │ │(telegram…)   │  │
│  └────┬─────┘ └───┬────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘  │
│       │          │          │          │            │              │
│       ▼          ▼          ▼          ▼            ▼              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    CORE ENGINE (Python)                        │ │
│  │                                                                │ │
│  │  ┌──────────────────────────────────────────────────────┐      │ │
│  │  │              AIAgent.run_conversation()              │      │ │
│  │  │              (conversation_loop.py)                  │      │ │
│  │  │                                                      │      │ │
│  │  │  1. Build messages[system + history + memory + skills]     │ │
│  │  │  2. Call LLM  ◄────────────────────────────────┐     │      │ │
│  │  │  3. tool_calls? ─yes→ dispatch() → append      │     │      │ │
│  │  │  4. text response? → return                    │     │      │ │
│  │  │  5. Compress if near token limit               │     │      │ │
│  │  │  6. Loop back ─────────────────────────────────┘     │      │ │
│  │  └──────────────────────────────────────────────────────┘      │ │
│  │                                                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │ │
│  │  │ PROMPT   │ │ MEMORY   │ │ CONTEXT  │ │  MODEL TOOLS    │  │ │
│  │  │ BUILDER  │ │ MANAGER  │ │ COMPRESS │ │ (tool dispatch)  │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┬─────────┘  │ │
│  │                                                   │            │ │
│  │  ┌──────────────────────────────────────────────────┐          │ │
│  │  │           TOOL REGISTRY (tools/registry.py)      │          │ │
│  │  │  Each tool is a self-registering Python file     │          │ │
│  │  └────┬──────────┬──────────┬──────────┬────────────┘          │ │
│  │       │          │          │          │                       │ │
│  │       ▼          ▼          ▼          ▼                       │ │
│  │  ┌────────┐┌────────┐┌────────┐┌────────────┐                 │ │
│  │  │terminal││browser ││web_    ││delegate_   │  … 50+ tools    │ │
│  │  │        ││        ││search  ││task        │                 │ │
│  │  └────────┘└────────┘└────────┘└────────────┘                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    EXTENSION SYSTEM                             │ │
│  │                                                                 │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │
│  │  │ SKILLS   │ │ PROFILES │ │ MCP      │ │ PLUGINS  │          │ │
│  │  │ (.md     │ │ (isolated│ │ SERVERS  │ │(python   │          │ │
│  │  │  prompts)│ │  config) │ │ (ext APIs)│ │ modules) │          │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    PERSISTENCE                                  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │
│  │  │state.db  │ │ memory   │ │ skills/  │ │ cron/    │          │ │
│  │  │(sessions)│ │ (facts)  │ │(proced.) │ │(schedule)│          │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### The Agent Loop (Simplified)

This is the heart of Hermes — `agent/conversation_loop.py`:

```
run_conversation(user_message):
  messages = [system_prompt] + conversation_history + [user_message]
  inject memory, skills, context files into system prompt
  
  while api_call_count < max_iterations:
    call LLM with messages + tool_definitions
    
    if response has tool_calls:
      for each tool_call:
        result = handle_function_call(name, args)  # dispatches to tool registry
        append {"role": "tool", content: result} to messages
      continue  # loop back, model sees tool results
    
    else:
      # model returned final text response
      return response
  
  return "exceeded max iterations"
```

### The Tool System

Each tool lives in its own `tools/<name>.py` file and self-registers:

```python
# tools/terminal.py
registry.register(
    name="terminal",
    toolset="terminal",
    schema={"name": "terminal", "description": "...", "parameters": {...}},
    handler=lambda args: run_command(args["command"]),
    check_fn=lambda: True,  # tool available?
)
```

`model_tools.py` imports all `tools/*.py` → they self-register → registry holds the full map → `handle_function_call()` dispatches by name.

### How Surfaces Connect to Core

| Surface | How it calls the agent | Language |
|---|---|---|
| **CLI** (`hermes`) | Direct: `AIAgent().run_conversation()` | Python |
| **TUI** (`hermes` with TUI) | Direct: `AIAgent()` via prompt_toolkit | Python (Ink/React overlay) |
| **Desktop** | Electron shell spawns Python as subprocess, IPC channel | TypeScript ↔ Python |
| **Dashboard** (`hermes dashboard`) | FastAPI route → spawn/control AIAgent | Python (FastAPI + React SPA) |
| **Gateway** (Telegram etc.) | Daemon thread runs AIAgent, dispatches messages | Python |
| **ACP** (IDE integration) | stdio protocol → AIAgent | stdio ↔ any IDE |

### Key Files

| File | Purpose | Lines |
|---|---|---|
| `run_agent.py` | `AIAgent` class definition | 5,650 |
| `agent/conversation_loop.py` | Main conversation loop (extracted from run_agent) | 4,899 |
| `agent/prompt_builder.py` | System prompt construction | ~1,500 |
| `model_tools.py` | Tool registry interface + dispatch | 1,255 |
| `tools/registry.py` | Tool self-registration system | 645 |
| `toolsets.py` | Tool grouping per platform | 940 |
| `hermes_state.py` | SQLite session store | ~3,000 |
| `cli.py` | Interactive CLI (prompt_toolkit) | ~5,000 |
| `hermes_cli/main.py` | CLI entry + subcommands | ~4,000 |

### Everything is Python. The Cofounder lives in text files.

The core is 50,000+ lines of Python. What you build for Cofounder is:
- **AGENTS.md** — the orchestrator system prompt (~200 lines)
- **SKILL.md** files — one per role agent (~100 lines each)
- **config.yaml** snippets — MCP server definitions (~10 lines each)
- **Workspace folder layout** — directory structure convention

That's the entire Cofounder codebase. The 50k lines of Python is already written and maintained by Nous Research.

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-30 | Don't fork Hermes, build on top | 13k+ commits, all extension points exist |
| 2026-06-30 | Cofounder uses classification + complexity estimation before acting | Differentiate inline/micro-task/big-work dynamically |
| 2026-06-30 | Back-ask before big or vague tasks | Real co-founder behavior — clarify before executing |
| 2026-06-30 | Role agents are skills + tool bundles, not separate codebases | Leverages Hermes's existing skill architecture |
| 2026-06-30 | Launch with Marketing + Research agents only | These drive revenue directly, biggest need for solo founders |
| 2026-06-30 | Open source code, don't worry about copying | If it booms, that's success |
| 2026-06-30 | Shared workspace is folder-based (.md, .csv, .json) | Agents read/write with existing file tools |
