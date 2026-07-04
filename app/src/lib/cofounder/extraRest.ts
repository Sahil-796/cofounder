/**
 * Kanban board access for the Cofounder UI.
 *
 * There is no REST/RPC kanban endpoint in the Hermes dashboard API, so we read
 * and mutate the board through the WS `shell.exec` RPC (tui_gateway/server.py)
 * running the `hermes kanban` CLI with `--json`. `shell.exec` truncates stdout
 * to the last 4000 chars, so list/show fetches project to just the fields the
 * UI needs (via `jq`) and cap the row count — that keeps well-sized boards
 * fully within the limit. If `jq` is unavailable we fall back to the raw
 * `--json` output.
 *
 * Freshness fix: the default list does NOT pass `--archived`, so archived /
 * purged tasks disappear from the board immediately. Pass `includeArchived` to
 * fetch them back (the "Show archived" toggle).
 *
 * This file only *uses* the existing hermes WS singleton — it adds no new REST
 * helpers to src/lib/hermes.
 */

import { hermesWs } from "@/lib/hermes";

export type KanbanStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "review"
  | "done"
  | "blocked"
  | "archived";

/** Raw shape of a task row from `hermes kanban list --json` (subset we read). */
export interface KanbanTask {
  id: string;
  title: string;
  assignee: string | null;
  status: KanbanStatus;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  /** Chat/agent session that created this task (set from inside an ACP loop). */
  session_id?: string | null;
  /** Priority tiebreaker (higher = sooner). */
  priority?: number | null;
}

/** A run row from `hermes kanban runs <id> --json`. */
export interface KanbanRun {
  run_id?: string | number | null;
  profile?: string | null;
  outcome?: string | null;
  status?: string | null;
  summary?: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  elapsed?: number | null;
  session_id?: string | null;
  child_session_id?: string | null;
  [k: string]: unknown;
}

/** A comment on a task (from `hermes kanban show --json`). */
export interface KanbanComment {
  author?: string | null;
  body?: string | null;
  created_at?: number | null;
  [k: string]: unknown;
}

/** A lifecycle event on a task (from `hermes kanban show --json`). */
export interface KanbanEvent {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: number | null;
  run_id?: string | number | null;
  [k: string]: unknown;
}

/** Full detail for one task, from `hermes kanban show <id> --json`. */
export interface KanbanDetail {
  task: KanbanTask & {
    body?: string | null;
    workspace_kind?: string | null;
    workspace_path?: string | null;
    branch_name?: string | null;
    created_by?: string | null;
    result?: string | null;
    skills?: string[] | null;
  };
  latest_summary?: string | null;
  parents?: unknown[];
  children?: unknown[];
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
}

interface ShellExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Cap on rows requested from the CLI. shell.exec caps stdout at 4000 chars;
 * the projected row is ~200 bytes, so 40 rows keeps us safely under the limit.
 */
const MAX_ROWS = 40;

/**
 * jq program: keep only UI fields, newest-first, capped. Falls through to raw
 * output on shells without jq (we detect the missing-jq case and retry raw).
 */
const JQ_PROJECT =
  "sort_by(.created_at) | reverse | .[0:" +
  MAX_ROWS +
  "] | [.[] | {id,title,assignee,status,created_at,started_at,completed_at,session_id,priority}]";

function parseTasks(stdout: string): KanbanTask[] {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed[0] !== "[") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      id: String(t.id ?? ""),
      title: String(t.title ?? "Untitled task"),
      assignee: (t.assignee as string | null) ?? null,
      status: (t.status as KanbanStatus) ?? "todo",
      created_at: numOrNull(t.created_at),
      started_at: numOrNull(t.started_at),
      completed_at: numOrNull(t.completed_at),
      session_id: (t.session_id as string | null) ?? null,
      priority: numOrNull(t.priority),
    }))
    .filter((t) => t.id);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

async function shellExec(command: string, timeout = 20_000): Promise<ShellExecResult> {
  if (hermesWs.connectionState !== "open") await hermesWs.connect();
  return hermesWs.request<ShellExecResult>("shell.exec", { command }, timeout);
}

/**
 * Single-quote a value for safe use as one shell argument: wrap in single
 * quotes and escape embedded single quotes with the '\'' idiom. Handles
 * arbitrary user input (titles, descriptions) without injection.
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Fetch the kanban board. By default archived tasks are EXCLUDED so deleted /
 * archived tasks vanish immediately. Pass `includeArchived` for the toggle.
 * Returns [] on any failure so callers render an honest empty/error state.
 */
export async function fetchKanbanBoard(
  includeArchived = false,
): Promise<KanbanTask[]> {
  const listCmd =
    "hermes kanban list --json" + (includeArchived ? " --archived" : "");
  // Preferred: project through jq so the payload stays under shell.exec's cap.
  try {
    const piped = `${listCmd} 2>/dev/null | jq -c '${JQ_PROJECT}'`;
    const res = await shellExec(piped);
    if (res.code === 0 && res.stdout.trim().startsWith("[")) {
      return parseTasks(res.stdout);
    }
  } catch {
    /* fall through to raw */
  }
  // Fallback: raw JSON (works for small boards, or where jq is absent).
  try {
    const res = await shellExec(`${listCmd} 2>/dev/null`);
    return parseTasks(res.stdout);
  } catch {
    return [];
  }
}

