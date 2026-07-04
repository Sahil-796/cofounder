/**
 * Cofounder profile bootstrap — implements the sequence in core/bootstrap.md
 * over the Hermes REST API. Idempotent and re-runnable: every step checks
 * before it writes and treats "already exists" as success.
 *
 * Deviation from core/bootstrap.md §4: that doc concluded directory creation
 * required a Tauri fs command because it predated the discovery of
 * `POST /api/files/mkdir` (web_server.py:1802), which creates directory trees
 * over pure REST (recursive, exist_ok, absolute + ~-expanded paths). We use
 * that endpoint, so bootstrap runs fully over REST — no Tauri dependency — and
 * therefore also runs from a plain browser during live-testing.
 *
 * Progress is reported step-by-step via the `onProgress` callback so the
 * onboarding UI can render a live checklist.
 */

import { hermesRest, HermesRestError } from "@/lib/hermes";
import {
  ROLE_SKILLS,
  SOUL_MD,
  WORKSPACE_DIRS,
  WORKSPACE_SEED_FILES,
} from "./assets";
import { STAGE_OPTIONS, type CompanyProfile } from "./config";
import { ROLES } from "./roles";

export const COFOUNDER_PROFILE = "cofounder";
const SKILL_CATEGORY = "cofounder";
const PROFILE_DESCRIPTION = "Cofounder orchestrator — your AI company";

/**
 * Role agents are REAL, separate Hermes profiles — not personas sharing the
 * orchestrator's profile. This matters structurally: the Hermes kanban
 * dispatcher only auto-spawns a ready task whose `assignee` resolves to an
 * actual profile on disk (`hermes_cli/kanban_db.py` — dispatch skips/parks
 * any assignee that isn't a real, spawnable profile). With a single shared
 * "cofounder" profile, every task's assignee was necessarily "cofounder"
 * itself — the orchestrator could never truly delegate, only do the work
 * inline while labeling it as a role. Giving each role its own profile
 * (`cofounder-<role>`) makes `kanban_create({assignee: "cofounder-marketing"})`
 * a genuine, independently-dispatchable worker, and makes each role's chat
 * tab a real session on that profile — delegated work shows up there because
 * it *is* that profile's own session history, not a client-side simulation.
 */
export const ROLE_PROFILE_PREFIX = "cofounder-";

/** The real Hermes profile name for a role id, e.g. "marketing" → "cofounder-marketing". */
export function roleProfileName(role: string): string {
  return `${ROLE_PROFILE_PREFIX}${role}`;
}

/** Path to a profile's config.yaml (~ is expanded by the backend). */
function profileConfigPath(profile: string): string {
  return `~/.hermes/profiles/${profile}/config.yaml`;
}

/** Toolsets every profile needs so kanban_* tools are available. */
const REQUIRED_TOOLSETS = ["hermes-cli", "kanban"];

export type BootstrapStepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface BootstrapStep {
  id: string;
  label: string;
  status: BootstrapStepStatus;
  detail?: string;
}

export interface BootstrapProgress {
  steps: BootstrapStep[];
}

export interface BootstrapOptions {
  workspaceRoot: string;
  founderName?: string;
  companyName?: string;
  /** Full company context from onboarding step 3 (optional / skippable). */
  company?: CompanyProfile;
  onProgress?: (p: BootstrapProgress) => void;
}

function isNotFound(err: unknown): boolean {
  return err instanceof HermesRestError && (err.status === 404 || err.status === 400);
}

/** True if `name` already exists in GET /api/profiles (case-insensitive). */
export async function profileExists(name: string): Promise<boolean> {
  try {
    const res = await hermesRest.profiles<{ profiles?: { name?: string }[] }>();
    return (res.profiles ?? []).some((p) => (p.name ?? "").toLowerCase() === name.toLowerCase());
  } catch {
    return false;
  }
}

/** True if `cofounder` already exists in GET /api/profiles (case-insensitive). */
export async function cofounderProfileExists(): Promise<boolean> {
  return profileExists(COFOUNDER_PROFILE);
}

