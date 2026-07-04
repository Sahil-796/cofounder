/**
 * Per-agent session switcher. A compact dropdown listing THIS agent's stored
 * sessions (chat.ts SessionMeta, sourced from session.list filtered to this
 * app + parsed by title), plus a "New session" action. Selecting a row resumes
 * it (loads history into the thread); the trash icon deletes it. The active
 * session is marked. Dark, compact — sits in the agent switcher row.
 */

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/state/chat";
import { relativeAge } from "@/state/tasks";

export default function SessionSwitcher() {
  const activeAgent = useChat((s) => s.activeAgent);
  const slot = useChat((s) => s.chats[s.activeAgent]);
  const loadSessions = useChat((s) => s.loadSessions);
  const newSession = useChat((s) => s.newSession);
  const switchSession = useChat((s) => s.switchSession);
  const deleteSession = useChat((s) => s.deleteSession);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Refresh this agent's list when the menu opens.
  useEffect(() => {
    if (open) void loadSessions(activeAgent);
  }, [open, activeAgent, loadSessions]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list = slot?.sessions ?? [];
  const activeKey = slot?.sessionKey ?? null;

  return (
    <div ref={wrapRef} className="relative ml-auto flex items-center gap-1">
      <button
        onClick={() => void newSession(activeAgent)}
        title="New session"
        className="inline-flex items-center gap-1 rounded-full border border-[#2a2b30] bg-[#17181b] px-2 py-1 text-[11px] text-[#9a9aa2] transition hover:border-[#3a3b42] hover:text-[#d0d0d5]"
      >
        <span className="text-[12px] leading-none">＋</span>
        <span className="hidden sm:inline">New</span>
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Past sessions"
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition ${
          open
            ? "border-[#3a3b42] bg-[#202127] text-[#e7e7ea]"
            : "border-[#2a2b30] bg-[#17181b] text-[#9a9aa2] hover:border-[#3a3b42] hover:text-[#c7c7cd]"
        }`}
      >
        <span>Sessions</span>
        <span className="text-[#6a6a72]">▾</span>
      </button>

      {open && (
        <div className="co-fadein absolute right-0 top-9 z-40 max-h-80 w-72 overflow-y-auto rounded-2xl border border-[#2a2b30] bg-[#141518] p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]">
          {!slot?.sessionsLoaded && (
            <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">loading sessions…</div>
          )}
          {slot?.sessionsLoaded && list.length === 0 && (
            <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">
              No past sessions yet.
            </div>
          )}
          {list.map((s) => {
            const active = s.key === activeKey;
            return (
              <div
                key={s.key}
                className={`group flex items-center gap-1 rounded-lg px-1 ${
                  active ? "bg-[#202127]" : "hover:bg-[#1a1b1f]"
                }`}
              >
                <button
                  onClick={() => {
                    setOpen(false);
                    if (!active) void switchSession(activeAgent, s.key);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start px-1.5 py-1.5 text-left"
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="w-3 shrink-0 text-[10px] text-emerald-400">{active ? "✓" : ""}</span>
                    <span className="truncate text-[12px] text-[#e7e7ea]">{s.title || "Untitled"}</span>
                  </span>
                  <span className="truncate pl-[18px] text-[10.5px] text-[#6a6a72]">
                    {s.preview || `${s.messageCount} messages`}
                    {s.startedAt ? ` · ${relativeAge(s.startedAt)}` : ""}
                  </span>
                </button>
                <button
                  onClick={() => void deleteSession(activeAgent, s.key)}
                  title="Delete session"
                  className="shrink-0 rounded px-1.5 py-1 text-[12px] text-[#5f5f67] opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
