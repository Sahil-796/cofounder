# Cofounder Bootstrap Sequence

Precise, idempotent HTTP call sequence to set up the `cofounder` Hermes
profile against `http://127.0.0.1:9119`. Written for mechanical
implementation in `app/src/lib/cofounder/bootstrap.ts`. Every field name
below is taken directly from the Pydantic request models / handler code in
`/Users/sahil/.hermes/hermes-agent/hermes_cli/web_server.py` (line numbers
as of the v0.17.0 checkout read for this task — re-grep if the file has
moved). No auth headers are required for loopback (127.0.0.1) — see
`should_require_auth` in that file, line 388.

All requests use `Content-Type: application/json` and JSON bodies. All
paths below are relative to `http://127.0.0.1:9119`.

---

## Step 0 — Preconditions

Confirm the server is up before anything else:

```
GET /api/status
```
Expected: HTTP 200. If connection refused, the Tauri shell must spawn
`hermes serve --port 9119 --skip-build` first (Task A's job) — bootstrap.ts
should not attempt to start the server itself.

---

## Step 1 — Create the `cofounder` profile

```
POST /api/profiles
Body: { "name": "cofounder" }
```

Field source: `ProfileCreate` (web_server.py:10611) — only `name` is
required; every other field (`clone_from`, `clone_from_default`,
`clone_all`, `no_skills`, `description`, `provider`, `model`,
`mcp_servers`, `keep_skills`, `hub_skills`) is optional and best-effort.

**Do not set `no_skills: true`.** Leaving it `false` (default) means
`create_profile_endpoint` calls `profiles_mod.seed_profile_skills(path,
quiet=True)` (web_server.py, inside `POST /api/profiles`, the `if not
clone:` branch) after creating the directory, which seeds Hermes's normal
bundled skill categories (apple, research, email, etc. — see
`~/.hermes/skills/`) into the new profile. This is desired: Cofounder's
five custom role skills (Step 3 below) are additive on top of the bundled
set, not a replacement — e.g. Research should still have access to the
bundled `research/arxiv` and `research/blogwatcher` skills referenced in
`core/skills/research/SKILL.md`.

Do not pass `description`, `provider`, or `model` here — those are set in
their own dedicated steps below so each step is independently retriable.

**Expected response:** HTTP 200, body includes at least
`{"name": "cofounder", "path": "...", ...}` (exact shape depends on
`profiles_mod.create_profile` return + best-effort blocks below it in the
handler — treat any 2xx with a `path` field as success).

**Idempotency — skip if:** `GET /api/profiles` returns a profile whose
`name` (case-insensitive; see `normalize_profile_name`,
hermes_cli/profiles.py:284) equals `cofounder`. If so, skip this step
entirely — do not call POST again; `profiles_mod.create_profile` raises
`FileExistsError` → HTTP 400 `"Profile 'cofounder' already exists at ..."`
if it already exists, which bootstrap.ts should treat as "already done,"
not a failure, but checking first avoids the round trip and the log noise.

```
GET /api/profiles
```
Expected: `{"profiles": [{"name": "...", ...}, ...]}` (`_profile_to_dict`
shape). Check for an entry with `name == "cofounder"`.

---

## Step 2 — Write the orchestrator SOUL.md

```
PUT /api/profiles/cofounder/soul
Body: { "content": "<full text of core/orchestrator/SOUL.md>" }
```

Field source: `ProfileSoulUpdate` (web_server.py:10643) — single field
`content: str`. Handler (`update_profile_soul`, ~line 11145) does
`soul_path.write_text(body.content, encoding="utf-8")` where `soul_path =
_resolve_profile_dir("cofounder") / "SOUL.md"` — a full overwrite, no
merge.

**Expected response:** HTTP 200, `{"ok": true}`.

**Idempotency — skip if:** `GET /api/profiles/cofounder/soul` returns
`{"content": "<same text>", "exists": true}` — i.e. the file already holds
byte-identical content to `core/orchestrator/SOUL.md`. Because this is a
full overwrite, it is always safe to re-run (not just skip-safe) — re-run
whenever `core/orchestrator/SOUL.md` changes and you want to push an
update to an already-bootstrapped profile.

```
GET /api/profiles/cofounder/soul
```
Expected: `{"content": "...", "exists": true|false}`.

---

## Step 3 — Install the five role skills

**Chosen path: `POST /api/skills` with `profile: "cofounder"`, not raw
`/api/fs/write-text`.** Rationale:

1. `POST /api/fs/write-text` (web_server.py:1904, `FsWriteText { path,
   content }`) explicitly requires the parent directory to already exist —
   `"if not target.parent.is_dir(): raise HTTPException(400, 'Parent
   directory does not exist')"` (web_server.py:1929) — and there is **no**
   `/api/fs/mkdir` endpoint (confirmed: only `list`, `read-text`,
   `write-text`, `read-data-url`, `git-root`, `default-cwd` exist under
   `/api/fs/*`). Writing `~/.hermes/profiles/cofounder/skills/marketing/
   SKILL.md` via raw fs write would require some other mechanism to create
   `skills/marketing/` first, which does not exist as an endpoint.
2. `POST /api/skills` (web_server.py:11414, `SkillCreate { name, content,
   category, profile }`) calls `_create_skill` (tools/skill_manager_tool.py:776),
   which does `skill_dir.mkdir(parents=True, exist_ok=True)`
   (line 806) — it creates the directory tree itself, validates the
   name/category/frontmatter, checks for collisions, and runs a security
   scan, rolling back on failure. This is strictly safer and handles the
   directory-creation gap `/api/fs/write-text` leaves open.
3. `profile` is a genuine field on `SkillCreate` and is honored via
   `_profile_scope(body.profile)` (web_server.py:11421), which retargets
   the skill-manager module's `SKILLS_DIR` global for the duration of the
   request (see the docstring on `_profile_scope`, web_server.py:11244–11264,
   for why this retargeting is necessary — `SKILLS_DIR` is bound at import
   time and would otherwise always point at the dashboard's own active
   profile).

For each of the 5 roles, issue:

```
POST /api/skills
Body: {
  "name": "<role>",
  "content": "<full text of core/skills/<role>/SKILL.md>",
  "category": "cofounder",
  "profile": "cofounder"
}
```

Roles: `marketing`, `research`, `support`, `operations`, `finance`.

Field source: `SkillCreate` (web_server.py:11367-11371) — `name: str`,
`content: str`, `category: Optional[str]`, `profile: Optional[str]`.
`category: "cofounder"` groups all five role skills under
`~/.hermes/profiles/cofounder/skills/cofounder/<role>/SKILL.md`
(`_resolve_skill_dir`, tools/skill_manager_tool.py:562-566: `SKILLS_DIR /
category / name` when category is set) — this keeps them visually grouped
and distinguishable from Hermes's bundled skill categories (apple,
research, email, ...) seeded in Step 1, while avoiding a name collision
with the bundled `research` skill *category* (Hermes's bundled `research/`
is a category directory containing `arxiv`, `blogwatcher`, etc.; Cofounder's
`research` is a single skill name — using `category: "cofounder"` for our
five means the skill directory is `skills/cofounder/research/SKILL.md`,
distinct from the bundled `skills/research/` category, so there is no path
collision).

