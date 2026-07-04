/**
 * Tasks tab — the real Hermes kanban board plus a Delegations/Activity view.
 *
 * Board: columns To do (triage/todo/scheduled) · Ready · Running (+review) ·
 * Done (blocked shown with a badge). Cards show the task title (never the raw
 * id), an assignee role chip, and a relative age; clicking a card opens the
 * detail drawer with a per-task transcript. A "Show archived" toggle refetches
 * with archived tasks; the refresh button spins while loading and a
 * "updated Xs ago" hint shows freshness. The board also refreshes instantly on
 * kanban tool / message / subagent completion events (see state/tasks.ts).
 *
 * Activity: live + past delegated runs and chat-session management (see
 * DelegationsView).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks, relativeAge } from "@/state/tasks";
import {
  columnForStatus,
  taskAgeMs,
  type BoardColumn,
  type KanbanTask,
} from "@/lib/cofounder/extraRest";
import { roleEmoji, roleLabel } from "@/lib/cofounder/roles";
import TaskDetailDrawer from "@/views/tasks/TaskDetailDrawer";
import NewTaskModal from "@/views/tasks/NewTaskModal";
import DelegationsView from "@/views/tasks/DelegationsView";

const POLL_MS = 12_000;

const COLUMNS: { key: BoardColumn; label: string; dot: string }[] = [
  { key: "todo", label: "To do", dot: "#7a7a82" },
  { key: "ready", label: "Ready", dot: "#7aa2e8" },
  { key: "running", label: "Running", dot: "#e8c37a" },
  { key: "done", label: "Done", dot: "#7ad39a" },
];

type SubTab = "board" | "activity";

export default function TasksTab() {
  const {
    kanban,
    kanbanLoaded,
    loading,
    error,
    refresh,
    showArchived,
    setShowArchived,
    lastUpdated,
  } = useTasks();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("board");
  const [selected, setSelected] = useState<KanbanTask | null>(null);
  const [creating, setCreating] = useState(false);
  // Re-render the "updated Xs ago" hint every few seconds.
  const [, setTick] = useState(0);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setTick((t) => t + 1), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const byCol = useMemo(() => {
    const m: Record<BoardColumn, KanbanTask[]> = {
      todo: [],
      ready: [],
      running: [],
      done: [],
    };
    for (const t of kanban) m[columnForStatus(t.status)].push(t);
    for (const k of Object.keys(m) as BoardColumn[]) {
      m[k].sort((a, b) => taskAgeMs(b) - taskAgeMs(a));
    }
    return m;
  }, [kanban]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-1 rounded-lg border border-[#1f2024] bg-[#141518] p-0.5">
          {(["board", "activity"] as SubTab[]).map((k) => (
            <button
              key={k}
              onClick={() => setSubTab(k)}
              className={
                "rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition " +
                (subTab === k
                  ? "bg-[#222327] text-[#e4e4e8]"
                  : "text-[#8a8a92] hover:text-[#c7c7cd]")
              }
            >
              {k}
            </button>
          ))}
        </div>

        {subTab === "board" && (
          <div className="flex items-center gap-2.5">
            <span className="text-[10.5px] text-[#5f5f67]">
              {lastUpdated ? `updated ${relativeAge(lastUpdated) || "just now"}` : ""}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#8a8a92]">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3 w-3 accent-[#e8c37a]"
              />
              archived
            </label>
            <button
              onClick={() => void refresh()}
              className="text-[14px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
              title="Refresh"
            >
              <span className={loading ? "inline-block animate-spin" : "inline-block"}>
                ↻
              </span>
            </button>
            <button
              onClick={() => setCreating(true)}
              className="rounded-lg bg-[#222327] px-2.5 py-1 text-[11.5px] font-medium text-[#e4e4e8] transition hover:bg-[#2a2b30]"
            >
              + New task
            </button>
          </div>
        )}
      </div>

      {subTab === "activity" ? (
        <DelegationsView />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {!kanbanLoaded ? (
            <div className="text-[12.5px] text-[#6a6a72]">
              {loading ? "Loading…" : ""}
            </div>
          ) : error && kanban.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-6 text-center text-[12.5px] text-[#8a8a92]">
              Couldn't load the board — is the backend running?
            </div>
          ) : kanban.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="text-3xl">🗂️</div>
              <div className="text-[14px] text-[#c7c7cd]">No tasks yet</div>
              <p className="max-w-xs text-[12.5px] text-[#8a8a92]">
                Create one with “+ New task”, or ask Cofounder to plan or run
                something and delegated work will appear here.
              </p>
              <button
                onClick={() => setCreating(true)}
                className="mt-1 rounded-lg bg-[#222327] px-3 py-1.5 text-[12px] font-medium text-[#e4e4e8] transition hover:bg-[#2a2b30]"
              >
                + New task
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2.5">
              {COLUMNS.map((col) => {
                const items = byCol[col.key];
                return (
                  <div key={col.key} className="flex flex-col">
                    <div className="mb-2 flex items-center gap-1.5 px-0.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: col.dot }}
                      />
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a8a92]">
                        {col.label}
                      </span>
                      <span className="text-[10.5px] text-[#5f5f67]">
                        {items.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#1f2024] px-2 py-4 text-center text-[11px] text-[#5a5a62]">
                          —
                        </div>
                      ) : (
                        items.map((t) => (
                          <TaskCardView
                            key={t.id}
                            task={t}
                            onClick={() => setSelected(t)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <TaskDetailDrawer task={selected} onClose={() => setSelected(null)} />
      )}
      {creating && (
        <NewTaskModal
          onClose={() => setCreating(false)}
          onCreated={() => void refresh()}
        />
      )}
    </div>
  );
}

function TaskCardView({
  task,
  onClick,
}: {
  task: KanbanTask;
  onClick: () => void;
}) {
  const blocked = task.status === "blocked";
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-[#222327] bg-[#141518] p-2.5 text-left transition hover:border-[#2e2f34] hover:bg-[#17181b]"
    >
      <div className="mb-1.5 line-clamp-3 text-[12px] leading-snug text-[#d0d0d5]">
        {task.title}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-[#202127] px-1.5 py-0.5 text-[10px] text-[#b6b6bc]"
          title={roleLabel(task.assignee)}
        >
          <span>{roleEmoji(task.assignee)}</span>
          <span className="max-w-[64px] truncate">{roleLabel(task.assignee)}</span>
        </span>
        <div className="flex items-center gap-1">
          {blocked && (
            <span className="rounded-full bg-[#3a1c1c] px-1.5 py-0.5 text-[9px] font-medium text-[#e08a8a]">
              blocked
            </span>
          )}
          <span className="text-[10px] text-[#6a6a72]">
            {relativeAge(taskAgeMs(task))}
          </span>
        </div>
      </div>
    </button>
  );
}
