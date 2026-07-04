/**
 * Multi-agent chat tab — the chat surface for the ACTIVE agent. A compact
 * switcher row at the top selects between the 🌻 Cofounder orchestrator and the
 * five role agents (marketing, research, support, operations, finance), each
 * with an unread/streaming indicator. The thread below renders the active
 * chat's messages: user/assistant bubbles, markdown for assistant text, a
 * collapsible live "Thinking…" block, a "Using X…" activity line, tool-call
 * chips, inline clarify choice buttons, and an inline approval card. The
 * composer doubles as the clarify answer box while a clarify is pending, and
 * disables submit (with an Esc-to-interrupt hint) while the run is in flight.
 *
 * All state lives in the chat store (src/state/chat.ts); this component is pure
 * view + a composer, scoped to the active agent's slot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type ChatSlot } from "@/state/chat";
import { renderMarkdown } from "@/lib/markdown";
import { useConnection } from "@/state/connection";
import { useTasks } from "@/state/tasks";
import { AGENTS, agentById } from "@/lib/cofounder/roles";
import type { KanbanTask } from "@/lib/cofounder/extraRest";
import ModelPicker from "./ModelPicker";
import SessionSwitcher from "../chat/SessionSwitcher";
import LogsDrawer from "../chat/LogsDrawer";
import {
  activeTaskQuery,
  expandForModel,
  insertTaskToken,
} from "../chat/taskTags";

/** Live-ticking elapsed seconds since `since` (epoch ms). */
function useElapsed(since: number | undefined, running: boolean): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (!running || !since) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [since, running]);
  if (!since) return 0;
  return Math.max(0, Math.floor((Date.now() - since) / 1000));
}

export default function CofounderTab() {
  const activeAgent = useChat((s) => s.activeAgent);
  const chat = useChat((s) => s.chats[s.activeAgent]) as ChatSlot;
  const notice = useChat((s) => s.notice);
  const send = useChat((s) => s.send);
  const answerClarify = useChat((s) => s.answerClarify);
  const respondApproval = useChat((s) => s.respondApproval);
  const interrupt = useChat((s) => s.interrupt);
  const clearNotice = useChat((s) => s.clearNotice);
  const ensureSession = useChat((s) => s.ensureSession);

  const agent = agentById(activeAgent);
  const { messages, streaming, connecting, statusText, pendingClarify } = chat;

  const wsState = useConnection((s) => s.wsState);
  const [input, setInput] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick-to-bottom only when the user is already near the bottom; otherwise we
  // leave their scroll position alone and show a "↓ latest" jump button.
  const [atBottom, setAtBottom] = useState(true);

  // Open the active chat's session lazily when it becomes visible.
  useEffect(() => {
    void ensureSession().catch(() => {});
  }, [ensureSession, activeAgent]);

  // Track whether the viewport is pinned to the bottom (within a small slack).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(gap < 80);
  };

  // Only auto-follow new content when already at the bottom.
  useEffect(() => {
    if (!atBottom) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, statusText, atBottom]);

  // Switching agents / opening a session resets the view to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    setAtBottom(true);
  }, [activeAgent]);

  const jumpToLatest = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <AgentSwitcher />

      {notice && (
        <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-300">
          <span>{notice}</span>
          <button onClick={clearNotice} className="text-amber-500 hover:text-amber-300">
            ✕
          </button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-5">
          {empty ? (
            <EmptyChat connecting={connecting} wsState={wsState} />
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  agentEmoji={agent.emoji}
                  agentLabel={agent.label}
                  onClarify={answerClarify}
                  onApprove={() => respondApproval("allow")}
                  onDeny={() => respondApproval("deny")}
                />
              ))}
              {statusText && (
                <div className="flex items-center gap-2 pl-1 text-[12px] text-[#8a8a92]">
                  <Spinner />
                  <span>{statusText}</span>
                </div>
              )}
            </div>
          )}
        </div>
        {!empty && !atBottom && (
          <button
            onClick={jumpToLatest}
            className="co-fadein absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[#2a2b30] bg-[#1c1d21] px-3 py-1 text-[11.5px] text-[#c7c7cd] shadow-lg transition hover:bg-[#26272c]"
          >
            ↓ latest
          </button>
        )}
      </div>

      <Composer
        input={input}
        setInput={setInput}
        streaming={streaming}
        pendingClarify={pendingClarify}
        agentEmoji={agent.emoji}
        agentLabel={agent.label}
        onSend={() => {
          const raw = input;
          setInput("");
          // The user bubble keeps the pretty `#[Title]` tokens; the model gets
          // the expanded bracketed context line (title + status + id).
          void send(raw, expandForModel(raw, useTasks.getState().kanban));
        }}
        onInterrupt={() => void interrupt()}
        onOpenLogs={() => setShowLogs(true)}
      />

      {showLogs && <LogsDrawer onClose={() => setShowLogs(false)} />}
    </div>
  );
}