**Expected response:** HTTP 200, `{"success": true, ...}` (shape from
`_create_skill`'s success branch, tools/skill_manager_tool.py — includes at
least the skill's resolved path).

**Idempotency — skip if:** the skill already exists. `_create_skill` checks
`_find_skill(name)` (line 797) and returns `{"success": false, "error":
"A skill named '<name>' already exists at <path>."}` with **HTTP 400** if
so — bootstrap.ts must treat this specific 400 (error string containing
"already exists") as "already installed," not a failure. To check
proactively instead of relying on the error string:

```
GET /api/skills/content?name=<role>&profile=cofounder
```
Expected: HTTP 200 with `{"name", "content", "path"}` if it exists, HTTP
404 if not. If 200, skip the `POST /api/skills` call for that role. If you
want to push an update to an existing skill's content (e.g. after editing
`core/skills/<role>/SKILL.md`), use the update path instead of create:

```
PUT /api/skills/content
Body: { "name": "<role>", "content": "<new text>", "profile": "cofounder" }
```
Field source: `SkillContentUpdate` (web_server.py:11374-11376). Full
overwrite via `_edit_skill`; HTTP 404 if the skill doesn't exist yet (in
which case fall back to `POST /api/skills`).

---

## Step 4 — Create the workspace root and template folders

The workspace root is **user-chosen** (ask at first run; default
`~/Cofounder-Workspace`). Call it `<workspace>` below.

