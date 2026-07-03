/**
 * Home tab — time-aware serif greeting, roadmap banner (CSS starry-night art),
 * a real TASKS list (kanban work items from the Hermes board), SUGGESTED NEXT
 * (starter ideas, company-aware when onboarding context exists), a separate
 * RECENT CONVERSATIONS list (chat sessions — not tasks), and a bottom composer
 * that jumps to the Cofounder tab with the message sent.
 *
 * Data honesty: the TASKS list shows only kanban work items — never chat
 * sessions. Roadmap % is strictly kanban done/total; when the board is empty it
 * reads "Getting started" at 0% rather than a fabricated number.
 */

import { useEffect, useMemo, useState } from "react";
import { useTasks, relativeAge } from "@/state/tasks";
import {
  buildSuggestions,
  roleEmoji,
  roleLabel,
  type Suggestion,
} from "@/lib/cofounder/roles";
import {
  columnForStatus,
  taskAgeMs,
  type KanbanTask,
} from "@/lib/cofounder/extraRest";
import { firstName, loadConfig } from "@/lib/cofounder/config";

const POLL_MS = 12_000;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

function statusDot(t: KanbanTask): string {
  switch (columnForStatus(t.status)) {
    case "running":
      return "#e8c37a";
    case "ready":
      return "#7aa2e8";
    case "done":
      return t.status === "blocked" ? "#e08a8a" : "#7ad39a";
    default:
      return "#7a7a82";
  }
}