/** Compact avatar row: 🌻 Cofounder + the 5 role emojis, with per-agent state. */
function AgentSwitcher() {
  const activeAgent = useChat((s) => s.activeAgent);
  const chats = useChat((s) => s.chats);
  const setActiveAgent = useChat((s) => s.setActiveAgent);

  return (
    <div className="flex items-center gap-1.5 border-b border-[#1f2024] px-3 py-2">
      {AGENTS.map((a) => {
        const slot = chats[a.id];
        const active = a.id === activeAgent;
        const streaming = slot?.streaming;
        const unread = slot?.unread;
        return (
          <button
            key={a.id}
            onClick={() => setActiveAgent(a.id)}
            title={a.label}
            className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${
              active
                ? "border-[#3a3b42] bg-[#26272c] text-[#f0f0f2]"
                : "border-transparent text-[#9a9aa2] hover:bg-[#1a1b1f] hover:text-[#d0d0d5]"
            }`}
            style={active ? { boxShadow: `inset 0 -2px 0 ${a.color}` } : undefined}
          >
            <span className="text-[15px] leading-none">{a.emoji}</span>
            <span className={active ? "" : "hidden sm:inline"}>{a.label}</span>
            {/* streaming pulse (ping + solid) or a static unread dot */}
            {streaming ? (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2">
                <span
                  className="absolute inset-0 animate-ping rounded-full opacity-75"
                  style={{ backgroundColor: a.color }}
                />
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: a.color }}
                />
              </span>
            ) : unread ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                style={{ backgroundColor: a.color }}
              />
            ) : null}
          </button>
        );
      })}
      <SessionSwitcher />
    </div>
  );
}

/** Render user text with `#[Task title]` tokens as inline tag chips. */
function UserText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(#\[[^\]]+\])/g), [text]);
  return (
    <>
      {parts.map((p, i) => {
        const tag = /^#\[([^\]]+)\]$/.exec(p);
        if (tag) {
          return (
            <span
              key={i}
              className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-[#3a3b42] px-1.5 py-0.5 text-[12px] text-[#d7d7dc]"
            >
              <span className="text-[10px] text-[#9a9aa2]">#</span>
              {tag[1]}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function MessageBubble({
  m,
  agentEmoji,
  agentLabel,
  onClarify,
  onApprove,
  onDeny,
}: {
  m: import("@/state/chat").ChatMsg;
  agentEmoji: string;
  agentLabel: string;
  onClarify: (id: string, ans: string) => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const html = useMemo(
    () => (m.role === "assistant" ? renderMarkdown(m.text) : ""),
    [m.role, m.text],
  );

  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#2a2b30] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#eaeaee]">
          <UserText text={m.text} />
        </div>
      </div>
    );
  }

  const showActivity =
    m.streaming && m.activity && !m.text && !(m.thinking && m.thinking.active);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-[#7a7a82]">
        <span className="text-sm">{agentEmoji}</span>
        <span>{agentLabel}</span>
      </div>

      {/* live reasoning / thinking */}
      {m.thinking && <ThinkingBlock block={m.thinking} />}

      {/* "Using X…" activity line — never a bare spinner */}
      {showActivity && <ActivityLine label={m.activity!.label} context={m.activity!.context} />}

      {m.tools && m.tools.length > 0 && <ToolSteps tools={m.tools} />}

      {(m.text || (m.streaming && !m.thinking?.active && !showActivity)) && (
        <div
          className={`md max-w-[92%] text-[13.5px] leading-relaxed ${
            m.error ? "text-red-300" : "text-[#dcdce0]"
          }`}
        >
          <span dangerouslySetInnerHTML={{ __html: html }} />
          {m.streaming && <span className="ml-0.5 animate-pulse">▋</span>}
        </div>
      )}

      {m.clarify && (
        <div className="rounded-xl border-2 border-[#c99b4e]/70 bg-[#1a1710] p-3 shadow-[0_0_0_3px_rgba(201,155,78,0.08)]">
          <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#e8c37a]/90">
            <span>{agentLabel} needs your input</span>
          </div>
          <div className="mb-2 text-[13px] text-[#eaeaee]">{m.clarify.question}</div>
          {m.clarify.choices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {m.clarify.choices.map((c) => (
                <button
                  key={c}
                  onClick={() => onClarify(m.clarify!.requestId, c)}
                  className="rounded-full border border-[#c99b4e]/50 bg-[#2a2213]/60 px-3 py-1.5 text-[12px] text-[#f0dcae] transition hover:border-[#c99b4e] hover:bg-[#332a17]"
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <InlineClarifyInput onSubmit={(v) => onClarify(m.clarify!.requestId, v)} />
          )}
        </div>
      )}

      {m.approval && (
        <div className="rounded-xl border-2 border-amber-600/60 bg-amber-950/25 p-3 shadow-[0_0_0_3px_rgba(217,119,6,0.08)]">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-amber-400/90">
            Approval needed
          </div>
          <code className="mb-2 block overflow-x-auto rounded-md bg-black/40 px-2.5 py-1.5 text-[12px] text-amber-200">
            {m.approval.command}
          </code>
          <div className="flex gap-2">
            <button
              onClick={onApprove}
              autoFocus
              className="rounded-md bg-emerald-600/90 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-emerald-600"
            >
              Approve
            </button>
            <button
              onClick={onDeny}
              className="rounded-md border border-[#3a3b42] px-3 py-1.5 text-[12px] text-[#d0d0d6] transition hover:bg-[#26272c]"
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact tool-call summary: a single "N steps" / "N tool calls" line under the
 * Thinking block, expanding on click to the full chip list. Keeps a long tool
 * run from dominating the bubble while the count stays glanceable.
 */
function ToolSteps({ tools }: { tools: import("@/state/chat").ToolChip[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => t.status === "running");
  const noun = tools.length === 1 ? "step" : "steps";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start rounded-full border border-[#26272c] bg-[#141518] px-2.5 py-0.5 text-[11px] text-[#9a9aa2] transition hover:text-[#c7c7cd]"
      >
        {running ? <Spinner small /> : <span className="text-emerald-400">✓</span>}
        <span>
          {tools.length} {noun}
        </span>
        <span className="text-[#5f5f67]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5 pl-0.5">
          {tools.map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                t.status === "running"
                  ? "border-[#33343a] bg-[#1c1d21] text-[#c7c7cd]"
                  : "border-[#243027] bg-[#16211a] text-[#8fd0a5]"
              }`}
            >
              {t.status === "running" ? <Spinner small /> : <span>✓</span>}
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ block }: { block: import("@/state/chat").ThinkingBlock }) {
  const [open, setOpen] = useState(false);
  const secs = useElapsed(block.startedAt, block.active);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && block.active) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [block.text, open, block.active]);

  return (
    <div className="rounded-lg border border-[#26272c] bg-[#141518]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-[#8a8a92] transition hover:text-[#b6b6bc]"
      >
        <span className={block.active ? "animate-pulse" : ""}>💭</span>
        <span className={block.active ? "shimmer-text" : ""}>
          {block.active ? "Thinking" : "Thought"}
          {secs > 0 ? ` for ${secs}s` : "…"}
        </span>
        <span className="ml-auto text-[#5f5f67]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-[#1f2024] px-3 py-2 text-[12px] leading-relaxed text-[#9a9aa2]"
        >
          {block.text || "…"}
        </div>
      )}
    </div>
  );
}

function ActivityLine({ label, context }: { label: string; context?: string }) {
  return (
    <div className="flex items-center gap-2 pl-0.5 text-[12px] text-[#9a9aa2]">
      <Spinner small />
      <span>{label}</span>
      {context && (
        <span className="truncate rounded bg-[#1c1d21] px-1.5 py-0.5 font-mono text-[11px] text-[#7a7a82]">
          {context}
        </span>
      )}
    </div>
  );
}

function InlineClarifyInput({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="flex gap-2">
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) onSubmit(v.trim());
        }}
        placeholder="Type your answer…"
        className="flex-1 rounded-md border border-[#c99b4e]/40 bg-[#111214] px-3 py-1.5 text-[13px] outline-none focus:border-[#c99b4e]"
      />
      <button
        onClick={() => v.trim() && onSubmit(v.trim())}
        className="rounded-md bg-[#e7e7ea] px-3 py-1.5 text-[12px] font-medium text-black"
      >
        Send
      </button>
    </div>
  );
}

function Composer({
  input,
  setInput,
  streaming,
  pendingClarify,
  agentEmoji,
  agentLabel,
  onSend,
  onInterrupt,
  onOpenLogs,
}: {
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  pendingClarify: import("@/state/chat").ClarifyPrompt | null;
  agentEmoji: string;
  agentLabel: string;
  onSend: () => void;
  onInterrupt: () => void;
  onOpenLogs: () => void;
}) {
  const answering = !!pendingClarify;
  // Submit is allowed when there's text AND either we're answering a clarify or
  // no run is in flight. Never fire prompt.submit mid-run.
  const canSubmit = !!input.trim() && (answering || !streaming);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (answering) taRef.current?.focus();
  }, [answering]);

  // Task-tag picker: track the caret so we can detect the active "#query".
  const [caret, setCaret] = useState(0);
  const query = answering ? null : activeTaskQuery(input, caret);
  const pickerOpen = query !== null;

  const pickTask = (t: KanbanTask) => {
    const el = taRef.current;
    const pos = el?.selectionStart ?? input.length;
    const { text, caret: nextCaret } = insertTaskToken(input, pos, t.title);
    setInput(text);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? 0);

  return (
    <div className="relative border-t border-[#222327] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <ModelPicker />
        <button
          onClick={onOpenLogs}
          title="Diagnostics / logs"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#2a2b30] bg-[#17181b] px-2.5 py-1 text-[11px] text-[#8a8a92] transition hover:border-[#3a3b42] hover:text-[#c7c7cd]"
        >
          <span className="text-[11px]">🩺</span>
          <span className="hidden sm:inline">Logs</span>
        </button>
      </div>
      {pickerOpen && (
        <TaskPicker query={query!} onPick={pickTask} onDismiss={() => setCaret(-1)} />
      )}
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-[#141518] px-3 py-2.5 ${
          answering ? "border-[#c99b4e]/70 shadow-[0_0_0_3px_rgba(201,155,78,0.08)]" : "border-[#2a2b30]"
        }`}
      >
        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#202127] px-2 py-0.5 text-[11px] text-[#b6b6bc]">
          {agentEmoji} {agentLabel}
        </span>
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            syncCaret(e.target);
          }}
          onKeyUp={(e) => syncCaret(e.currentTarget)}
          onClick={(e) => syncCaret(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && streaming && !answering) {
              e.preventDefault();
              onInterrupt();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) onSend();
            }
          }}
          placeholder={
            answering ? `Answer ${agentLabel}…` : `Ask ${agentLabel} anything…  (type # to tag a task)`
          }
          className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-[#e7e7ea] outline-none placeholder:text-[#5f5f67]"
        />
        {streaming && !answering ? (
          <button
            onClick={onInterrupt}
            title="Stop (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2b30] text-[#e0e0e4] transition hover:bg-[#34353a]"
          >
            ■
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSubmit}
            title={answering ? "Answer" : "Send"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e7e7ea] text-black transition hover:bg-white disabled:opacity-30"
          >
            ↑
          </button>
        )}
      </div>
      {streaming && !answering && (
        <div className="mt-1.5 px-1 text-[10.5px] text-[#6a6a72]">
          {agentLabel} is working — Esc to interrupt
        </div>
      )}
      {answering && (
        <div className="mt-1.5 px-1 text-[10.5px] text-[#c99b4e]/80">
          Your reply answers {agentLabel}'s question above.
        </div>
      )}
    </div>
  );
}

/**
 * Task-tag picker popover. Opens above the composer when the user types "#";
 * lists kanban tasks (useTasks().kanban, refreshed once if empty) filtered by
 * the live "#query". Selecting one inserts a `#[Title]` token. Dark, compact.
 */
function TaskPicker({
  query,
  onPick,
  onDismiss,
}: {
  query: string;
  onPick: (t: KanbanTask) => void;
  onDismiss: () => void;
}) {
  const kanban = useTasks((s) => s.kanban);
  const kanbanLoaded = useTasks((s) => s.kanbanLoaded);
  const refresh = useTasks((s) => s.refresh);

  // Pull the board once if we don't have it yet — the picker needs live titles.
  useEffect(() => {
    if (!kanbanLoaded && kanban.length === 0) void refresh();
  }, [kanbanLoaded, kanban.length, refresh]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? kanban.filter((t) => t.title.toLowerCase().includes(q)) : kanban;
    return rows.slice(0, 8);
  }, [kanban, query]);

  const statusColor: Record<string, string> = {
    todo: "text-[#8a8a92]",
    doing: "text-[#7ea6e0]",
    in_progress: "text-[#7ea6e0]",
    blocked: "text-amber-400",
    done: "text-[#8fd0a5]",
  };

  return (
    <div className="co-fadein absolute bottom-[86px] left-4 z-40 max-h-64 w-80 overflow-y-auto rounded-2xl border border-[#2a2b30] bg-[#141518] p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6a72]">
        <span>Tag a task</span>
        <button onClick={onDismiss} className="text-[#5f5f67] hover:text-[#9a9aa2]">
          esc
        </button>
      </div>
      {!kanbanLoaded ? (
        <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">loading tasks…</div>
      ) : matches.length === 0 ? (
        <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">
          {kanban.length === 0 ? "No tasks on the board yet." : "No matching tasks."}
        </div>
      ) : (
        <ul>
          {matches.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onPick(t)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[#c7c7cd] transition hover:bg-[#1a1b1f]"
              >
                <span className="text-[10px] text-[#6a6a72]">#</span>
                <span className="flex-1 truncate">{t.title}</span>
                <span className={`text-[10px] ${statusColor[t.status] ?? "text-[#8a8a92]"}`}>
                  {t.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyChat({ connecting, wsState }: { connecting: boolean; wsState: string }) {
  const agent = agentById(useChat((s) => s.activeAgent));
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-4xl">{agent.emoji}</div>
      <div className="text-[15px] font-medium text-[#dcdce0]">
        {agent.orchestrator ? "Your Cofounder is ready" : `Your ${agent.label} agent is ready`}
      </div>
      <p className="max-w-xs text-[12.5px] leading-relaxed text-[#8a8a92]">
        {agent.orchestrator
          ? "Ask a question, hand off a task, or just think out loud. Cofounder decides whether it's a quick reply or a full initiative."
          : `Ask ${agent.label} directly — it works as your ${agent.label.toLowerCase()} specialist on the company workspace.`}
      </p>
      <div className="text-[11px] text-[#5f5f67]">
        {connecting ? "connecting…" : `gateway: ${wsState}`}
      </div>
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  const s = small ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span
      className={`${s} inline-block animate-spin rounded-full border-2 border-[#4a4b52] border-t-transparent`}
    />
  );
}