**Constraint:** neither `/api/fs/write-text` nor any other REST endpoint
creates directories (see Step 3, point 1) — `write-text` only writes a file
into an *already-existing* parent directory. There is no REST-only way to
create an empty directory tree. Two implementation options for
`bootstrap.ts`:

- **(a) Tauri path (used in this app):** since the app is a Tauri shell
  with a Rust backend (Task A), use Rust's filesystem APIs (or a small
  `tauri-plugin-fs`-based command) to `mkdir -p` the folder tree, then use
  `/api/fs/write-text` only for the seed *files* (which auto-creates the
  tree's directories as a side effect of each file's parent already
  existing once you create directories in the right order — see below).
- **(b) Pure-REST fallback (no Tauri, e.g. `/debug` route in a browser):**
  exploit the fact that `/api/fs/write-text`'s only hard requirement is
  "immediate parent exists" — create files bottom-up is impossible without
  mkdir, so instead rely on `POST /api/skills`'s `mkdir(parents=True)`
  behavior is *not* reusable here (it's skill-specific). Pure REST cannot
  create arbitrary directories; **(a) is required** for a from-scratch
  workspace. If the workspace root already exists with the right
  subfolders (e.g. the founder created it manually or it's a re-run),
  pure REST file writes work fine.

Given (a) is required, the sequence (executed by the Rust/Tauri layer,
not raw HTTP, for the `mkdir` parts):

1. `mkdir -p <workspace>/{marketing,sales,operations,research,shared,.cofounder/learnings}`
2. For each folder, write its seed `README.md` via:
   ```
   POST /api/fs/write-text
   Body: { "path": "<workspace>/<folder>/README.md", "content": "<text of core/workspace-template/<folder>/README.md>" }
   ```
   Field source: `FsWriteText { path, content }` (web_server.py:1901-1903).
   Applies to `marketing/`, `sales/`, `operations/`, `research/`,
   `shared/`, `.cofounder/learnings/`.
3. Write the decisions log seed:
   ```
   POST /api/fs/write-text
   Body: { "path": "<workspace>/.cofounder/decisions.md", "content": "<text of core/workspace-template/.cofounder/decisions.md>" }
   ```

**Expected response per write:** HTTP 200, `{"ok": true, "path": "...",
"byteSize": N}` (web_server.py:1943-1944).

**Idempotency — skip if:** `GET /api/fs/read-text?path=<file>` returns HTTP
200 (file exists) — check before writing to avoid clobbering a founder's
edits to their own README/decisions files. Unlike SOUL.md and skills,
workspace seed files are **not** safe to blindly overwrite on every
bootstrap run, since the founder is expected to edit them directly. Only
write if the file is missing:
```
GET /api/fs/read-text?path=<workspace>/<folder>/README.md
```
404/`ENOENT`-shaped error → write it. 200 → skip.

For directory existence (to decide whether `mkdir -p` is a no-op), use:
```
GET /api/fs/list?path=<workspace>
```
Expected: `{"entries": [...]}` on success, or `{"entries": [], "error":
"ENOENT"}` if the workspace root doesn't exist yet (web_server.py:1861-1868)
— treat `error: "ENOENT"` as "must create," anything else present as
"already exists, check subfolders individually the same way."

---

## Step 5 — Write the profile description

```
PUT /api/profiles/cofounder/description
Body: { "description": "Cofounder orchestrator — your AI company" }
```

Field source: `ProfileDescriptionUpdate` (web_server.py:10651-10652) —
single field `description: str`. Handler (~line 11156) calls
`profiles_mod.write_profile_meta(profile_dir, description=text,
description_auto=False)` — `description_auto: false` is set so Hermes's
auto-describer (which periodically regenerates profile descriptions for
kanban routing) will not overwrite this text on its own sweep.

**Expected response:** HTTP 200, `{"ok": true, "description": "Cofounder
orchestrator — your AI company", "description_auto": false}`.

**Idempotency — skip if:** re-running this is always safe (full overwrite,
no side effects beyond the description field) — but to avoid a redundant
call, `GET /api/config?profile=cofounder` includes profile metadata you can
inspect first, or simply always call it (cheap, idempotent by design).

---

## Step 6 — Model: leave as default

**Do not call** `PUT /api/profiles/cofounder/model`
(`ProfileModelUpdate { provider: str, model: str }`, web_server.py:10655-10657)
during bootstrap. Per the task spec, model stays whatever the newly created
profile inherits by default (Hermes's normal default-model resolution).
This endpoint exists and is documented here only so a future "let the
founder pick a model in onboarding" step has the exact contract:
```
PUT /api/profiles/cofounder/model
Body: { "provider": "<provider>", "model": "<model-id>" }
```
Both fields required; HTTP 400 if either is blank
(`web_server.py`, `update_profile_model_endpoint`, "provider and model are
required").

---

## Full sequence summary (for bootstrap.ts)

```
1.  GET  /api/status                                        → confirm server up
2.  GET  /api/profiles                                       → check "cofounder" exists
2b. POST /api/profiles              {name:"cofounder"}       → skip if step 2 found it
3.  GET  /api/profiles/cofounder/soul                         → check content matches
3b. PUT  /api/profiles/cofounder/soul  {content}              → always safe to re-run
4.  for role in [marketing, research, support, operations, finance]:
    GET  /api/skills/content?name=<role>&profile=cofounder    → check exists
    POST /api/skills  {name, content, category:"cofounder", profile:"cofounder"}  → if missing
    (or) PUT /api/skills/content {name, content, profile:"cofounder"}             → if updating
5.  [Rust/Tauri] mkdir -p <workspace>/{marketing,sales,operations,research,shared,.cofounder/learnings}
6.  for each seed file (5 README.md + decisions.md):
    GET  /api/fs/read-text?path=<file>                        → check exists
    POST /api/fs/write-text {path, content}                   → if missing
7.  PUT  /api/profiles/cofounder/description {description}    → always safe to re-run
    (model left at default — no call)
```

Steps 3–4 (SOUL + skills) can run in parallel with step 5–6 (workspace) —
they touch disjoint resources (`~/.hermes/profiles/cofounder/` vs
`<workspace>/`). Step 2b must complete before 3/3b and 4, since both write
into the profile directory step 1 creates. Step 7 can run any time after
step 2b.

---

## Onboarding v2 additions (implemented in bootstrap.ts)

The first-run flow is now a multi-step form (Onboarding.tsx):

1. **Welcome** → founder name.
2. **Workspace** → pick/create the workspace folder (default
   `~/Cofounder-Workspace`; created via `POST /api/files/mkdir`).
3. **Company context** (skippable but encouraged) → company/project name,
   one-line description, stage (`idea` / `building` / `launched` / `revenue`),
   industry/audience, and top 1–3 goals. Persisted to the local config store
   (`cofounder.config.v1`, `company` field) and written into the workspace.
4. **Bootstrap progress** → the step 1–7 sequence above, plus:

### Step 8 — Company profile → `shared/company.md`

Write structured markdown the agents read, derived from the step-3 answers.
Overwrite is safe (it's regenerated from onboarding input):
```
POST /api/fs/write-text
Body: { "path": "<workspace>/shared/company.md", "content": "<# Name / At a glance / What we do / Top goals>" }
```

### Step 9 — First decision-log entry → `.cofounder/decisions.md`

Append (do not overwrite) a first entry, idempotent by exact-line match:
```
GET  /api/fs/read-text?path=<workspace>/.cofounder/decisions.md   → read existing
POST /api/fs/write-text {path, content: existing + "\n- <date> — Company profile created during onboarding\n"}
```
If the line already exists, skip. If the file is missing, create it with a
`# Decision Log` header.

### Step 10 — Ensure `toolsets` in the profile config (kanban gate)

The `kanban_*` tools are gated behind the profile's `config.yaml` listing
`toolsets: [hermes-cli, kanban]`. Bootstrap makes this idempotent and
**surgical** — it reads the YAML text, and only rewrites when a required entry
is missing, preserving every other line:
```
GET  /api/fs/read-text?path=~/.hermes/profiles/cofounder/config.yaml
     → if no `toolsets:` line, insert `toolsets: [hermes-cli, kanban]` after the
       top-level `model:` block (or at the top).
     → if an inline `toolsets: [...]` line exists, merge in any missing required
       entries; leave block-list form untouched (don't risk corrupting edits).
POST /api/fs/write-text {path, content: <patched yaml>}   → only when changed
```
On a normal machine this is a no-op (the lead already added the line); it
exists so a from-scratch profile is self-sufficient. Both step 8–9 (workspace
writes) and step 10 (profile config) are non-fatal — a failure is reported as a
`skipped` step, not a hard error, since the app still functions without them.
