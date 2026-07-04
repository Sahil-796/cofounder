/**
 * Department-scoped tasks page — reached from DepartmentView's "Tasks" row.
 * Shows only this department's kanban tasks, grouped by status, without
 * leaving the drill-down for the generic Tasks tab (which shows every
 * department at once). Shares the same live `useTasks` store as the Tasks
 * tab, so it stays in sync with the same polling/event-driven refresh.
 */

import { useEffect, useMemo, useState } from "react";
import { useTasks, relativeAge } from "@/state/tasks";
import { columnForStatus, taskAgeMs, type BoardColumn, type KanbanTask } from "@/lib/cofounder/extraRest";
import { ROLES, delegatorEmoji, delegatorLabel } from "@/lib/cofounder/roles";
import TaskDetailDrawer from "@/views/tasks/TaskDetailDrawer";
import NewTaskModal from "@/views/tasks/NewTaskModal";

const COLUMNS: { key: BoardColumn; label: string; dot: string }[] = [
  { key: "todo", label: "To do", dot: "#7a7a82" },
  { key: "ready", label: "Ready", dot: "#7aa2e8" },
  { key: "running", label: "Running", dot: "#e8c37a" },
  { key: "done", label: "Done", dot: "#7ad39a" },
];

export default function DepartmentTasksView({
  deptId,
  onBack,
}: {
  deptId: string;
  onBack: () => void;
}) {
  const { kanban, kanbanLoaded, loading, refresh } = useTasks();
  const [selected, setSelected] = useState<KanbanTask | null>(null);
  const [creating, setCreating] = useState(false);
  const role = ROLES.find((r) => r.id === deptId);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const myTasks = useMemo(() => {
    const key = deptId.toLowerCase();
    return kanban.filter((t) => (t.assignee ?? "").toLowerCase().includes(key));
  }, [kanban, deptId]);

  const byCol = useMemo(() => {
    const m: Record<BoardColumn, KanbanTask[]> = { todo: [], ready: [], running: [], done: [] };
    for (const t of myTasks) m[columnForStatus(t.status)].push(t);
    for (const k of Object.keys(m) as BoardColumn[]) m[k].sort((a, b) => taskAgeMs(b) - taskAgeMs(a));
    return m;
  }, [myTasks]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-[#1f2024] px-4 py-3 text-[11.5px]">
        <button onClick={onBack} className="text-[#8a8a92] transition hover:text-[#c7c7cd]">
          {role?.label ?? deptId}
        </button>
        <span className="text-[#4a4b52]">›</span>
        <span className="text-[#e4e4e8]">Tasks</span>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto rounded-lg bg-[#222327] px-2.5 py-1 text-[11px] font-medium text-[#e4e4e8] transition hover:bg-[#2a2b30]"
        >
          + New task
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!kanbanLoaded ? (
          <div className="text-[12.5px] text-[#6a6a72]">{loading ? "Loading…" : ""}</div>
        ) : myTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-3xl">🗂️</div>
            <div className="text-[14px] text-[#c7c7cd]">No tasks yet</div>
            <p className="max-w-xs text-[12.5px] text-[#8a8a92]">
              Nothing delegated to this department. Create one, or ask Cofounder to
              plan work here.
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
                    <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
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
                      items.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSelected(t)}
                          className="rounded-lg border border-[#222327] bg-[#141518] p-2.5 text-left transition hover:border-[#2e2f34] hover:bg-[#17181b]"
                        >
                          <div className="mb-1.5 line-clamp-3 text-[12px] leading-snug text-[#d0d0d5]">
                            {t.title}
                          </div>
                          <div
                            className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[#202127] px-1.5 py-0.5 text-[10px] text-[#b6b6bc]"
                            title={`Delegated by ${delegatorLabel(t.created_by)}`}
                          >
                            <span className="truncate">
                              {delegatorEmoji(t.created_by)} {delegatorLabel(t.created_by)}
                            </span>
                          </div>
                          <div className="flex items-center justify-end">
                            <span className="text-[10px] text-[#6a6a72]">{relativeAge(taskAgeMs(t))}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && <TaskDetailDrawer task={selected} onClose={() => setSelected(null)} />}
      {creating && (
        <NewTaskModal onClose={() => setCreating(false)} onCreated={() => {}} initialAssignee={deptId} />
      )}
    </div>
  );
}