/** Create a profile, tolerating "already exists" as success. Returns true if newly created. */
async function ensureProfileExists(name: string): Promise<boolean> {
  if (await profileExists(name)) return false;
  try {
    await hermesRest.createProfile(name);
    return true;
  } catch (err) {
    if (err instanceof HermesRestError && err.status === 400 && /already exists/i.test(err.body ?? "")) {
      return false;
    }
    throw err;
  }
}

/** Run the full bootstrap. Resolves when complete; throws on a hard failure. */
export async function runBootstrap(opts: BootstrapOptions): Promise<void> {
  const { workspaceRoot } = opts;
  const roles = Object.keys(ROLE_SKILLS);

  const steps: BootstrapStep[] = [
    { id: "status", label: "Connecting to backend", status: "pending" },
    { id: "profile", label: "Creating the Cofounder profile", status: "pending" },
    { id: "soul", label: "Installing the orchestrator brain", status: "pending" },
    { id: "skills", label: `Installing ${roles.length} role agents`, status: "pending" },
    { id: "workspace", label: "Setting up your company workspace", status: "pending" },
    { id: "seed", label: "Seeding workspace files", status: "pending" },
    { id: "company", label: "Writing your company profile", status: "pending" },
    { id: "roleProfiles", label: `Setting up ${roles.length} independent agent profiles`, status: "pending" },
    { id: "toolsets", label: "Enabling the task board", status: "pending" },
    { id: "description", label: "Finishing up", status: "pending" },
  ];

  const emit = () => opts.onProgress?.({ steps: steps.map((s) => ({ ...s })) });
  const set = (id: string, status: BootstrapStepStatus, detail?: string) => {
    const s = steps.find((x) => x.id === id);
    if (s) {
      s.status = status;
      if (detail !== undefined) s.detail = detail;
    }
    emit();
  };

  emit();

  // Step 0 — server up
  set("status", "running");
  const reachable = await hermesRest.reachable();
  if (!reachable) {
    set("status", "error", "Backend unreachable at 127.0.0.1:9119");
    throw new Error("Hermes backend is not reachable");
  }
  set("status", "done");

  // Step 1 — profile
  set("profile", "running");
  try {
    const created = await ensureProfileExists(COFOUNDER_PROFILE);
    set("profile", created ? "done" : "skipped", created ? undefined : "Profile already existed");
  } catch (err) {
    set("profile", "error", String(err));
    throw err;
  }

  // Step 2 — SOUL.md (full overwrite, always safe). Rendered with the
  // founder's actual workspace root so agents never fall back to a default.
  set("soul", "running");
  await hermesRest.putSoul(COFOUNDER_PROFILE, renderSoul(workspaceRoot));
  set("soul", "done");

  // Step 3 — the five role skills
  set("skills", "running");
  let installed = 0;
  let skippedSkills = 0;
  for (const role of roles) {
    let exists = false;
    try {
      await hermesRest.getSkillContent(role, COFOUNDER_PROFILE);
      exists = true;
    } catch (err) {
      if (!isNotFound(err)) {
        // Unexpected error probing — fall through and try to create anyway.
      }
    }
    if (exists) {
      skippedSkills++;
      continue;
    }
    try {
      await hermesRest.createSkill({
        name: role,
        content: ROLE_SKILLS[role],
        category: SKILL_CATEGORY,
        profile: COFOUNDER_PROFILE,
      });
      installed++;
    } catch (err) {
      if (
        err instanceof HermesRestError &&
        err.status === 400 &&
        /already exists/i.test(err.body ?? "")
      ) {
        skippedSkills++;
      } else {
        set("skills", "error", `${role}: ${String(err)}`);
        throw err;
      }
    }
  }
  set(
    "skills",
    "done",
    `${installed} installed${skippedSkills ? `, ${skippedSkills} already present` : ""}`,
  );

  // Step 4 — workspace directory tree (mkdir -p over REST)
  set("workspace", "running");
  await hermesRest.filesMkdir(workspaceRoot);
  for (const dir of WORKSPACE_DIRS) {
    await hermesRest.filesMkdir(joinPath(workspaceRoot, dir));
  }
  set("workspace", "done", workspaceRoot);

  // Step 5 — seed files (only write if missing; don't clobber founder edits)
  set("seed", "running");
  let wrote = 0;
  let keptSeed = 0;
  for (const [rel, content] of Object.entries(WORKSPACE_SEED_FILES)) {
    const full = joinPath(workspaceRoot, rel);
    let present = false;
    try {
      await hermesRest.fsReadText(full);
      present = true;
    } catch (err) {
      if (!isNotFound(err)) present = false;
    }
    if (present) {
      keptSeed++;
      continue;
    }
    await hermesRest.fsWriteText(full, content);
    wrote++;
  }
  set("seed", "done", `${wrote} written${keptSeed ? `, ${keptSeed} kept` : ""}`);

  // Step 6 — company profile: shared/company.md + a decisions.md entry.
  set("company", "running");
  try {
    const detail = await writeCompanyProfile(workspaceRoot, opts);
    set("company", "done", detail);
  } catch (err) {
    // Non-fatal — company context is optional; don't block bootstrap.
    set("company", "skipped", `skipped (${String(err).slice(0, 60)})`);
  }

  // Step 7 — each role's OWN Hermes profile, so kanban can genuinely
  // dispatch to it (see the ROLE_PROFILE_PREFIX comment above `runBootstrap`).
  set("roleProfiles", "running");
  try {
    const detail = await ensureRoleProfiles(roles, workspaceRoot, opts.companyName);
    set("roleProfiles", "done", detail);
  } catch (err) {
    set("roleProfiles", "error", String(err));
    throw err;
  }

  // Step 8 — ensure profile config has the toolsets kanban needs (idempotent,
  // surgical edit of config.yaml preserving the rest of the file).
  set("toolsets", "running");
  try {
    const changed = await ensureToolsetsForProfile(profileConfigPath(COFOUNDER_PROFILE));
    set("toolsets", changed ? "done" : "skipped", changed ? undefined : "already enabled");
  } catch (err) {
    // Non-fatal — the lead may have set this already; the app still works.
    set("toolsets", "skipped", `skipped (${String(err).slice(0, 60)})`);
  }

  // Step 9 — description (always safe)
  set("description", "running");
  try {
    await hermesRest.putDescription(COFOUNDER_PROFILE, PROFILE_DESCRIPTION);
  } catch {
    /* non-fatal — description is cosmetic */
  }
  set("description", "done");
}

