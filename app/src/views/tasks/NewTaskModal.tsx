/**
 * New-task modal — a small form to create a kanban task from the UI. Title is
 * required; assignee is a role dropdown from roles.ts; description and priority
 * are optional (both supported by `hermes kanban create`). On success it calls
 * onCreated so the board can refresh instantly.
 *
 * Three creation actions, all of which create the task first:
 *  - "Create & run now" — also nudges the assigned role's chat to start work.
 *  - "Create & consult Cofounder" — also switches to the Cofounder chat and
 *    asks it to route/kick off the task.
 *  - "Just create" — board-only, no chat action (previous default behavior).
 * Chat actions reuse the existing chat store (state/chat.ts) — this file only
 * calls its public actions, it does not modify that store.
 */

import { useState } from "react";
import { ROLES } from "@/lib/cofounder/roles";
import { createKanbanTask } from "@/lib/cofounder/extraRest";
import { useChat } from "@/state/chat";

type CreateMode = "run" | "consult" | "plain";

export default function NewTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("");
  const [submitting, setSubmitting] = useState<CreateMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !submitting;

  const submit = async (mode: CreateMode) => {
    if (!canSubmit) return;
    setSubmitting(mode);
    setError(null);
    try {
      const trimmedTitle = title.trim();
      await createKanbanTask({
        title: trimmedTitle,
        assignee: assignee || undefined,
        body: body || undefined,
        priority: priority.trim() ? Number(priority) : undefined,
      });
      onCreated();
      if (mode === "run" && assignee) {
        const desc = body.trim();
        void useChat
          .getState()
          .sendTo(
            assignee,
            `Work on this task: ${trimmedTitle}` + (desc ? ` — ${desc}` : ""),
          );
      } else if (mode === "consult") {
        useChat.getState().setActiveAgent("cofounder");
        void useChat
          .getState()
          .sendTo(
            "cofounder",
            `I created a task "${trimmedTitle}" assigned to ${
              assignee || "no one yet"
            }. Route/kick it off as you see fit.`,
          );
      }
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setSubmitting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-[#222327] bg-[#141518] p-4 shadow-xl">
        <div className="mb-3 text-[14px] font-medium text-[#e4e4e8]">New task</div>

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7a7a82]">
          Title
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit("plain");
          }}
          placeholder="What needs doing?"
          className="mb-3 w-full rounded-lg border border-[#26272c] bg-[#0f1012] px-2.5 py-1.5 text-[13px] text-[#e4e4e8] outline-none placeholder:text-[#54545c] focus:border-[#3a3b42]"
        />

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7a7a82]">
          Assign to
        </label>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[#26272c] bg-[#0f1012] px-2.5 py-1.5 text-[13px] text-[#e4e4e8] outline-none focus:border-[#3a3b42]"
        >
          <option value="">Cofounder (unassigned)</option>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.emoji} {r.label}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7a7a82]">
          Description <span className="text-[#54545c]">(optional)</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add context or a spec…"
          className="mb-3 w-full resize-none rounded-lg border border-[#26272c] bg-[#0f1012] px-2.5 py-1.5 text-[13px] text-[#e4e4e8] outline-none placeholder:text-[#54545c] focus:border-[#3a3b42]"
        />

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7a7a82]">
          Priority <span className="text-[#54545c]">(optional, higher = sooner)</span>
        </label>
        <input
          value={priority}
          onChange={(e) => setPriority(e.target.value.replace(/[^0-9-]/g, ""))}
          inputMode="numeric"
          placeholder="0"
          className="mb-3 w-full rounded-lg border border-[#26272c] bg-[#0f1012] px-2.5 py-1.5 text-[13px] text-[#e4e4e8] outline-none placeholder:text-[#54545c] focus:border-[#3a3b42]"
        />

        {error && (
          <div className="mb-3 rounded-lg border border-[#3a1c1c] bg-[#1c1416] px-2.5 py-1.5 text-[11px] text-[#e08a8a]">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => void submit("run")}
            disabled={!canSubmit || !assignee}
            title={assignee ? "" : "Assign a role first"}
            className="w-full rounded-lg bg-[#e8c37a] px-3 py-1.5 text-[12.5px] font-medium text-[#1a1508] transition hover:bg-[#f0cd88] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting === "run" ? "Creating…" : "Create & run now"}
          </button>
          <button
            onClick={() => void submit("consult")}
            disabled={!canSubmit}
            className="w-full rounded-lg border border-[#2e2f34] bg-[#1a1b1f] px-3 py-1.5 text-[12.5px] font-medium text-[#e4e4e8] transition hover:bg-[#202127] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting === "consult" ? "Creating…" : "Create & consult Cofounder"}
          </button>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[12.5px] text-[#8a8a92] transition hover:text-[#c7c7cd]"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit("plain")}
              disabled={!canSubmit}
              className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#8a8a92] transition hover:text-[#c7c7cd] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting === "plain" ? "Creating…" : "Just create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
