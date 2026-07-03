/**
 * Left-zone infinite org-map canvas. Hand-rolled pan/zoom (pointer drag +
 * wheel) over an SVG world transform — no graph library. Center "Cofounder"
 * card node with a sunflower, a dashed radial ring, eight role pill nodes
 * spaced around the ring, and artifact mini-cards clustered near roles.
 *
 * Live status:
 *  - Each role pill shows a small count badge of kanban tasks assigned to that
 *    role in running/ready/todo (polled via the WS `shell.exec` RPC running
 *    `hermes kanban list --json`, every ~15s, paused when the tab is hidden).
 *  - A pill pulses while that agent's chat session is streaming; the center
 *    Cofounder node pulses while the orchestrator streams.
 *  - Clicking any role pill (or the center node) opens that agent's chat.
 *
 * Artifact mini-cards render ONLY real workspace files (scanned via fs/list,
 * passed in via `artifacts`) — never placeholder filenames. Roles with no
 * files simply show no card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/cofounder/roles";
import { useTasks, relativeAge } from "@/state/tasks";
import { useChat } from "@/state/chat";
import { hermesWs } from "@/lib/hermes";

export interface Artifact {
  label: string;
  role: string;
  emoji: string;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const RING_R = 250;
const WORLD = { w: 1200, h: 900 };
const CENTER = { x: WORLD.w / 2, y: WORLD.h / 2 };

/** Kanban statuses that count as "active work" for the role badges. */
const ACTIVE_STATUSES = new Set(["running", "ready", "todo", "in_progress"]);

function ringPoint(i: number, n: number): { x: number; y: number } {
  // Start at top, go clockwise.
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { x: CENTER.x + RING_R * Math.cos(a), y: CENTER.y + RING_R * Math.sin(a) };
}

/** Shape of `hermes kanban stats --json` (verified against the CLI). */
interface KanbanStats {
  by_assignee?: Record<string, Record<string, number>>;
}

/** Match a kanban assignee string to a role id (tolerant of prefixes). */
function assigneeRole(assignee?: string | null): string | null {
  if (!assignee) return null;
  const key = assignee.toLowerCase();
  for (const r of ROLES) {
    if (key === r.id || key.endsWith(`/${r.id}`) || key.includes(r.id)) return r.id;
  }
  return null;
}

/**
 * Poll the kanban board via shell.exec and return per-role active-task counts.
 * Uses `hermes kanban stats --json` — compact per-assignee/per-status counts.
 * (The full `list --json` output overflows shell.exec's 4000-char stdout cap,
 * and piping through `python3 -c` is blocked by the gateway's safety filter.)
 * Runs every ~15s, pauses while the document is hidden. Best-effort — any
 * failure just leaves the counts empty (no badges), never fake numbers.
 */
function useKanbanCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        if (hermesWs.connectionState !== "open") await hermesWs.connect();
        const res = await hermesWs.request<{ stdout?: string; code?: number }>("shell.exec", {
          command: "hermes kanban stats --json",
        });
        const out = (res?.stdout ?? "").trim();
        if (!out) return;
        const stats = JSON.parse(out) as KanbanStats;
        const next: Record<string, number> = {};
        for (const [assignee, byStatus] of Object.entries(stats.by_assignee ?? {})) {
          const role = assigneeRole(assignee);
          if (!role) continue;
          let n = 0;
          for (const [status, count] of Object.entries(byStatus ?? {})) {
            if (ACTIVE_STATUSES.has(status.toLowerCase())) n += count;
          }
          if (n > 0) next[role] = (next[role] ?? 0) + n;
        }
        if (!stopped) setCounts(next);
      } catch {
        /* backend down / not JSON — leave counts as-is */
      }
    };

    void poll();
    const arm = () => {
      timer = setTimeout(async () => {
        await poll();
        if (!stopped) arm();
      }, 15_000);
    };
    arm();

    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return counts;
}

