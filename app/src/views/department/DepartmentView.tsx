/**
 * Department overview — reached by clicking a department node on the canvas
 * (or the Company departments grid). Breadcrumb "cofounder › <Department>", a
 * header with the fuller department description, a colored hero band, and
 * four section rows (Agents / Tasks / Scratchpad / Context) matching the
 * reference screenshot. "Agents" drills into AgentWorkspaceView; "Tasks" and
 * "Scratchpad" drill into their own department-scoped pages (DepartmentTasksView
 * / DepartmentScratchpadView) rather than bouncing out to the generic Tasks /
 * Company tabs that show every department at once. A "Chat" button in the
 * header jumps straight into this department's real chat without going
 * through the Agents sub-page first.
 */

import { useEffect, useMemo, useState } from "react";
import { ROLES } from "@/lib/cofounder/roles";
import { fetchKanbanBoard, columnForStatus, type KanbanTask } from "@/lib/cofounder/extraRest";
import { loadConfig } from "@/lib/cofounder/config";

export default function DepartmentView({
  deptId,
  onBack,
  onOpenAgent,
  onOpenTasks,
  onOpenScratchpad,
  onOpenChat,
}: {
  deptId: string;
  onBack: () => void;
  onOpenAgent: () => void;
  /** Open this department's own scoped tasks page (DepartmentTasksView). */
  onOpenTasks: () => void;
  /** Open this department's own scoped scratchpad page (DepartmentScratchpadView). */
  onOpenScratchpad: () => void;
  /** Jump straight into this department's real chat (skips the Agents sub-page). */
  onOpenChat: (agentId: string) => void;
}) {
  const role = ROLES.find((r) => r.id === deptId);
  const [tasks, setTasks] = useState<KanbanTask[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchKanbanBoard().then((board) => {
      if (!cancelled) setTasks(board);
    });
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  const myTasks = useMemo(() => {
    if (!tasks) return [];
    const key = deptId.toLowerCase();
    return tasks.filter((t) => (t.assignee ?? "").toLowerCase().includes(key));
  }, [tasks, deptId]);
  const activeCount = myTasks.filter((t) => columnForStatus(t.status) !== "done").length;

  if (!role) {
    return (
      <div className="flex h-full items-center justify-center text-[12.5px] text-[#6a6a72]">
        Unknown department.
      </div>
    );
  }

  const config = loadConfig();
  const agentCount = role.skill ? 1 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 border-b border-[#1f2024] px-4 py-3 text-[11.5px]">
        <button onClick={onBack} className="text-[#8a8a92] transition hover:text-[#c7c7cd]">
          cofounder
        </button>
        <span className="text-[#4a4b52]">›</span>
        <span className="text-[#e4e4e8]">{role.label}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[15px]"
              style={{ background: role.color + "26" }}
            >
              {role.emoji}
            </span>
            <h1 className="text-[19px] font-semibold text-[#f0f0f2]">{role.label}</h1>
            <button
              onClick={() => role.skill && onOpenChat(deptId)}
              disabled={!role.skill}
              title={role.skill ? `Chat with ${role.label}` : "No agent installed for this department yet."}
              className={`ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition ${
                role.skill
                  ? "bg-[#222327] text-[#e4e4e8] hover:bg-[#2a2b30]"
                  : "cursor-not-allowed bg-[#1a1b1e] text-[#5f5f67]"
              }`}
            >
              💬 Chat
            </button>
          </div>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-[#9a9aa2]">{role.deptBlurb}</p>
        </div>

        {/* Hero band */}
        <div
          className="mb-4 h-32 w-full rounded-2xl border border-[#222327]"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${role.color}33, transparent 60%), linear-gradient(135deg, #17181b, #0f1012)`,
          }}
        />

        {/* Sections */}
        <SectionRow
          emoji="👤"
          title="Agents"
          count={agentCount}
          info="The default and custom agents assigned to this department."
          onClick={role.skill ? onOpenAgent : undefined}
          disabledHint={role.skill ? undefined : "No agent installed for this department yet."}
        />
        <SectionRow
          emoji="🗂️"
          title="Tasks"
          count={activeCount}
          info="Current and recent work owned by this department's agents."
          onClick={onOpenTasks}
        />
        <SectionRow
          emoji="📝"
          title="Scratchpad"
          info="Files, notes, and draft artifacts produced while agents work."
          onClick={onOpenScratchpad}
        />
        <SectionRow
          emoji="📎"
          title="Context"
          count={config?.companyName ? 1 : 0}
          info="Company profile and shared context this department reads."
        />
      </div>
    </div>
  );
}

function SectionRow({
  emoji,
  title,
  count,
  info,
  onClick,
  disabledHint,
}: {
  emoji: string;
  title: string;
  count?: number;
  info: string;
  onClick?: () => void;
  disabledHint?: string;
}) {
  const clickable = !!onClick;
  const Comp = clickable ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      title={disabledHint}
      className={`mb-2.5 flex w-full items-center gap-2.5 rounded-xl border border-[#1f2024] bg-[#141518] p-3 text-left transition ${
        clickable ? "hover:border-[#2e2f34] hover:bg-[#17181b]" : disabledHint ? "opacity-50" : ""
      }`}
    >
      <span className="text-[14px]">{emoji}</span>
      <div className="flex flex-1 items-center gap-1.5">
        <span className="text-[12.5px] font-medium text-[#e4e4e8]">{title}</span>
        <span title={info} className="cursor-help text-[10px] text-[#5f5f67]">
          ⓘ
        </span>
        {count != null && <span className="text-[10.5px] text-[#6a6a72]">{count}</span>}
      </div>
      {clickable && <span className="text-[#5f5f67]">›</span>}
    </Comp>
  );
}