/**
 * Write `shared/company.md` (structured markdown the agents read) from the
 * onboarding answers, and append a first entry to `.cofounder/decisions.md`.
 * Overwrites company.md (it's derived from onboarding, always safe to refresh)
 * but only *appends* the decisions entry once (idempotent by marker match).
 */
async function writeCompanyProfile(
  workspaceRoot: string,
  opts: BootstrapOptions,
): Promise<string> {
  const companyPath = joinPath(workspaceRoot, "shared/company.md");
  const today = new Date().toISOString().slice(0, 10);
  const c = opts.company;
  const name = (c?.name || opts.companyName || "").trim();
  const stageLabel = c?.stage
    ? (STAGE_OPTIONS.find((s) => s.id === c.stage)?.label ?? c.stage)
    : "";
  const goals = (c?.goals ?? []).map((g) => g.trim()).filter(Boolean);

  const lines: string[] = [
    `# ${name || "Company"}`,
    "",
    "> Company profile created during onboarding. Cofounder and its role agents",
    "> read this file for context. Edit it freely — keep it current.",
    "",
    "## At a glance",
    "",
    `- **Company / project:** ${name || "(not set)"}`,
    `- **Founder:** ${(opts.founderName || "").trim() || "(not set)"}`,
    `- **Stage:** ${stageLabel || "(not set)"}`,
    `- **Industry / audience:** ${(c?.industry || "").trim() || "(not set)"}`,
    `- **Workspace root:** ${workspaceRoot}`,
    `- **Profile created:** ${today}`,
    "",
    "## What we do",
    "",
    (c?.description || "").trim() || "_(add a one-line description)_",
    "",
    "## Top goals right now",
    "",
    goals.length ? goals.map((g) => `- ${g}`).join("\n") : "_(add 1–3 goals)_",
    "",
  ];
  await hermesRest.fsWriteText(companyPath, lines.join("\n"));

  // Append a first decision-log entry (only if not already present).
  await appendDecision(
    workspaceRoot,
    `${today} — Company profile created during onboarding`,
  );

  return name ? name : "profile written";
}