export default function CanvasView({
  founderInitials,
  companyName,
  artifacts,
  onAdd,
  onOpenAgentChat,
}: {
  founderInitials: string;
  companyName: string;
  artifacts?: Artifact[];
  onAdd?: () => void;
  /** Open a role/orchestrator chat when its node is clicked. */
  onOpenAgentChat?: (agentId: string) => void;
}) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState<string | null>(null); // null = closed
  const [bellOpen, setBellOpen] = useState(false);

  const kanbanCounts = useKanbanCounts();
  // Per-agent streaming flags for the live pulse (subscribe to the chats map).
  const chats = useChat((s) => s.chats);

  const fitToView = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(width / WORLD.w, height / WORLD.h) * 0.98;
    setView({ k, x: (width - WORLD.w * k) / 2, y: (height - WORLD.h * k) / 2 });
  }, []);

  // Fit the world into the viewport on mount + on resize.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    fitToView();
    const ro = new ResizeObserver(fitToView);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToView]);

  const query = (search ?? "").trim().toLowerCase();
  const roleMatch = (id: string, label: string) =>
    !query || id.toLowerCase().includes(query) || label.toLowerCase().includes(query);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const rect = wrapRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = Math.min(2.4, Math.max(0.35, v.k * factor));
      // Zoom toward the cursor.
      const wx = (px - v.x) / v.k;
      const wy = (py - v.y) / v.k;
      return { k, x: px - wx * k, y: py - wy * k };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      setDragging(true);
    },
    [view.x, view.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
    setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  // A "click" on a node should not fire after a pan-drag. Guard with `moved`.
  const clickIfNotDragged = useCallback((fn: () => void) => {
    if (drag.current?.moved) return;
    fn();
  }, []);

  const arts = artifacts ?? [];

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* dot-grid background — fixed, independent of world transform */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: "#0e0f11",
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1.4px)",
          backgroundSize: `${26 * view.k}px ${26 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4">
        <button
          title={`${companyName || "cofounder"} · cofounder profile`}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#2a2b30] bg-[#17181b]/80 px-2.5 py-1.5 text-xs backdrop-blur transition hover:border-[#3a3b42]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#c99b4e] text-[11px] font-semibold text-black">
            {founderInitials}
          </span>
          <span className="text-[#c9c9cf]">{companyName || "cofounder"}</span>
          <span className="text-[#6a6a72]">▾</span>
        </button>
        <div className="pointer-events-auto flex items-center gap-2">
          {search !== null && (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch(null);
              }}
              placeholder="Filter roles…"
              className="h-8 w-40 rounded-full border border-[#3a3b42] bg-[#17181b]/90 px-3 text-xs text-[#e7e7ea] outline-none backdrop-blur placeholder:text-[#5f5f67]"
            />
          )}
          <button
            title="Upgrade — you're on the local plan"
            className="rounded-full border border-[#3a2f1a] bg-[#2a2213]/70 px-3 py-1.5 text-xs font-medium text-[#e8c37a] transition hover:bg-[#332a17]"
          >
            Upgrade
          </button>
          <button
            onClick={fitToView}
            title="Fit map to view"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2a2b30] bg-[#17181b]/80 text-sm text-[#9a9aa2] backdrop-blur transition hover:border-[#3a3b42] hover:text-[#e7e7ea]"
          >
            ◱
          </button>
          <button
            title="Theme: dark (light theme coming soon)"
            className="flex h-8 w-8 cursor-default items-center justify-center rounded-full border border-[#2a2b30] bg-[#17181b]/80 text-sm text-[#9a9aa2] backdrop-blur transition hover:border-[#3a3b42]"
          >
            ⌖
          </button>
          <button
            onClick={() => setSearch((s) => (s === null ? "" : null))}
            title="Search roles"
            className={`flex h-8 w-8 items-center justify-center rounded-full border bg-[#17181b]/80 text-sm backdrop-blur transition ${
              search !== null
                ? "border-[#3a3b42] text-[#e7e7ea]"
                : "border-[#2a2b30] text-[#9a9aa2] hover:border-[#3a3b42] hover:text-[#e7e7ea]"
            }`}
          >
            ⌕
          </button>
        </div>
      </div>

      {/* World */}
      <div
        ref={wrapRef}
        className="h-full w-full"
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: "0 0",
            width: WORLD.w,
            height: WORLD.h,
            position: "relative",
          }}
        >
          {/* dashed ring + spokes */}
          <svg
            width={WORLD.w}
            height={WORLD.h}
            className="pointer-events-none absolute inset-0"
          >
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={RING_R}
              fill="none"
              stroke="#33343a"
              strokeWidth={1.5}
              strokeDasharray="4 7"
            />
            {ROLES.map((r, i) => {
              const p = ringPoint(i, ROLES.length);
              return (
                <line
                  key={r.id}
                  x1={CENTER.x}
                  y1={CENTER.y}
                  x2={p.x}
                  y2={p.y}
                  stroke="#232428"
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          {/* center node — pulses while the orchestrator streams */}
          <Node x={CENTER.x} y={CENTER.y}>
            <button
              onClick={() => clickIfNotDragged(() => onOpenAgentChat?.("cofounder"))}
              title="Open Cofounder chat"
              className="relative block w-[168px] rounded-2xl border border-[#2f3036] bg-gradient-to-b from-[#202127] to-[#191a1e] px-4 py-3.5 text-left shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] transition hover:border-[#4a4b52]"
            >
              {chats["cofounder"]?.streaming && (
                <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-[#e8c37a]/70 animate-pulse" />
              )}
              <div className="mb-1.5 text-2xl">🌻</div>
              <div className="text-[15px] font-semibold text-[#f0f0f2]">Cofounder</div>
              <div className="mt-0.5 text-[11px] text-[#8a8a92]">
                {companyName || "Your AI company"}
              </div>
            </button>
          </Node>

          {/* role pills */}
          {ROLES.map((r, i) => {
            const p = ringPoint(i, ROLES.length);
            const dim = query.length > 0 && !roleMatch(r.id, r.label);
            const count = kanbanCounts[r.id] ?? 0;
            const streaming = r.skill && chats[r.id]?.streaming;
            const clickable = r.skill && !!onOpenAgentChat;
            return (
              <Node key={r.id} x={p.x} y={p.y}>
                <button
                  onClick={() =>
                    clickable && clickIfNotDragged(() => onOpenAgentChat!(r.id))
                  }
                  title={clickable ? `Open ${r.label} chat` : `${r.label} (coming soon)`}
                  className={`relative flex items-center gap-2 rounded-full border px-3 py-2 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.8)] transition ${
                    dim ? "opacity-25" : ""
                  } ${
                    r.skill
                      ? "border-[#33343a] bg-[#1c1d21] hover:border-[#4a4b52]"
                      : "cursor-default border-dashed border-[#2c2d33] bg-[#161719]"
                  }`}
                  style={streaming ? { boxShadow: `0 0 0 2px ${r.color}` } : undefined}
                >
                  <span className="text-base">{r.emoji}</span>
                  <span
                    className={`text-[13px] font-medium ${
                      r.skill ? "text-[#dcdce0]" : "text-[#7f7f88]"
                    }`}
                  >
                    {r.label}
                  </span>

                  {/* streaming pulse dot (top-right) */}
                  {streaming && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5">
                      <span
                        className="absolute inset-0 animate-ping rounded-full opacity-75"
                        style={{ backgroundColor: r.color }}
                      />
                      <span
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                    </span>
                  )}

                  {/* kanban active-task count badge */}
                  {count > 0 && !streaming && (
                    <span
                      className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-black shadow"
                      style={{ backgroundColor: r.color }}
                      title={`${count} active task${count === 1 ? "" : "s"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              </Node>
            );
          })}

          {/* artifact mini-cards near their role — real workspace files only */}
          {arts.map((a, idx) => {
            const roleIdx = ROLES.findIndex((r) => r.id === a.role);
            const base = ringPoint(roleIdx >= 0 ? roleIdx : idx, ROLES.length);
            const ox = base.x > CENTER.x ? 84 : -84;
            const oy = 44 + (idx % 2) * 8;
            return (
              <Node key={`${a.label}-${idx}`} x={base.x + ox} y={base.y + oy}>
                <div className="w-[128px] rounded-lg border border-[#26272c] bg-[#141518] px-2.5 py-2 text-left shadow-[0_6px_16px_-8px_rgba(0,0,0,0.8)]">
                  <div className="text-sm">{a.emoji}</div>
                  <div className="mt-1 truncate text-[10.5px] text-[#a7a7ae]">
                    {a.label}
                  </div>
                </div>
              </Node>
            );
          })}
        </div>
      </div>

      {/* bottom-center add button */}
      <button
        onClick={onAdd}
        title="New conversation"
        className="absolute bottom-6 left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-[#33343a] bg-[#1d1e22] text-2xl leading-none text-[#cfcfd4] shadow-[0_10px_24px_-8px_rgba(0,0,0,0.8)] transition hover:border-[#4a4b52] hover:bg-[#26272c]"
      >
        +
      </button>

      {/* bottom-left bell + notifications popover */}
      <div className="absolute bottom-6 left-6 z-30">
        {bellOpen && <NotificationsPopover onClose={() => setBellOpen(false)} />}
        <button
          onClick={() => setBellOpen((v) => !v)}
          title="Notifications"
          className={`flex h-10 w-10 items-center justify-center rounded-full border bg-[#17181b]/80 backdrop-blur transition ${
            bellOpen
              ? "border-[#3a3b42] text-[#e7e7ea]"
              : "border-[#2a2b30] text-[#9a9aa2] hover:border-[#3a3b42] hover:text-[#e7e7ea]"
          }`}
        >
          🔔
        </button>
      </div>
    </div>
  );
}

