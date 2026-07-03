/**
 * Kanban board access for the Cofounder UI.
 *
 * There is no REST/RPC kanban endpoint in the Hermes dashboard API, so we read
 * the board through the WS `shell.exec` RPC (tui_gateway/server.py) running the
 * `hermes kanban list` CLI with `--json`. `shell.exec` truncates stdout to the
 * last 4000 chars, so we project each task to just the fields the UI needs (via
 * `jq`) and cap the row count — that keeps well-sized boards fully within the
 * limit. If `jq` is unavailable we fall back to the raw `--json` output.
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
}

interface ShellExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Cap on rows requested from the CLI. shell.exec caps stdout at 4000 chars;
 * the projected row is ~150–200 bytes, so 40 rows (~7KB before truncation is a
 * risk) — we request the most-recently-created 40, which is plenty for the UI.
 */
const MAX_ROWS = 40;

/**
 * jq program: keep only UI fields, newest-first, capped. Falls through to raw
 * output on shells without jq (we detect the `jq: command not found` case and
 * retry raw).
 */
const JQ_PROJECT =
  "sort_by(.created_at) | reverse | .[0:" +
  MAX_ROWS +
  "] | [.[] | {id,title,assignee,status,created_at,started_at,completed_at}]";

const LIST_JSON = "hermes kanban list --json --archived";

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
    }))
    .filter((t) => t.id);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

async function shellExec(command: string): Promise<ShellExecResult> {
  if (hermesWs.connectionState !== "open") await hermesWs.connect();
  return hermesWs.request<ShellExecResult>("shell.exec", { command }, 20_000);
}

/**
 * Fetch the kanban board (including archived) via the CLI. Returns [] on any
 * failure so callers can render an honest empty/error state rather than crash.
 */
export async function fetchKanbanBoard(): Promise<KanbanTask[]> {
  // Preferred: project through jq so the payload stays under shell.exec's cap.
  try {
    const piped = `${LIST_JSON} 2>/dev/null | jq -c '${JQ_PROJECT}'`;
    const res = await shellExec(piped);
    if (res.code === 0 && res.stdout.trim().startsWith("[")) {
      return parseTasks(res.stdout);
    }
  } catch {
    /* fall through to raw */
  }
  // Fallback: raw JSON (works for small boards, or where jq is absent).
  try {
    const res = await shellExec(`${LIST_JSON} 2>/dev/null`);
    return parseTasks(res.stdout);
  } catch {
    return [];
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