/**
 * Append a bullet line to `.cofounder/decisions.md`, creating the file if it's
 * missing. Idempotent: if a line with the same text already exists, do nothing.
 */
async function appendDecision(workspaceRoot: string, entry: string): Promise<void> {
  const path = joinPath(workspaceRoot, ".cofounder/decisions.md");
  let existing = "";
  try {
    // GET /api/fs/read-text returns the body under `text` (web_server.py:1893),
    // not `content` — reading `content` would always yield "" and duplicate.
    const res = await hermesRest.fsReadText<{ text?: string }>(path);
    existing = res.text ?? "";
  } catch {
    /* missing — we'll create it below */
  }
  if (existing.includes(entry)) return; // already logged
  const header = existing.trim()
    ? existing.replace(/\s*$/, "\n")
    : "# Decision Log\n\nAppend-only record of notable decisions.\n\n";
  const next = `${header}- ${entry}\n`;
  await hermesRest.fsWriteText(path, next);
}

/**
 * Ensure a profile's config.yaml lists the toolsets kanban needs (`hermes-cli`,
 * `kanban`). Surgical: reads the YAML text, checks for a `toolsets:` line, and
 * only rewrites when the line is missing or lacks an entry — preserving every
 * other line. Returns true if the file was changed. Used for the cofounder
 * profile and every role profile — a role can't claim/complete kanban tasks
 * (or get spawned by the dispatcher into a session that can) without it.
 *
 * IMPORTANT: a freshly created profile has NO config.yaml at all (confirmed
 * against hermes_cli/config.py — `load_config()` falls back to
 * `DEFAULT_CONFIG["toolsets"] = ["hermes-cli"]`, which does NOT include
 * `kanban`). A missing file is therefore not "already fine, leave it" — it's
 * the common case for every new role profile, and must be created, not
 * skipped, or that profile's agent has no kanban_* tools at all.
 */
async function ensureToolsetsForProfile(configPath: string): Promise<boolean> {
  let content: string;
  try {
    // read-text returns the body under `text` (web_server.py:1893), not
    // `content`; reading `content` here would always see an empty config.
    const res = await hermesRest.fsReadText<{ text?: string }>(configPath);
    content = res.text ?? "";
  } catch {
    // No config.yaml on disk yet — create one from scratch. The profile
    // directory already exists (fs/write-text only requires the immediate
    // parent to exist), so this write is safe.
    await hermesRest.fsWriteText(configPath, `toolsets: [${REQUIRED_TOOLSETS.join(", ")}]\n`);
    return true;
  }

  const lines = content.split("\n");
  const idx = lines.findIndex((l) => /^\s*toolsets\s*:/.test(l));

  if (idx === -1) {
    // No toolsets line — insert one. Place it after the top-level `model:`
    // block if present, else at the very top, so it stays a top-level key.
    const insertAt = topLevelInsertIndex(lines);
    lines.splice(insertAt, 0, `toolsets: [${REQUIRED_TOOLSETS.join(", ")}]`);
    await hermesRest.fsWriteText(configPath, lines.join("\n"));
    return true;
  }

  // A toolsets line exists — only touch it if it's inline-array form and is
  // missing one of the required entries. (If it's a block/list form or already
  // complete, leave it alone to avoid corrupting hand edits.)
  const line = lines[idx];
  const m = line.match(/^(\s*toolsets\s*:\s*)\[([^\]]*)\]\s*$/);
  if (!m) return false; // block form or unusual — don't risk rewriting it
  const present = m[2]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const missing = REQUIRED_TOOLSETS.filter((t) => !present.includes(t));
  if (missing.length === 0) return false; // already complete
  const merged = [...present, ...missing];
  lines[idx] = `${m[1]}[${merged.join(", ")}]`;
  await hermesRest.fsWriteText(configPath, lines.join("\n"));
  return true;
}

