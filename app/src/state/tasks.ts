/**
 * Tasks store — surfaces live agent activity for the Home TASKS list and the
 * Tasks board. Reads session.list (recent sessions on the cofounder profile),
 * spawn_tree.list (delegated sub-agent runs), delegation.status, and
 * agents.list over the WS gateway. Read-only for v1.
 */

import { create } from "zustand";
import { hermesWs, sessions } from "@/lib/hermes";
import type {
  AgentProcess,
  DelegationStatusResult,
  SessionListItem,
  SpawnTreeEntry,
} from "@/lib/hermes";
import { fetchKanbanBoard, type KanbanTask } from "@/lib/cofounder/extraRest";

export type TaskColumn = "running" | "waiting" | "done";

export interface TaskCard {
  id: string;
  title: string;
  column: TaskColumn;
  ageMs: number;
  source: string;
}

interface TasksState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Real work items from the Hermes kanban board — the primary "tasks". */
  kanban: KanbanTask[];
  /** True once a kanban fetch has completed at least once. */
  kanbanLoaded: boolean;
  /** Include archived tasks in the fetch (drives the "Show archived" toggle). */
  showArchived: boolean;
  /** ms-epoch of the last successful board refresh (for "updated Xs ago"). */
  lastUpdated: number | null;
  /** Chat sessions — conversations, kept separate from tasks. */
  sessions: SessionListItem[];
  spawns: SpawnTreeEntry[];
  processes: AgentProcess[];
  delegation: DelegationStatusResult | null;
  refresh: () => Promise<void>;
  setShowArchived: (v: boolean) => void;
}

export const useTasks = create<TasksState>((set, get) => ({
  loading: false,
  loaded: false,
  error: null,
  kanban: [],
  kanbanLoaded: false,
  showArchived: false,
  lastUpdated: null,
  sessions: [],
  spawns: [],
  processes: [],
  delegation: null,

  setShowArchived: (v: boolean) => {
    set({ showArchived: v });
    void get().refresh();
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      const [board, list, tree, procs, deleg] = await Promise.allSettled([
        fetchKanbanBoard(get().showArchived),
        sessions.list(50),
        sessions.spawnTreeList({ limit: 50, cross_session: true }),
        sessions.agentsList(),
        sessions.delegationStatus(),
      ]);
      set({
        loading: false,
        loaded: true,
        lastUpdated: Date.now(),
        kanban: board.status === "fulfilled" ? board.value : [],
        kanbanLoaded: true,
        sessions:
          list.status === "fulfilled" ? (list.value.sessions ?? []) : [],
        spawns:
          tree.status === "fulfilled" ? (tree.value.entries ?? []) : [],
        processes:
          procs.status === "fulfilled" ? (procs.value.processes ?? []) : [],
        delegation: deleg.status === "fulfilled" ? deleg.value : null,
      });
    } catch (err) {
      set({ loading: false, loaded: true, kanbanLoaded: true, error: String(err) });
    }
  },
}));

// ── Event-driven freshness ───────────────────────────────────────────────────
// The board is a projection of the kanban DB, mutated by agent tool calls. Poll
// (12s from the tab) is the floor; these WS events refresh instantly (debounced
// ~1s) whenever something that could change the board happens:
//   • tool.complete for any kanban_* tool  • message.complete  • subagent.complete
// Registered once at module load against the stable hermesWs singleton.

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void useTasks.getState().refresh();
  }, 1000);
}

let freshnessBound = false;
export function bindTaskFreshness(): void {
  if (freshnessBound) return;
  freshnessBound = true;
  hermesWs.onEvent("tool.complete", (e) => {
    const name = String(
      (e.payload as { name?: string } | undefined)?.name ?? "",
    ).toLowerCase();
    if (name.includes("kanban")) scheduleRefresh();
  });
  hermesWs.onEvent("message.complete", () => scheduleRefresh());
  hermesWs.onEvent("subagent.complete", () => scheduleRefresh());
}
bindTaskFreshness();

/** Human "3m ago" style relative age from a ms-epoch or s-epoch timestamp. */
export function relativeAge(ms: number): string {
  if (!ms || ms <= 0) return "";
  // Some backends return seconds; normalize.
  const t = ms < 1e12 ? ms * 1000 : ms;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