export default function HomeTab({
  founderName,
  onSend,
}: {
  founderName: string;
  onSend: (text: string) => void;
}) {
  const { kanban, kanbanLoaded, sessions, loading, error, refresh } = useTasks();
  // Company context (from onboarding) makes suggestions company-aware.
  const company = useMemo(() => loadConfig()?.company, []);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() =>
    buildSuggestions(4, { companyName: company?.name, goals: company?.goals }),
  );
  const [input, setInput] = useState("");

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Tasks = real kanban work items, newest activity first.
  const tasks = useMemo(
    () => [...kanban].sort((a, b) => taskAgeMs(b) - taskAgeMs(a)).slice(0, 8),
    [kanban],
  );

  // Roadmap progress = done / total across the whole board (not just the top 8).
  const progress = useMemo(() => {
    if (!kanbanLoaded || kanban.length === 0) return undefined;
    const done = kanban.filter((t) => t.status === "done").length;
    return Math.round((done / kanban.length) * 100);
  }, [kanbanLoaded, kanban]);

  // Recent conversations — kept clearly separate from tasks.
  const conversations = useMemo(() => sessions.slice(0, 5), [sessions]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 pt-8">
        <div className="mx-auto max-w-xl">
          {/* Greeting */}
          <h1 className="font-serif-display text-[40px] leading-tight text-[#efeff1]">
            {greeting()}, {firstName(founderName)}
          </h1>

          {/* Roadmap banner */}
          <RoadmapBanner progress={progress} total={kanban.length} />

          {/* TASKS — kanban work items only */}
          <Section title="Tasks" action={loading ? "…" : undefined}>
            {!kanbanLoaded ? (
              <SkeletonList />
            ) : error && kanban.length === 0 ? (
              <EmptyRow text="Couldn't load tasks — is the backend running?" />
            ) : tasks.length === 0 ? (
              <EmptyRow text="No tasks yet — ask Cofounder to plan something." />
            ) : (
              <ul className="flex flex-col">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 border-b border-[#1e1f23] py-2.5 last:border-0"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: statusDot(t) }}
                    />
                    <span className="flex-1 truncate text-[13px] text-[#d6d6da]">
                      {t.title}
                    </span>
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#1c1d21] px-1.5 py-0.5 text-[10px] text-[#a7a7ae]"
                      title={roleLabel(t.assignee)}
                    >
                      {roleEmoji(t.assignee)}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#6a6a72]">
                      {relativeAge(taskAgeMs(t))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* SUGGESTED NEXT */}
          <Section
            title="Suggested next"
            hint="starter ideas"
            onRefresh={() =>
              setSuggestions(
                buildSuggestions(4, { companyName: company?.name, goals: company?.goals }),
              )
            }
          >
            <div className="flex flex-col gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSend(s.text)}
                  className="group flex items-center gap-3 rounded-xl border border-[#222327] bg-[#141518] px-3.5 py-3 text-left transition hover:border-[#33343a] hover:bg-[#181a1e]"
                >
                  <span className="text-base">{s.emoji}</span>
                  <span className="flex-1 text-[13px] text-[#cfcfd4]">{s.text}</span>
                  <span className="text-[#4a4b52] transition group-hover:text-[#8a8a92]">
                    →
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {/* RECENT CONVERSATIONS — chat sessions, distinct from tasks */}
          {conversations.length > 0 && (
            <Section title="Recent conversations">
              <ul className="flex flex-col">
                {conversations.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 border-b border-[#1e1f23] py-2.5 last:border-0"
                  >
                    <span className="shrink-0 text-[13px]">💬</span>
                    <span className="flex-1 truncate text-[13px] text-[#b6b6bc]">
                      {c.title || c.preview || "Untitled conversation"}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#6a6a72]">
                      {relativeAge(c.started_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="h-6" />
        </div>
      </div>

      {/* bottom composer */}
      <div className="border-t border-[#222327] px-4 py-3">
        <div className="mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-[#2a2b30] bg-[#141518] px-3 py-2.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#202127] px-2 py-0.5 text-[11px] text-[#b6b6bc]">
            🌻 Cofounder
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                onSend(input.trim());
                setInput("");
              }
            }}
            placeholder="Ask Cofounder anything about your company…"
            className="flex-1 bg-transparent text-[13.5px] text-[#e7e7ea] outline-none placeholder:text-[#5f5f67]"
          />
          <button
            disabled
            className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full border border-[#2a2b30] text-[#5f5f67]"
            title="Attach files — coming soon"
          >
            +
          </button>
          <button
            onClick={() => {
              if (input.trim()) {
                onSend(input.trim());
                setInput("");
              }
            }}
            disabled={!input.trim()}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e7e7ea] text-black transition hover:bg-white disabled:opacity-30"
            title="Send"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function RoadmapBanner({ progress, total }: { progress?: number; total: number }) {
  // Honest label: when there are no tasks on the board yet, show "Getting
  // started" at 0% rather than a fabricated percentage.
  const pct = progress ?? 0;
  const label =
    progress == null
      ? "Getting started"
      : `${pct}% complete · ${total} task${total === 1 ? "" : "s"}`;
  return (
    <button className="group relative mt-6 block w-full overflow-hidden rounded-2xl border border-[#242530] text-left">
      {/* starry night sky gradient */}
      <div
        className="relative h-[132px] w-full"
        style={{
          background:
            "linear-gradient(160deg, #1a2340 0%, #221a3a 42%, #3a2340 78%, #4a2b38 100%)",
        }}
      >
        {STARS.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.r,
              height: s.r,
              opacity: 0.7,
              animation: `co-twinkle ${2 + (i % 4)}s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
        {/* shooting star */}
        <span
          className="absolute left-[14%] top-[22%] h-[2px] w-16 rounded-full"
          style={{
            background: "linear-gradient(90deg, transparent, #fff)",
            animation: "co-shoot 5.5s ease-in-out 1s infinite",
          }}
        />
        <div className="absolute inset-0 flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-white/95">
              Cofounder Roadmap
            </span>
            <span className="text-white/70 transition group-hover:translate-x-0.5">
              ›
            </span>
          </div>
          <div>
            <div className="mb-1 text-[11px] text-white/70">{label}</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white/85"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 53) % 70,
  r: (i % 3) + 1,
}));

function Section({
  title,
  children,
  onRefresh,
  action,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  action?: string;
  hint?: string;
}) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
          {title}
          {hint && (
            <span className="rounded-full border border-[#242529] px-1.5 py-px text-[9px] font-medium normal-case tracking-normal text-[#6a6a72]">
              {hint}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {action && <span className="text-[11px] text-[#6a6a72]">{action}</span>}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Reshuffle"
              className="text-[13px] text-[#6a6a72] transition hover:text-[#c7c7cd]"
            >
              ↻
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-4 text-center text-[12.5px] text-[#6a6a72]">
      {text}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-lg bg-[#17181b]"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