/** Index just after a leading top-level `model:` block (or 0 if none). */
function topLevelInsertIndex(lines: string[]): number {
  const modelIdx = lines.findIndex((l) => /^model\s*:/.test(l));
  if (modelIdx === -1) return 0;
  let i = modelIdx + 1;
  // Skip the indented children of the model block.
  while (i < lines.length && /^\s+\S/.test(lines[i])) i++;
  return i;
}

/**
 * Render the orchestrator SOUL with the founder's configured environment
 * appended. The SOUL prose points agents at this section for the workspace
 * root, so the configured path — not a hardcoded default — is what they use.
 */
export function renderSoul(workspaceRoot: string): string {
  const section = [
    "",
    "## Configured environment",
    "",
    `- **Workspace root:** \`${workspaceRoot}\``,
    "- All workspace reads and writes use this path. Do not use any other",
    "  location for company files.",
    "",
  ].join("\n");
  return `${SOUL_MD.replace(/\s*$/, "\n")}${section}`;
}

/**
 * Self-heal for installs bootstrapped before the SOUL carried the configured
 * workspace root: if the live SOUL is missing the environment section (or has
 * a stale root), rewrite it. Cheap no-op otherwise; safe to call on startup.
 */
export async function ensureSoulCurrent(workspaceRoot: string): Promise<void> {
  const desired = renderSoul(workspaceRoot);
  try {
    const res = await hermesRest.getSoul<{ content?: string }>(COFOUNDER_PROFILE);
    if ((res.content ?? "") === desired) return;
  } catch {
    /* unreadable — fall through and write */
  }
  await hermesRest.putSoul(COFOUNDER_PROFILE, desired);
}

/** Strip a Hermes skill file's YAML frontmatter (--- ... ---), keeping the body. */
function stripFrontmatter(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? content.slice(m[0].length).replace(/^\s+/, "") : content;
}

/**
 * Render a role's SOUL — the system prompt for its own dedicated profile. Its
 * charter is the existing SKILL.md body (frontmatter stripped); we prepend an
 * identity preamble and append the kanban worker protocol + configured
 * environment, so a role profile is fully self-sufficient as an autonomous
 * dispatch target — it doesn't need the orchestrator's SOUL or a persona seed.
 */
