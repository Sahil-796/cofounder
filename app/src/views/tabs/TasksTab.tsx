/**
 * Tasks tab — the real Hermes kanban board. Columns: To do (triage/todo/
 * scheduled) · Ready · Running (+review) · Done (blocked shown with a badge).
 * Cards show the task title, an assignee role chip (emoji from roles.ts), and a
 * relative age. Polls every ~12s and on tab focus. Delegation spawn/session
 * activity is shown as a secondary "Live sessions" strip.
 */

import { useEffect, useMemo, useRef } from "react";
import { useTasks, relativeAge } from "@/state/tasks";
import {
  columnForStatus,
  taskAgeMs,
  type BoardColumn,
  type KanbanTask,
} from "@/lib/cofounder/extraRest";
import { roleEmoji, roleLabel } from "@/lib/cofounder/roles";

const POLL_MS = 12_000;

const COLUMNS: { key: BoardColumn; label: string; dot: string }[] = [
  { key: "todo", label: "To do", dot: "#7a7a82" },
  { key: "ready", label: "Ready", dot: "#7aa2e8" },
  { key: "running", label: "Running", dot: "#e8c37a" },
  { key: "done", label: "Done", dot: "#7ad39a" },
];

export default function TasksTab() {
  const { kanban, spawns, kanbanLoaded, loading, error, refresh } = useTasks();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer.current) clearInterval(timer.current);
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

  const liveSpawns = spawns.filter((s) => !s.finished_at);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="text-[11px] text-[#6a6a72]">
          {kanban.length > 0
            ? `${kanban.length} task${kanban.length === 1 ? "" : "s"} on the board`
            : ""}
        </div>
        <button
          onClick={() => void refresh()}
          className="text-[13px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!kanbanLoaded ? (
          <div className="text-[12.5px] text-[#6a6a72]">{loading ? "Loading…" : ""}</div>
        ) : error && kanban.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-6 text-center text-[12.5px] text-[#8a8a92]">
            Couldn't load the board — is the backend running?
          </div>
        ) : kanban.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-3xl">🗂️</div>
            <div className="text-[14px] text-[#c7c7cd]">No tasks yet</div>
            <p className="max-w-xs text-[12.5px] text-[#8a8a92]">
              Cofounder creates tasks here when it delegates work. Ask it to plan
              or run something and they'll appear on this board.
            </p>
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
                    <span className="text-[10.5px] text-[#5f5f67]">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#1f2024] px-2 py-4 text-center text-[11px] text-[#5a5a62]">
                        —
                      </div>
                    ) : (
                      items.map((t) => <TaskCardView key={t.id} task={t} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {liveSpawns.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#7a7a82]">
              Live sessions
            </div>
            <div className="flex flex-col gap-1.5">
              {liveSpawns.slice(0, 5).map((s) => (
                <div
                  key={s.session_id}
                  className="flex items-center gap-2 rounded-lg border border-[#222327] bg-[#141518] px-2.5 py-1.5"
                >
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#e8c37a]" />
                  <span className="flex-1 truncate text-[11.5px] text-[#c7c7cd]">
                    {s.label || s.path || "delegated run"}
                  </span>
                  <span className="text-[10px] text-[#6a6a72]">running</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCardView({ task }: { task: KanbanTask }) {
  const blocked = task.status === "blocked";
  return (
    <div className="rounded-lg border border-[#222327] bg-[#141518] p-2.5">
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
          <span className="text-[10px] text-[#6a6a72]">{relativeAge(taskAgeMs(task))}</span>
        </div>
      </div>
    </div>
  );
}