function NotificationsPopover({ onClose }: { onClose: () => void }) {
  const { sessions, spawns, loaded, refresh } = useTasks();
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = [
    ...spawns
      .filter((s) => s.finished_at)
      .slice(0, 5)
      .map((s) => ({
        key: `spawn-${s.session_id}`,
        icon: "🧩",
        text: s.label || "Delegated task finished",
        age: relativeAge(s.finished_at),
      })),
    ...sessions.slice(0, 5).map((s) => ({
      key: `sess-${s.id}`,
      icon: "💬",
      text: s.title || s.preview || "Conversation",
      age: relativeAge(s.started_at),
    })),
  ].slice(0, 6);

  return (
    <div className="co-fadein absolute bottom-12 left-0 w-72 rounded-2xl border border-[#2a2b30] bg-[#141518] p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a7a82]">
          Notifications
        </span>
        <button
          onClick={onClose}
          className="text-[12px] text-[#6a6a72] hover:text-[#c7c7cd]"
        >
          ✕
        </button>
      </div>
      {!loaded ? (
        <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">loading…</div>
      ) : items.length === 0 ? (
        <div className="px-2 py-6 text-center text-[12px] text-[#6a6a72]">
          Nothing yet — activity from your Cofounder will show up here.
        </div>
      ) : (
        <ul className="flex flex-col">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[#1a1b1f]"
            >
              <span className="text-sm">{it.icon}</span>
              <span className="flex-1 truncate text-[12.5px] text-[#d6d6da]">{it.text}</span>
              {it.age && <span className="text-[10.5px] text-[#6a6a72]">{it.age}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Node({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      {children}
    </div>
  );
}