export function renderRoleSoul(role: string, workspaceRoot: string, companyName?: string): string {
  const charter = stripFrontmatter(ROLE_SKILLS[role] ?? "");
  const company = (companyName || "").trim();
  const preamble = [
    `# Cofounder — ${role[0].toUpperCase()}${role.slice(1)} Agent`,
    "",
    `You are the **${role}** agent on${company ? ` ${company}'s` : " the founder's"} Cofounder AI` +
      " team, one of several specialist agents working under a human founder's direction " +
      "(and sometimes dispatched by the Cofounder orchestrator). Stay in your lane — the " +
      "charter below — and if a request clearly belongs to another role, say so plainly " +
      "instead of doing out-of-scope work.",
    "",
  ].join("\n");
  const protocol = [
    "",
    "## Working board tasks assigned to you",
    "",
    `You are often started specifically to work one or more Hermes Kanban tasks ` +
      `assigned to you (assignee: \`${roleProfileName(role)}\`). When that's why you're running:`,
    "",
    "1. Check what's ready/claimed for you (`kanban_list`, or the task id you were given).",
    "2. `kanban_claim` it before starting; post progress with `kanban_comment`.",
    "3. Do the work per the workspace conventions above.",
    "4. `kanban_complete` with a short, honest result summary, or `kanban_block` with a" +
      " clear reason if you can't finish — never invent a fake result.",
    "",
    "Never claim or work a task assigned to a different profile.",
    "",
  ].join("\n");
  const env = [
    "",
    "## Configured environment",
    "",
    `- **Workspace root:** \`${workspaceRoot}\``,
    company ? `- **Company:** ${company}` : "",
    "- All workspace reads and writes use this path. Do not use any other",
    "  location for company files.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${preamble}${charter.replace(/\s*$/, "\n")}${protocol}${env}`;
}

/**
 * Bootstrap step: ensure every role has its own real profile (create if
 * missing), with a current SOUL, a working model default, the
 * kanban/hermes-cli toolsets, and a short routing description. Idempotent —
 * safe to re-run every launch.
 *
 * MODEL DEFAULT: a brand-new profile's config.yaml has no `model:` key at
 * all, so Hermes falls back to an empty-model default that 400s immediately
 * ("No models provided") — verified by watching the kanban dispatcher spawn
 * a `cofounder-marketing` worker that crashed on its very first API call.
 * We fix this by cloning the cofounder profile's own (known-working)
 * config.yaml as the starting point for a freshly created role profile — same
 * model, same toolsets — rather than leaving it to Hermes's broken default.
 * A role profile that already has its own config.yaml (e.g. the founder set
 * a different model for it via the per-agent ModelPicker) is left untouched.
 */
async function ensureRoleProfiles(
  roles: string[],
  workspaceRoot: string,
  companyName?: string,
): Promise<string> {
  let created = 0;
  for (const role of roles) {
    const profile = roleProfileName(role);
    const wasCreated = await ensureProfileExists(profile);
    if (wasCreated) created++;
    await hermesRest.putSoul(profile, renderRoleSoul(role, workspaceRoot, companyName));
    await ensureWorkingModel(profile);
    await ensureToolsetsForProfile(profileConfigPath(profile));
    const blurb = ROLES.find((r) => r.id === role)?.blurb;
    if (blurb) {
      try {
        await hermesRest.putDescription(profile, blurb);
      } catch {
        /* non-fatal — cosmetic */
      }
    }
  }
  return `${created} created, ${roles.length - created} already existed`;
}

/** Extract a top-level `key:` block (the line plus its indented children) from YAML text. */
function extractTopLevelBlock(lines: string[], key: string): string[] | null {
  const idx = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (idx === -1) return null;
  const block = [lines[idx]];
  let i = idx + 1;
  while (i < lines.length && /^\s+\S/.test(lines[i])) {
    block.push(lines[i]);
    i++;
  }
  return block;
}

/**
 * Ensure `profile`'s config.yaml has a `model:` block, so a spawned worker
 * doesn't fall back to Hermes's broken empty-model default. If the file (or
 * the key) is missing, clone the cofounder profile's own `model:` block —
 * inserted alongside existing content (e.g. `toolsets:`), never clobbering
 * it. No-op if the profile already has its own `model:` key (never overwrite
 * a founder-customized one, e.g. via the per-agent ModelPicker).
 */
async function ensureWorkingModel(profile: string): Promise<void> {
  let lines: string[] = [];
  try {
    const res = await hermesRest.fsReadText<{ text?: string }>(profileConfigPath(profile));
    lines = (res.text ?? "").split("\n");
  } catch {
    /* no config.yaml yet — lines stays [] */
  }
  if (extractTopLevelBlock(lines, "model")) return; // already has its own — leave it alone

  let cofounderModel: string[] | null = null;
  try {
    const res = await hermesRest.fsReadText<{ text?: string }>(profileConfigPath(COFOUNDER_PROFILE));
    cofounderModel = extractTopLevelBlock((res.text ?? "").split("\n"), "model");
  } catch {
    /* cofounder's own config.yaml is missing too — nothing to clone */
  }
  if (!cofounderModel) return;

  const content = lines.filter((l) => l.trim()).join("\n");
  const next = content ? `${cofounderModel.join("\n")}\n${content}\n` : `${cofounderModel.join("\n")}\n`;
  await hermesRest.fsWriteText(profileConfigPath(profile), next);
}

/**
 * Self-heal for installs bootstrapped before role agents had their own
 * profiles: creates any missing role profile and refreshes its SOUL/toolsets
 * so an existing single-profile install picks up real delegation without the
 * founder re-running onboarding. Cheap and safe to call on every app start.
 */
export async function ensureRoleProfilesCurrent(
  workspaceRoot: string,
  companyName?: string,
): Promise<void> {
  await ensureRoleProfiles(Object.keys(ROLE_SKILLS), workspaceRoot, companyName);
}

/** Join a root and a relative path with a single slash (no Node path in browser). */
function joinPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

export { joinPath };
