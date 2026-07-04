/**
 * Delegations store — live + historical view of delegated sub-agent runs and
 * plain chat sessions, powering the "Activity" sub-tab of the Tasks view.
 *
 * LIVE runs: the gateway relays `subagent.start|tool|thinking|complete` events
 * on the PARENT session id (server.py L3448+). Each carries goal, subagent_id,
 * parent_id, child_session_id, model, status, summary, duration_seconds,
 * files_written, output_tail. We subscribe ONCE (module-init) via
 * hermesWs.onEvent and accumulate a bounded per-run transcript keyed by
 * subagent_id (falling back to child_session_id).
 *
 * HISTORICAL runs: finished spawn trees persisted on disk, listed via
 * `spawn_tree.list` ({cross_session:true}) and loaded via `spawn_tree.load`
 * ({path}). The saved snapshot is the TUI's `SubagentProgress[]` under
 * `subagents` (camelCase keys — verified ui-tui/src/types.ts:23 and
 * createGatewayEventHandler.ts:142).
 *
 * SESSIONS: plain chat sessions via sessions.list(); read-only transcript via
 * session.history(id); delete via session.delete (server.py L5844).
 */

import { create } from "zustand";
import { hermesWs, sessions } from "@/lib/hermes";
import type { ChatMessage, HermesEvent, SpawnTreeEntry } from "@/lib/hermes";

/** Max transcript entries retained per live run (bounded buffer). */
const MAX_ENTRIES = 200;
/** Max concurrently-tracked live runs before evicting the oldest finished. */
const MAX_RUNS = 40;

export type DelegationEntryKind = "start" | "text" | "tool" | "thinking";

export interface DelegationEntry {
  kind: DelegationEntryKind;
  /** Free text (goal header, streamed reply, thinking chunk). */
  text?: string;
  /** Tool name for `kind:"tool"`. */
  tool?: string;
  /** Short preview shown on a tool chip. */
  preview?: string;
  at: number;
}

export interface LiveDelegation {
  /** Stable key: subagent_id if present, else child_session_id, else synthetic. */
  key: string;
  subagentId?: string;
  parentId?: string;
  childSessionId?: string;
  parentSessionId?: string;
  goal: string;
  model?: string;
  status: "running" | "completed" | "error" | "interrupted" | string;
  summary?: string;
  durationSeconds?: number;
  filesWritten?: string[];
  entries: DelegationEntry[];
  startedAt: number;
  updatedAt: number;
  finished: boolean;
}

/** Per-subagent snapshot inside a persisted spawn tree (TUI SubagentProgress). */
export interface SpawnTreeSubagent {
  id: string;
  parentId: string | null;
  depth: number;
  index: number;
  goal: string;
  status: string;
  model?: string;
  summary?: string;
  durationSeconds?: number;
  startedAt?: number;
  toolCount?: number;
  tools?: string[];
  filesWritten?: string[];
  filesRead?: string[];
  outputTail?: { tool: string; preview: string; isError: boolean }[];
  [k: string]: unknown;
}

export interface SpawnTreeSnapshot {
  session_id?: string;
  started_at?: number | null;
  finished_at?: number;
  label?: string;
  subagents: SpawnTreeSubagent[];
}

interface DelegationsState {
  /** Live runs, newest-updated first (computed in selectors). */
  live: Record<string, LiveDelegation>;
  /** Past spawn-tree index entries (cross-session). */
  history: SpawnTreeEntry[];
  historyLoaded: boolean;
  refreshHistory: () => Promise<void>;
  loadSnapshot: (path: string) => Promise<SpawnTreeSnapshot | null>;
  clearFinished: () => void;
}

function readStr(p: Record<string, unknown> | undefined, k: string): string | undefined {
  const v = p?.[k];
  return typeof v === "string" && v ? v : undefined;
}
function readNum(p: Record<string, unknown> | undefined, k: string): number | undefined {
  const v = p?.[k];
  return typeof v === "number" ? v : undefined;
}

export const useDelegations = create<DelegationsState>((set) => ({
  live: {},
  history: [],
  historyLoaded: false,

  refreshHistory: async () => {
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      const res = await sessions.spawnTreeList({ limit: 50, cross_session: true });
      set({ history: res.entries ?? [], historyLoaded: true });
    } catch {
      set({ historyLoaded: true });
    }
  },

  loadSnapshot: async (path: string) => {
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      const raw = await hermesWs.request<SpawnTreeSnapshot>(
        "spawn_tree.load",
        { path },
        20_000,
      );
      const subs = Array.isArray(raw?.subagents) ? raw.subagents : [];
      return { ...raw, subagents: subs };
    } catch {
      return null;
    }
  },

  clearFinished: () => {
    set((s) => {
      const live: Record<string, LiveDelegation> = {};
      for (const [k, v] of Object.entries(s.live)) if (!v.finished) live[k] = v;
      return { live };
    });
  },
}));

