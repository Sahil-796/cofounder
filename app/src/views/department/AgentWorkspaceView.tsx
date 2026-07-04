/**
 * Agent workspace — the per-agent detail screen reached by drilling into a
 * department (see DepartmentView). Matches the reference screenshot: a back
 * button + agent identity + "Default" badge + "+ New task" up top, then
 * Suggested Next (real per-role suggestions from roles.ts, each of which
 * sends a prompt to that agent's real chat — see lib/cofounder/bootstrap.ts's
 * ROLE_PROFILE_PREFIX comment for why that chat is now a genuine separate
 * Hermes profile, not a persona), Tasks (live kanban count for this agent's
 * profile), Routines (honest "not built yet" placeholder — Hermes has cron,
 * we haven't wired a UI for it), Agent Context (workspace root + company,
 * real config data), Model + Skills (the agent's own profile's configured
 * model, read directly off its config.yaml), and Integrations (suggested
 * connectors for this role from core/connectors.json).
 */

import { useEffect, useMemo, useState } from "react";
import { agentById, ROLES, SUGGESTIONS } from "@/lib/cofounder/roles";
import { roleProfileName } from "@/lib/cofounder/bootstrap";
import { CONNECTORS } from "@/lib/cofounder/assets";
import { loadConfig } from "@/lib/cofounder/config";
import { hermesRest } from "@/lib/hermes";
import { fetchKanbanBoard, columnForStatus, type KanbanTask } from "@/lib/cofounder/extraRest";
import { useChat } from "@/state/chat";
import NewTaskModal from "@/views/tasks/NewTaskModal";