/**
 * Fetch full detail for one task via `hermes kanban show <id> --json`. We cap
 * the noisy arrays through jq (last N comments/events/runs) so the payload
 * stays under shell.exec's 4000-char cap even for busy tasks. Returns null on
 * failure.
 */
export async function fetchKanbanDetail(id: string): Promise<KanbanDetail | null> {
  const showCmd = `hermes kanban show ${shQuote(id)} --json`;
  // jq: keep task + trimmed body + last comments/events/runs.
  const jqTrim =
    "{task: (.task | {id,title,assignee,status,created_at,started_at," +
    "completed_at,session_id,priority,body,workspace_kind,workspace_path," +
    "branch_name,created_by,result,skills}), latest_summary, " +
    "comments: (.comments | .[-12:]), events: (.events | .[-16:]), " +
    "runs: (.runs | .[-12:])}";
  try {
    const piped = `${showCmd} 2>/dev/null | jq -c '${jqTrim}'`;
    const res = await shellExec(piped);
    const parsed = parseDetail(res.stdout);
    if (parsed) return parsed;
  } catch {
    /* fall through to raw */
  }
  try {
    const res = await shellExec(`${showCmd} 2>/dev/null`);
    return parseDetail(res.stdout);
  } catch {
    return null;
  }
}

function parseDetail(stdout: string): KanbanDetail | null {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const task = (o.task as Record<string, unknown>) ?? {};
  return {
    task: {
      id: String(task.id ?? ""),
      title: String(task.title ?? "Untitled task"),
      assignee: (task.assignee as string | null) ?? null,
      status: (task.status as KanbanStatus) ?? "todo",
      created_at: numOrNull(task.created_at),
      started_at: numOrNull(task.started_at),
      completed_at: numOrNull(task.completed_at),
      session_id: (task.session_id as string | null) ?? null,
      priority: numOrNull(task.priority),
      body: (task.body as string | null) ?? null,
      workspace_kind: (task.workspace_kind as string | null) ?? null,
      workspace_path: (task.workspace_path as string | null) ?? null,
      branch_name: (task.branch_name as string | null) ?? null,
      created_by: (task.created_by as string | null) ?? null,
      result: (task.result as string | null) ?? null,
      skills: Array.isArray(task.skills) ? (task.skills as string[]) : null,
    },
    latest_summary: (o.latest_summary as string | null) ?? null,
    parents: Array.isArray(o.parents) ? o.parents : [],
    children: Array.isArray(o.children) ? o.children : [],
    comments: Array.isArray(o.comments) ? (o.comments as KanbanComment[]) : [],
    events: Array.isArray(o.events) ? (o.events as KanbanEvent[]) : [],
    runs: Array.isArray(o.runs) ? (o.runs as KanbanRun[]) : [],
  };
}

export interface CreateTaskInput {
  title: string;
  assignee?: string;
  body?: string;
  priority?: number;
}

/**
 * Create a task via `hermes kanban create … --json`. All values are shell-
 * quoted. Returns the new task id on success, or throws on failure.
 */
export async function createKanbanTask(input: CreateTaskInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  const parts = ["hermes", "kanban", "create", shQuote(title), "--json"];
  if (input.assignee) parts.push("--assignee", shQuote(input.assignee));
  if (input.body && input.body.trim())
    parts.push("--body", shQuote(input.body.trim()));
  if (typeof input.priority === "number" && Number.isFinite(input.priority))
    parts.push("--priority", String(Math.trunc(input.priority)));
  const res = await shellExec(parts.join(" "));
  const out = res.stdout.trim();
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || out || "create failed");
  }
  try {
    const parsed = JSON.parse(out.startsWith("{") ? out : out.slice(out.indexOf("{")));
    const id = (parsed as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  } catch {
    /* non-JSON stdout; treat as success without an id */
  }
  return "";
}

/**
 * Archive a task via `hermes kanban archive <id>`. Removes it from the default
 * (non-archived) board immediately. Throws on failure.
 */
export async function archiveKanbanTask(id: string): Promise<void> {
  const res = await shellExec(`hermes kanban archive ${shQuote(id)}`);
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || "archive failed");
  }
}

/** UI-facing board column. */
export type BoardColumn = "todo" | "ready" | "running" | "done";

/** Map a kanban status onto a board column. */
export function columnForStatus(status: KanbanStatus): BoardColumn {
  switch (status) {
    case "triage":
    case "todo":
    case "scheduled":
      return "todo";
    case "ready":
      return "ready";
    case "running":
    case "review":
      return "running";
    case "done":
    case "blocked":
    case "archived":
      return "done";
    default:
      return "todo";
  }
}

/** Best available timestamp (ms epoch) for relative-age display. */
export function taskAgeMs(t: KanbanTask): number {
  const s = t.completed_at ?? t.started_at ?? t.created_at ?? 0;
  return s ? s * 1000 : 0;
}
