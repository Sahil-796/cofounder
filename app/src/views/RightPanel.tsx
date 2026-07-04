/**
 * Right-zone rounded panel with the tab bar: Home | Cofounder | Company |
 * Tasks | Library. Owns the active-tab state and passes the shared "send to
 * Cofounder" handler down so Home's composer + suggestions jump into the chat.
 *
 * DEPARTMENT DRILL-DOWN. Clicking a department node on the canvas (or the
 * Company departments grid) replaces the tab bar + body with a
 * breadcrumb-driven drill-down: DepartmentView ("cofounder › <Dept>") →
 * AgentWorkspaceView (that department's single agent), or → its own
 * DepartmentTasksView / DepartmentScratchpadView (scoped to that department,
 * not the generic Tasks/Company tabs). `dept` is owned by AppShell so the
 * canvas and this panel share one navigation state; set it to null to return
 * to the normal tabs.
 */

import HomeTab from "./tabs/HomeTab";
import CofounderTab from "./tabs/CofounderTab";
import CompanyTab from "./tabs/CompanyTab";
import TasksTab from "./tabs/TasksTab";
import LibraryTab from "./tabs/LibraryTab";
import DepartmentView from "./department/DepartmentView";
import AgentWorkspaceView from "./department/AgentWorkspaceView";
import DepartmentTasksView from "./department/DepartmentTasksView";
import DepartmentScratchpadView from "./department/DepartmentScratchpadView";

export type PanelTab = "home" | "cofounder" | "company" | "tasks" | "library";
export type DeptNav = { id: string; view: "department" | "agent" | "tasks" | "scratchpad" };

const TABS: { id: PanelTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "cofounder", label: "Cofounder" },
  { id: "company", label: "Company" },
  { id: "tasks", label: "Tasks" },
  { id: "library", label: "Library" },
];

export default function RightPanel({
  tab,
  setTab,
  founderName,
  workspaceRoot,
  onSendToChat,
  onOpenAgentChat,
  dept,
  setDept,
}: {
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  founderName: string;
  workspaceRoot: string;
  onSendToChat: (text: string) => void;
  /** Open a specific agent's chat (switches to the Cofounder tab + activates it). */
  onOpenAgentChat: (agentId: string) => void;
  /** Department drill-down state, owned by AppShell (shared with the canvas). */
  dept: DeptNav | null;
  setDept: (d: DeptNav | null) => void;
}) {
  if (dept) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-[#212227] bg-[#131417]">
        {dept.view === "department" && (
          <DepartmentView
            deptId={dept.id}
            onBack={() => setDept(null)}
            onOpenAgent={() => setDept({ id: dept.id, view: "agent" })}
            onOpenTasks={() => setDept({ id: dept.id, view: "tasks" })}
            onOpenScratchpad={() => setDept({ id: dept.id, view: "scratchpad" })}
            onOpenChat={(agentId) => {
              setDept(null);
              onOpenAgentChat(agentId);
            }}
          />
        )}
        {dept.view === "agent" && (
          <AgentWorkspaceView
            deptId={dept.id}
            onBack={() => setDept({ id: dept.id, view: "department" })}
            onOpenChat={(agentId) => {
              setDept(null);
              onOpenAgentChat(agentId);
            }}
            onOpenTasks={() => setDept({ id: dept.id, view: "tasks" })}
          />
        )}
        {dept.view === "tasks" && (
          <DepartmentTasksView deptId={dept.id} onBack={() => setDept({ id: dept.id, view: "department" })} />
        )}
        {dept.view === "scratchpad" && (
          <DepartmentScratchpadView deptId={dept.id} onBack={() => setDept({ id: dept.id, view: "department" })} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-[#212227] bg-[#131417]">
      {/* tab bar */}
      <div className="flex items-center gap-1 border-b border-[#1f2024] px-3 py-2.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
              tab === t.id
                ? "bg-[#26272c] text-[#f0f0f2]"
                : "text-[#8a8a92] hover:text-[#d0d0d5]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* body */}
      <div className="min-h-0 flex-1">
        {tab === "home" && <HomeTab founderName={founderName} onSend={onSendToChat} />}
        {tab === "cofounder" && <CofounderTab />}
        {tab === "company" && (
          <CompanyTab
            workspaceRoot={workspaceRoot}
            onOpenAgentChat={onOpenAgentChat}
            onOpenDepartment={(id) => setDept({ id, view: "department" })}
          />
        )}
        {tab === "tasks" && <TasksTab />}
        {tab === "library" && <LibraryTab />}
      </div>
    </div>
  );
}
