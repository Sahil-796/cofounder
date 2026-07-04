/**
 * Delegations / Activity view — the second sub-tab of the Tasks screen.
 * Three sections of compact rows — Live delegations, Past runs, Chat sessions
 * — from the delegations store (subscribed to subagent.* events).
 *
 * Interaction model: master → detail (drill-in), not inline accordion.
 * Clicking any row swaps the whole panel to a full-height DETAIL view for
 * that item (a "← Back" bar + title/meta + a scrollable transcript). The
 * list itself never expands downward. Selection is local state (`selected`),
 * a discriminated union over {kind, key}; opening a past run or chat session
 * fetches its snapshot/history on demand.
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

type Selection =
  | { kind: "live"; key: string }
  | { kind: "past"; key: string; entry: SpawnTreeEntry }
  | { kind: "session"; key: string; title: string; startedAt: number };

export default function DelegationsView() {
  const live = useDelegations((s) => s.live);
  const history = useDelegations((s) => s.history);
  const historyLoaded = useDelegations((s) => s.historyLoaded);
  const refreshHistory = useDelegations((s) => s.refreshHistory);
  const clearFinished = useDelegations((s) => s.clearFinished);
  const chatSessions = useTasks((s) => s.sessions);

  const [selected, setSelected] = useState<Selection | null>(null);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const liveRuns = useMemo(
    () => Object.values(live).sort((a, b) => b.updatedAt - a.updatedAt),
    [live],
  );
  const activeCount = liveRuns.filter((r) => !r.finished).length;

  // If we're viewing a live run and it disappears (evicted), fall back to list.
  useEffect(() => {
    if (selected?.kind === "live" && !live[selected.key]) setSelected(null);
  }, [selected, live]);

  if (selected) {
    return (
      <DetailView
        selection={selected}
        onBack={() => setSelected(null)}
        chatSessions={chatSessions}
      />
    );
  }

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
        <div className="flex flex-col gap-1.5">
          {liveRuns.map((r) => (
            <LiveRunRow
              key={r.key}
              run={r}
              onOpen={() => setSelected({ kind: "live", key: r.key })}
            />
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
              <PastRunRow
                key={e.path}
                entry={e}
                onOpen={() => setSelected({ kind: "past", key: e.path, entry: e })}
              />
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
              <SessionRow
                key={s.id}
                id={s.id}
                title={s.title}
                preview={s.preview}
                startedAt={s.started_at}
                onOpen={() =>
                  setSelected({
                    kind: "session",
                    key: s.id,
                    title: s.title || "Untitled chat",
                    startedAt: s.started_at,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail (drill-in) view ───────────────────────────────────────────────────

function DetailView({
  selection,
  onBack,
  chatSessions,
}: {
  selection: Selection;
  onBack: () => void;
  chatSessions: { id: string; title: string; preview: string; started_at: number }[];
}) {
  if (selection.kind === "live") return <LiveDetail selKey={selection.key} onBack={onBack} />;
  if (selection.kind === "past")
    return <PastDetail entry={selection.entry} onBack={onBack} />;
  return (
    <SessionDetail
      id={selection.key}
      title={selection.title}
      startedAt={selection.startedAt}
      onBack={onBack}
      onDeleted={onBack}
      exists={chatSessions.some((s) => s.id === selection.key)}
    />
  );
}

/** Shared detail chrome: back bar + scrollable transcript body. */
function DetailShell({
  onBack,
  title,
  statusDot,
  meta,
  extra,
  children,
}: {
  onBack: () => void;
  title: string;
  statusDot?: React.ReactNode;
  meta?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[#1c1d21] bg-[#111214] px-3 py-2.5">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[#9a9aa2] transition hover:bg-[#1c1d21] hover:text-[#e4e4e8]"
        >
          <span aria-hidden>←</span> Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {statusDot}
            <span className="truncate text-[13px] font-medium text-[#e4e4e8]">{title}</span>
          </div>
          {meta && <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-[#6a6a72]">{meta}</div>}
        </div>
        {extra}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
}

function LiveDetail({ selKey, onBack }: { selKey: string; onBack: () => void }) {
  const run = useDelegations((s) => s.live[selKey]);
  if (!run) {
    return (
      <DetailShell onBack={onBack} title="Run ended">
        <Empty text="This run is no longer available." />
      </DetailShell>
    );
  }
  return (
    <DetailShell
      onBack={onBack}
      title={run.goal}
      statusDot={
        <span
          className={
            "h-1.5 w-1.5 shrink-0 rounded-full " +
            (run.finished ? "bg-[#7ad39a]" : "animate-pulse bg-[#e8c37a]")
          }
        />
      }
      meta={
        <>
          <span>{run.finished ? "finished" : "running"}</span>
          {run.model && <span>· {run.model}</span>}
          {run.finished && run.durationSeconds != null && (
            <span>· {run.durationSeconds.toFixed(0)}s</span>
          )}
        </>
      }
    >
      <LiveThread entries={run.entries} />
      {run.summary && (
        <div className="mx-auto mt-4 max-w-[720px] rounded-md border-l-2 border-[#2a3a2f] bg-[#0f1310] px-3 py-2 text-[12px] leading-relaxed text-[#9ac0a6]">
          {run.summary}
        </div>
      )}
      {run.filesWritten && run.filesWritten.length > 0 && (
        <div className="mx-auto mt-2 flex max-w-[720px] flex-wrap gap-1">
          {run.filesWritten.map((f, i) => (
            <span
              key={i}
              className="rounded bg-[#17181b] px-1.5 py-0.5 font-mono text-[10px] text-[#8a8a92]"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </DetailShell>
  );
}

function PastDetail({ entry, onBack }: { entry: SpawnTreeEntry; onBack: () => void }) {
  const [snap, setSnap] = useState<SpawnTreeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const loadSnapshot = useDelegations((s) => s.loadSnapshot);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSnap(null);
    void loadSnapshot(entry.path)
      .then((s) => {
        if (alive) setSnap(s);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [entry.path, loadSnapshot]);

  return (
    <DetailShell
      onBack={onBack}
      title={entry.label || `${entry.count} subagents`}
      statusDot={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7ad39a]" />}
      meta={
        <>
          <span>{entry.count}× subagents</span>
          <span>· {relativeAge((entry.finished_at ?? 0) * 1000)}</span>
        </>
      }
    >
      {loading ? (
        <div className="mx-auto max-w-[720px] text-[12px] text-[#6a6a72]">
          Loading snapshot…
        </div>
      ) : !snap || snap.subagents.length === 0 ? (
        <Empty text="Snapshot empty or unreadable." />
      ) : (
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">
          {snap.subagents.map((sa) => (
            <div
              key={sa.id}
              className="rounded-lg border border-[#1c1d21] bg-[#141518] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-[12.5px] text-[#d0d0d5]">{sa.goal}</span>
                <span className="shrink-0 text-[10px] text-[#6a6a72]">{sa.status}</span>
                {sa.durationSeconds != null && (
                  <span className="shrink-0 text-[10px] text-[#6a6a72]">
                    {sa.durationSeconds.toFixed(0)}s
                  </span>
                )}
              </div>
              {sa.summary && (
                <div className="mt-1.5 text-[12px] leading-relaxed text-[#a6a6ac]">
                  {sa.summary}
                </div>
              )}
              {sa.outputTail && sa.outputTail.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {sa.outputTail.map((o, i) => (
                    <ToolChip key={i} tool={o.tool} preview={o.preview} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DetailShell>
  );
}

function SessionDetail({
  id,
  title,
  startedAt,
  onBack,
  onDeleted,
  exists,
}: {
  id: string;
  title: string;
  startedAt: number;
  onBack: () => void;
  onDeleted: () => void;
  exists: boolean;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadSessionHistory(id)
      .then((m) => {
        if (alive) setMsgs(m);
      })
      .catch(() => {
        if (alive) setMsgs([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const doDelete = () => {
    setErr(null);
    void deleteSession(id)
      .then(() => onDeleted())
      .catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  };

  return (
    <DetailShell
      onBack={onBack}
      title={title}
      meta={<span>{exists ? relativeAge((startedAt ?? 0) * 1000) : "deleted"}</span>}
      extra={
        confirming ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={doDelete}
              className="rounded-md px-2 py-1 text-[10.5px] text-[#e08a8a] transition hover:bg-[#241a1a]"
            >
              confirm delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 text-[10.5px] text-[#6a6a72] transition hover:bg-[#1c1d21] hover:text-[#c7c7cd]"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-[#6a6a72] transition hover:bg-[#1c1d21] hover:text-[#e08a8a]"
            title="Delete session"
          >
            delete
          </button>
        )
      }
    >
      {err && (
        <div className="mx-auto mb-3 max-w-[720px] rounded-md border border-[#3a1c1c] bg-[#1a1010] px-3 py-1.5 text-[11px] text-[#e08a8a]">
          {err}
        </div>
      )}
      {loading ? (
        <div className="mx-auto max-w-[720px] text-[12px] text-[#6a6a72]">
          Loading transcript…
        </div>
      ) : msgs && msgs.length > 0 ? (
        <MessageThread messages={msgs} />
      ) : (
        <Empty text="Empty conversation." />
      )}
    </DetailShell>
  );
}

// ── List rows (compact, no inline expansion) ─────────────────────────────────

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
    <div className="mx-auto max-w-[720px] rounded-lg border border-dashed border-[#1f2024] px-3 py-4 text-center text-[11.5px] text-[#6a6a72]">
      {text}
    </div>
  );
}

function RowShell({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-[#222327] bg-[#141518] px-2.5 py-2 text-left transition hover:border-[#2a2b30] hover:bg-[#17181b]"
    >
      {children}
    </button>
  );
}

function LiveRunRow({ run, onOpen }: { run: LiveDelegation; onOpen: () => void }) {
  return (
    <RowShell onClick={onOpen}>
      <span
        className={
          "h-1.5 w-1.5 shrink-0 rounded-full " +
          (run.finished ? "bg-[#7ad39a]" : "animate-pulse bg-[#e8c37a]")
        }
      />
      <span className="flex-1 truncate text-[12px] text-[#d0d0d5]">{run.goal}</span>
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
      <span className="shrink-0 text-[11px] text-[#4a4a52]">›</span>
    </RowShell>
  );
}

function PastRunRow({ entry, onOpen }: { entry: SpawnTreeEntry; onOpen: () => void }) {
  return (
    <RowShell onClick={onOpen}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7ad39a]" />
      <span className="flex-1 truncate text-[12px] text-[#d0d0d5]">
        {entry.label || `${entry.count} subagents`}
      </span>
      <span className="shrink-0 text-[10px] text-[#6a6a72]">{entry.count}×</span>
      <span className="shrink-0 text-[10px] text-[#6a6a72]">
        {relativeAge((entry.finished_at ?? 0) * 1000)}
      </span>
      <span className="shrink-0 text-[11px] text-[#4a4a52]">›</span>
    </RowShell>
  );
}

function SessionRow({
  id,
  title,
  preview,
  startedAt,
  onOpen,
}: {
  id: string;
  title: string;
  preview: string;
  startedAt: number;
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (deleted) return null;

  const doDelete = () => {
    setBusy(true);
    void deleteSession(id)
      .then(() => setDeleted(true))
      .catch(() => setBusy(false));
  };

  return (
    <div className="group flex items-center gap-1.5 rounded-lg border border-[#222327] bg-[#141518] transition hover:border-[#2a2b30] hover:bg-[#17181b]">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] text-[#d0d0d5]">{title || "Untitled chat"}</span>
          {preview && (
            <span className="truncate text-[10.5px] text-[#6a6a72]">{preview}</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-[#6a6a72]">
          {relativeAge((startedAt ?? 0) * 1000)}
        </span>
        <span className="shrink-0 text-[11px] text-[#4a4a52]">›</span>
      </button>
      {confirming ? (
        <span className="mr-2 flex shrink-0 items-center gap-1">
          <button
            onClick={doDelete}
            disabled={busy}
            className="text-[10.5px] text-[#e08a8a] transition hover:text-[#f0a0a0] disabled:opacity-50"
          >
            confirm
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
          className="mr-2 shrink-0 text-[11px] text-[#4a4a52] opacity-0 transition group-hover:opacity-100 hover:text-[#e08a8a]"
          title="Delete session"
        >
          delete
        </button>
      )}
    </div>
  );
}
