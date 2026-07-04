/**
 * Delegations / Activity view — the second sub-tab of the Tasks screen.
 * Replaces the old thin "Live sessions" strip with three sections:
 *
 *   1. Live delegations — sub-agent runs streaming right now, each with its
 *      live transcript (goal, streamed text, tool chips), from the delegations
 *      store (subscribed to subagent.* events).
 *   2. Past runs — persisted spawn trees (cross-session) from spawn_tree.list;
 *      clicking one loads the full snapshot via spawn_tree.load and renders each
 *      sub-agent's goal / summary / tool tail.
 *   3. Chat sessions — plain conversations from sessions.list(); click to view a
 *      read-only transcript (session.history); delete with a confirm.
 */

import { useEffect, useMemo, useState } from "react";
import {
  useDelegations,
  loadSessionHistory,
  deleteSession,
  type LiveDelegation,
  type SpawnTreeSnapshot,
} from "@/state/delegations";
import { useTasks, relativeAge } from "@/state/tasks";
import type { ChatMessage, SpawnTreeEntry } from "@/lib/hermes";
import { LiveThread, MessageThread, ToolChip } from "./transcript";

export default function DelegationsView() {
  const live = useDelegations((s) => s.live);
  const history = useDelegations((s) => s.history);
  const historyLoaded = useDelegations((s) => s.historyLoaded);
  const refreshHistory = useDelegations((s) => s.refreshHistory);
  const clearFinished = useDelegations((s) => s.clearFinished);
  const chatSessions = useTasks((s) => s.sessions);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const liveRuns = useMemo(
    () =>
      Object.values(live).sort((a, b) => b.updatedAt - a.updatedAt),
    [live],
  );
  const activeCount = liveRuns.filter((r) => !r.finished).length;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Live delegations */}
      <SectionHeader
        title="Live delegations"
        count={activeCount}
        action={
          liveRuns.some((r) => r.finished) ? (
            <button
              onClick={clearFinished}
              className="text-[10.5px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
            >
              clear finished
            </button>
          ) : null
        }
      />
      {liveRuns.length === 0 ? (
        <Empty text="No delegated runs yet. When Cofounder hands work to a sub-agent, it streams here live." />
      ) : (
        <div className="flex flex-col gap-2">
          {liveRuns.map((r) => (
            <LiveRunCard key={r.key} run={r} />
          ))}
        </div>
      )}

      {/* Past runs */}
      <div className="mt-6">
        <SectionHeader
          title="Past runs"
          count={history.length}
          action={
            <button
              onClick={() => void refreshHistory()}
              className="text-[10.5px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
            >
              refresh
            </button>
          }
        />
        {!historyLoaded ? (
          <Empty text="Loading…" />
        ) : history.length === 0 ? (
          <Empty text="No archived spawn trees on disk yet." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {history.map((e) => (
              <PastRunCard key={e.path} entry={e} />
            ))}
          </div>
        )}
      </div>

      {/* Chat sessions */}
      <div className="mt-6">
        <SectionHeader title="Chat sessions" count={chatSessions.length} />
        {chatSessions.length === 0 ? (
          <Empty text="No chat sessions." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {chatSessions.map((s) => (
              <SessionRow key={s.id} id={s.id} title={s.title} preview={s.preview} startedAt={s.started_at} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#7a7a82]">
          {title}
        </span>
        {count != null && (
          <span className="text-[10.5px] text-[#5f5f67]">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#1f2024] px-3 py-4 text-center text-[11.5px] text-[#6a6a72]">
      {text}
    </div>
  );
}

function LiveRunCard({ run }: { run: LiveDelegation }) {
  const [open, setOpen] = useState(!run.finished);
  return (
    <div className="rounded-lg border border-[#222327] bg-[#141518]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <span
          className={
            "h-1.5 w-1.5 shrink-0 rounded-full " +
            (run.finished ? "bg-[#7ad39a]" : "animate-pulse bg-[#e8c37a]")
          }
        />
        <span className="flex-1 truncate text-[12px] text-[#d0d0d5]">
          {run.goal}
        </span>
        {run.model && (
          <span className="shrink-0 text-[10px] text-[#6a6a72]">{run.model}</span>
        )}
        <span className="shrink-0 text-[10px] text-[#6a6a72]">
          {run.finished
            ? run.durationSeconds
              ? `${run.durationSeconds.toFixed(0)}s`
              : run.status
            : "running"}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#1c1d21] px-2.5 py-2">
          <LiveThread entries={run.entries} />
          {run.summary && (
            <div className="mt-2 rounded-md border-l-2 border-[#2a3a2f] bg-[#0f1310] px-2 py-1 text-[11.5px] text-[#9ac0a6]">
              {run.summary}
            </div>
          )}
          {run.filesWritten && run.filesWritten.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {run.filesWritten.map((f, i) => (
                <span
                  key={i}
                  className="rounded bg-[#17181b] px-1.5 py-0.5 text-[10px] text-[#8a8a92]"
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PastRunCard({ entry }: { entry: SpawnTreeEntry }) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<SpawnTreeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const loadSnapshot = useDelegations((s) => s.loadSnapshot);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !snap && !loading) {
      setLoading(true);
      void loadSnapshot(entry.path)
        .then((s) => setSnap(s))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="rounded-lg border border-[#222327] bg-[#141518]">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7ad39a]" />
        <span className="flex-1 truncate text-[12px] text-[#d0d0d5]">
          {entry.label || `${entry.count} subagents`}
        </span>
        <span className="shrink-0 text-[10px] text-[#6a6a72]">{entry.count}×</span>
        <span className="shrink-0 text-[10px] text-[#6a6a72]">
          {relativeAge((entry.finished_at ?? 0) * 1000)}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#1c1d21] px-2.5 py-2">
          {loading ? (
            <div className="text-[11.5px] text-[#6a6a72]">Loading snapshot…</div>
          ) : !snap || snap.subagents.length === 0 ? (
            <div className="text-[11.5px] text-[#6a6a72]">
              Snapshot empty or unreadable.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {snap.subagents.map((sa) => (
                <div key={sa.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#d0d0d5]">{sa.goal}</span>
                    <span className="text-[10px] text-[#6a6a72]">{sa.status}</span>
                    {sa.durationSeconds != null && (
                      <span className="text-[10px] text-[#6a6a72]">
                        {sa.durationSeconds.toFixed(0)}s
                      </span>
                    )}
                  </div>
                  {sa.summary && (
                    <div className="text-[11.5px] leading-relaxed text-[#a6a6ac]">
                      {sa.summary}
                    </div>
                  )}
                  {sa.outputTail && sa.outputTail.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sa.outputTail.map((o, i) => (
                        <ToolChip key={i} tool={o.tool} preview={o.preview} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  id,
  title,
  preview,
  startedAt,
}: {
  id: string;
  title: string;
  preview: string;
  startedAt: number;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !msgs && !loading) {
      setLoading(true);
      void loadSessionHistory(id)
        .then((m) => setMsgs(m))
        .catch(() => setMsgs([]))
        .finally(() => setLoading(false));
    }
  };

  const doDelete = () => {
    setErr(null);
    void deleteSession(id)
      .then(() => setDeleted(true))
      .catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  };

  if (deleted) return null;

  return (
    <div className="rounded-lg border border-[#222327] bg-[#141518]">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button onClick={toggle} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[12px] text-[#d0d0d5]">
            {title || "Untitled chat"}
          </span>
          {preview && (
            <span className="truncate text-[10.5px] text-[#6a6a72]">{preview}</span>
          )}
        </button>
        <span className="shrink-0 text-[10px] text-[#6a6a72]">
          {relativeAge((startedAt ?? 0) * 1000)}
        </span>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={doDelete}
              className="text-[10.5px] text-[#e08a8a] transition hover:text-[#f0a0a0]"
            >
              delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-[10.5px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 text-[12px] text-[#6a6a72] transition hover:text-[#e08a8a]"
            title="Delete session"
          >
            🗑
          </button>
        )}
      </div>
      {err && (
        <div className="border-t border-[#1c1d21] px-2.5 py-1.5 text-[10.5px] text-[#e08a8a]">
          {err}
        </div>
      )}
      {open && (
        <div className="border-t border-[#1c1d21] px-2.5 py-2">
          {loading ? (
            <div className="text-[11.5px] text-[#6a6a72]">Loading transcript…</div>
          ) : msgs && msgs.length > 0 ? (
            <MessageThread messages={msgs} />
          ) : (
            <div className="text-[11.5px] text-[#6a6a72]">Empty conversation.</div>
          )}
        </div>
      )}
    </div>
  );
}