export default function AgentWorkspaceView({
  deptId,
  onBack,
  onOpenChat,
  onOpenTasks,
}: {
  deptId: string;
  onBack: () => void;
  /** Switch to this agent's real chat (Cofounder tab, that agent active). */
  onOpenChat: (agentId: string) => void;
  /** Switch to the Tasks tab. */
  onOpenTasks: () => void;
}) {
  const role = ROLES.find((r) => r.id === deptId);
  const [creating, setCreating] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(true);
  const [tasks, setTasks] = useState<KanbanTask[] | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState<{ loading: boolean; value: string | null; error: string | null }>({
    loading: false,
    value: null,
    error: null,
  });

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

  const suggestions = SUGGESTIONS.filter((s) => s.role === deptId);
  const config = loadConfig();

  const loadModel = () => {
    if (model.value || model.loading) return;
    setModel({ loading: true, value: null, error: null });
    void hermesRest
      .fsReadText<{ text?: string }>(`~/.hermes/profiles/${roleProfileName(deptId)}/config.yaml`)
      .then((res) => {
        const text = res.text ?? "";
        const m = text.match(/default:\s*(\S+)/);
        setModel({ loading: false, value: m ? m[1] : "default", error: null });
      })
      .catch((err) => setModel({ loading: false, value: null, error: String(err) }));
  };

  if (!role) {
    return (
      <div className="flex h-full items-center justify-center text-[12.5px] text-[#6a6a72]">
        Unknown department.
      </div>
    );
  }

  const connectors = CONNECTORS.roles[deptId] ?? [];
  const agentName = `${role.label} Agent`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-[#1f2024] px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12.5px] text-[#8a8a92] transition hover:text-[#c7c7cd]"
        >
          ← Back
        </button>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-[13px]"
          style={{ background: role.color + "26" }}
        >
          {role.emoji}
        </span>
        <span className="text-[14px] font-semibold text-[#f0f0f2]">{agentName}</span>
        <span className="rounded-full border border-[#2a2b30] px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-[#7a7a82]">
          Default
        </span>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto rounded-lg bg-[#e8c37a] px-2.5 py-1.5 text-[11.5px] font-medium text-[#1a1508] transition hover:bg-[#f0cd88]"
        >
          + New task
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Suggested Next */}
        <SectionCard>
          <SectionHeader
            title="Suggested Next"
            expanded={suggestOpen}
            onToggle={() => setSuggestOpen((v) => !v)}
          />
          {suggestOpen && (
            <div className="mt-2 flex flex-col gap-2">
              {suggestions.length === 0 ? (
                <Empty text="No canned suggestions for this role yet — just ask in chat." />
              ) : (
                <>
                  <FeaturedSuggestion
                    text={suggestions[0].text}
                    emoji={suggestions[0].emoji}
                    onStart={() => {
                      void useChat.getState().sendTo(deptId, suggestions[0].text);
                      onOpenChat(deptId);
                    }}
                  />
                  {suggestions.slice(1).map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        void useChat.getState().sendTo(deptId, s.text);
                        onOpenChat(deptId);
                      }}
                      className="flex items-center gap-2 rounded-lg border border-[#222327] bg-[#141518] px-3 py-2 text-left transition hover:border-[#2e2f34] hover:bg-[#17181b]"
                    >
                      <span className="text-[12px]">⚡</span>
                      <span className="flex-1 text-[12px] text-[#c7c7cd]">{s.text}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </SectionCard>

        {/* Tasks */}
        <RowCard
          title="Tasks"
          info="Current and recent work owned by this agent."
          count={activeCount}
          onClick={onOpenTasks}
        />

        {/* Routines */}
        <RowCard
          title="Routines"
          info="Scheduled or recurring runs for this agent — not built yet."
          count={0}
          disabled
        />

        {/* Agent Context */}
        <SectionCard>
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <RowHeading title="Agent Context" info="What this agent reads before it works." count={1} />
            <span className="text-[#5f5f67]">{contextOpen ? "▾" : "›"}</span>
          </button>
          {contextOpen && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-[#1c1d21] pt-2 text-[11.5px] text-[#a7a7ae]">
              <div>
                <span className="text-[#6a6a72]">Workspace root: </span>
                {config?.workspaceRoot || "(not configured)"}
              </div>
              <div>
                <span className="text-[#6a6a72]">Company: </span>
                {config?.companyName || "(not set)"}
              </div>
              <div>
                <span className="text-[#6a6a72]">Charter: </span>
                {role.deptBlurb}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Model + Skills */}
        <SectionCard>
          <button
            onClick={() => {
              setModelOpen((v) => !v);
              loadModel();
            }}
            className="flex w-full items-center justify-between"
          >
            <RowHeading title="Model + Skills" info="What this agent runs on." />
            <span className="text-[#5f5f67]">{modelOpen ? "▾" : "›"}</span>
          </button>
          {modelOpen && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-[#1c1d21] pt-2 text-[11.5px] text-[#a7a7ae]">
              <div>
                <span className="text-[#6a6a72]">Model: </span>
                {model.loading ? "loading…" : model.error ? "unavailable" : model.value}
                <span className="ml-1.5 text-[#5f5f67]">
                  (change it from this agent's own chat's model picker)
                </span>
              </div>
              <div>
                <span className="text-[#6a6a72]">Skill: </span>
                {role.blurb}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Integrations */}
        <SectionCard>
          <RowHeading title="Integrations" info="Suggested connectors for this role." count={connectors.length} />
          {connectors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#1c1d21] pt-2">
              {connectors.map((c) => (
                <span
                  key={c.id}
                  title={c.why}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                    c.builtin
                      ? "border-[#243027] bg-[#16211a] text-[#8fd0a5]"
                      : "border-[#2c2d33] bg-[#181a1e] text-[#a7a7ae]"
                  }`}
                >
                  {c.name}
                  {c.builtin ? " ·built-in" : ""}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {creating && (
        <NewTaskModal
          onClose={() => setCreating(false)}
          onCreated={() => {}}
          initialAssignee={deptId}
        />
      )}
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 rounded-xl border border-[#1f2024] bg-[#141518] p-3">
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="flex w-full items-center justify-between">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#8a8a92]">
        {title}
      </span>
      <span className="text-[#5f5f67]">{expanded ? "▾" : "›"}</span>
    </button>
  );
}

function RowHeading({ title, info, count }: { title: string; info: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 text-left">
      <span className="text-[12.5px] font-medium text-[#e4e4e8]">{title}</span>
      <span title={info} className="cursor-help text-[10px] text-[#5f5f67]">
        ⓘ
      </span>
      {count != null && <span className="text-[10.5px] text-[#6a6a72]">{count}</span>}
    </div>
  );
}

function RowCard({
  title,
  info,
  count,
  onClick,
  disabled,
}: {
  title: string;
  info: string;
  count: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const Comp = disabled ? "div" : "button";
  return (
    <Comp
      onClick={onClick}
      title={disabled ? info : undefined}
      className={`mb-2.5 flex w-full items-center justify-between rounded-xl border border-[#1f2024] bg-[#141518] p-3 text-left transition ${
        disabled ? "opacity-50" : "hover:border-[#2e2f34] hover:bg-[#17181b]"
      }`}
    >
      <RowHeading title={title} info={info} count={count} />
      {!disabled && <span className="text-[#5f5f67]">›</span>}
    </Comp>
  );
}

function FeaturedSuggestion({
  text,
  emoji,
  onStart,
}: {
  text: string;
  emoji: string;
  onStart: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#222327] bg-gradient-to-b from-[#181a1e] to-[#141518] p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-[#e4e4e8]">
        <span>{emoji}</span>
        <span>Get started</span>
      </div>
      <p className="mb-2.5 text-[11.5px] leading-relaxed text-[#9a9aa2]">{text}</p>
      <button
        onClick={onStart}
        className="w-full rounded-lg bg-[#e8c37a] px-3 py-1.5 text-[12px] font-medium text-[#1a1508] transition hover:bg-[#f0cd88]"
      >
        Start
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#1f2024] px-3 py-3 text-center text-[11px] text-[#6a6a72]">
      {text}
    </div>
  );
}

export function agentDisplayName(deptId: string): string {
  return `${agentById(deptId).label} Agent`;
}