// ── One-time global subscription to relayed subagent.* events ────────────────
// Registered at module load. hermesWs is a stable singleton; handlers persist
// across reconnects (onEvent just registers a callback set).

function ingest(event: HermesEvent): void {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const subagentId = readStr(p, "subagent_id");
  const childSessionId = readStr(p, "child_session_id");
  const key = subagentId || childSessionId;
  if (!key) return; // Can't correlate without an identity; skip.

  const now = Date.now();
  useDelegations.setState((s) => {
    const prev = s.live[key];
    const run: LiveDelegation = prev
      ? { ...prev, entries: prev.entries.slice() }
      : {
          key,
          goal: readStr(p, "goal") ?? "delegated run",
          status: "running",
          entries: [],
          startedAt: now,
          updatedAt: now,
          finished: false,
        };

    run.subagentId = subagentId ?? run.subagentId;
    run.childSessionId = childSessionId ?? run.childSessionId;
    run.parentId = readStr(p, "parent_id") ?? run.parentId;
    run.parentSessionId = event.session_id ?? run.parentSessionId;
    run.model = readStr(p, "model") ?? run.model;
    if (readStr(p, "goal")) run.goal = readStr(p, "goal")!;
    run.updatedAt = now;

    const push = (e: DelegationEntry) => {
      run.entries.push(e);
      if (run.entries.length > MAX_ENTRIES)
        run.entries.splice(0, run.entries.length - MAX_ENTRIES);
    };

    switch (event.type) {
      case "subagent.start":
        if (!prev) push({ kind: "start", text: run.goal, at: now });
        break;
      case "subagent.text": {
        const t = readStr(p, "text");
        if (t) push({ kind: "text", text: t, at: now });
        break;
      }
      case "subagent.thinking": {
        const t = readStr(p, "text");
        if (t) push({ kind: "thinking", text: t, at: now });
        break;
      }
      case "subagent.tool": {
        push({
          kind: "tool",
          tool: readStr(p, "tool_name") ?? "tool",
          preview: readStr(p, "tool_preview") ?? readStr(p, "text"),
          at: now,
        });
        break;
      }
      case "subagent.complete": {
        run.finished = true;
        run.status = readStr(p, "status") ?? "completed";
        run.summary = readStr(p, "summary") ?? run.summary;
        run.durationSeconds = readNum(p, "duration_seconds") ?? run.durationSeconds;
        const fw = p.files_written;
        if (Array.isArray(fw)) run.filesWritten = fw.map(String);
        break;
      }
      default:
        break;
    }

    let live = { ...s.live, [key]: run };
    // Evict oldest finished runs if we exceed the cap.
    const ids = Object.keys(live);
    if (ids.length > MAX_RUNS) {
      const finished = ids
        .map((id) => live[id])
        .filter((r) => r.finished)
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const toDrop = ids.length - MAX_RUNS;
      const dropped = new Set(finished.slice(0, toDrop).map((r) => r.key));
      if (dropped.size) {
        live = Object.fromEntries(
          Object.entries(live).filter(([id]) => !dropped.has(id)),
        );
      }
    }
    return { live };
  });
}

let subscribed = false;
function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;
  for (const t of [
    "subagent.start",
    "subagent.text",
    "subagent.tool",
    "subagent.thinking",
    "subagent.complete",
  ] as const) {
    hermesWs.onEvent(t, ingest);
  }
}
subscribeOnce();

/** Read-only chat-session transcript loader (used by the session viewer). */
export async function loadSessionHistory(
  sessionId: string,
): Promise<ChatMessage[]> {
  if (hermesWs.connectionState !== "open") await hermesWs.connect();
  const res = await sessions.history(sessionId);
  return res.messages ?? [];
}

/** Delete a stored chat session (server.py session.delete, L5844). */
export async function deleteSession(sessionId: string): Promise<void> {
  if (hermesWs.connectionState !== "open") await hermesWs.connect();
  await hermesWs.request("session.delete", { session_id: sessionId }, 15_000);
}
