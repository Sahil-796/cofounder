/**
 * Task detail drawer — slides in from the right when a task card is clicked.
 * Shows the full title, status, assignee, created/started/completed times, the
 * body + comments + lifecycle events (from `hermes kanban show <id> --json`),
 * and the task's transcript.
 *
 * Transcript correlation (best-effort, in priority order):
 *   1. A LIVE delegation whose parentSessionId or childSessionId matches the
 *      task's session_id (live streaming buffer from the delegations store).
 *   2. A finished run's child_session_id → session.history(child_session_id).
 *   3. The task's own session_id → session.history (the ACP loop that ran it).
 *
 * The raw task id is NOT shown prominently — it appears once as small muted
 * metadata with a copy button.
 */

import { useEffect, useMemo, useState } from "react";
import {
  fetchKanbanDetail,
  taskAgeMs,
  type KanbanDetail,
  type KanbanTask,
} from "@/lib/cofounder/extraRest";
import { roleEmoji, roleLabel } from "@/lib/cofounder/roles";
import { relativeAge } from "@/state/tasks";
import { useDelegations, loadSessionHistory } from "@/state/delegations";
import type { ChatMessage } from "@/lib/hermes";
import { LiveThread, MessageThread } from "./transcript";

function fmtTime(secs?: number | null): string {
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

export default function TaskDetailDrawer({
  task,
  onClose,
}: {
  task: KanbanTask;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<KanbanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<ChatMessage[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const live = useDelegations((s) => s.live);

  // A live delegation tied to this task's originating session.
  const liveRun = useMemo(() => {
    const sid = task.session_id;
    const runs = Object.values(live);
    return (
      runs.find(
        (r) => sid && (r.parentSessionId === sid || r.childSessionId === sid),
      ) ??
      runs.find((r) => sid && r.childSessionId === sid) ??
      null
    );
  }, [live, task.session_id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchKanbanDetail(task.id).then((d) => {
      if (alive) {
        setDetail(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [task.id]);

  // Resolve a child/originating session id to load a persisted transcript.
  const childSessionId = useMemo(() => {
    const runs = detail?.runs ?? [];
    for (const r of runs) {
      const cs = r.child_session_id || r.session_id;
      if (typeof cs === "string" && cs) return cs;
    }
    return task.session_id || null;
  }, [detail, task.session_id]);

  useEffect(() => {
    // Only load persisted history when there's no live run streaming.
    if (liveRun || !childSessionId) {
      setHistory(null);
      return;
    }
    let alive = true;
    setHistLoading(true);
    void loadSessionHistory(childSessionId)
      .then((msgs) => {
        if (alive) setHistory(msgs);
      })
      .catch(() => {
        if (alive) setHistory([]);
      })
      .finally(() => {
        if (alive) setHistLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [childSessionId, liveRun]);

  const t = detail?.task ?? task;
  const copyId = () => {
    void navigator.clipboard?.writeText(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-[#222327] bg-[#111214] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#1c1d21] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium leading-snug text-[#e4e4e8]">
              {t.title}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[#202127] px-1.5 py-0.5 text-[10px] text-[#b6b6bc]"
                title={roleLabel(t.assignee)}
              >
                <span>{roleEmoji(t.assignee)}</span>
                <span>{roleLabel(t.assignee)}</span>
              </span>
              <StatusPill status={t.status} />
              <span className="text-[10px] text-[#6a6a72]">
                {relativeAge(taskAgeMs(t))}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[15px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <Meta label="Created" value={fmtTime(t.created_at)} />
            <Meta label="Started" value={fmtTime(t.started_at)} />
            <Meta label="Completed" value={fmtTime(t.completed_at)} />
            <Meta label="Created by" value={detail?.task.created_by ?? "—"} />
          </div>

          {/* Body */}
          {detail?.task.body && (
            <Section title="Description">
              <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#c2c2c8]">
                {detail.task.body}
              </div>
            </Section>
          )}

          {/* Comments */}
          {detail && detail.comments.length > 0 && (
            <Section title={`Comments (${detail.comments.length})`}>
              <div className="flex flex-col gap-2">
                {detail.comments.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-[#1f2024] bg-[#141518] px-2.5 py-1.5"
                  >
                    <div className="mb-0.5 flex items-center gap-2 text-[10px] text-[#6a6a72]">
                      <span className="text-[#9a9aa2]">{c.author ?? "unknown"}</span>
                      <span>{relativeAge((c.created_at ?? 0) * 1000)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-[12px] text-[#c2c2c8]">
                      {c.body}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Events */}
          {detail && detail.events.length > 0 && (
            <Section title="Activity">
              <div className="flex flex-col gap-1">
                {detail.events.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-[#a6a6ac]">{e.kind}</span>
                    <span className="text-[10px] text-[#6a6a72]">
                      {relativeAge((e.created_at ?? 0) * 1000)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Transcript */}
          <Section title="Transcript">
            {liveRun ? (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[#e8c37a]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e8c37a]" />
                  live
                  {liveRun.model && (
                    <span className="font-normal normal-case tracking-normal text-[#6a6a72]">
                      · {liveRun.model}
                    </span>
                  )}
                </div>
                <LiveThread entries={liveRun.entries} />
              </div>
            ) : histLoading ? (
              <div className="text-[12px] text-[#6a6a72]">Loading transcript…</div>
            ) : history && history.length > 0 ? (
              <MessageThread messages={history} />
            ) : (
              <div className="rounded-lg border border-dashed border-[#1f2024] px-3 py-4 text-center text-[11.5px] text-[#6a6a72]">
                {loading
                  ? "Loading…"
                  : "No transcript is linked to this task yet. It appears once a run executes it."}
              </div>
            )}
          </Section>

          {/* Muted id metadata */}
          <div className="mt-6 flex items-center gap-2 text-[10px] text-[#54545c]">
            <span>id</span>
            <code className="rounded bg-[#141518] px-1.5 py-0.5 font-mono text-[#7a7a82]">
              {task.id}
            </code>
            <button
              onClick={copyId}
              className="text-[#6a6a72] transition hover:text-[#b6b6bc]"
              title="Copy id"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wide text-[#5f5f67]">
        {label}
      </div>
      <div className="truncate text-[#a6a6ac]" title={value}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#7a7a82]">
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const blocked = status === "blocked";
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
      style={{
        background: blocked ? "#3a1c1c" : "#202127",
        color: blocked ? "#e08a8a" : "#a6a6ac",
      }}
    >
      {status}
    </span>
  );
}
