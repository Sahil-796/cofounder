/**
 * Diagnostic Logs drawer. Opens from a small footer button in the composer and
 * shows the ring-buffer trail from src/state/log.ts — every WS request/response,
 * server event, connection-state change, and watchdog notice. Filterable by
 * level so the user can jump straight to warnings/errors when a reply never
 * arrives. Dark palette, right-anchored slide-over.
 */

import { useMemo, useState } from "react";
import { useLog, type LogEntry, type LogLevel } from "@/state/log";

const LEVELS: { id: LogLevel | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "info", label: "Info" },
  { id: "warn", label: "Warnings" },
  { id: "error", label: "Errors" },
];

/** Level → text color for the row badge. */
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "text-[#6a6a72]",
  info: "text-[#7ea6e0]",
  warn: "text-amber-400",
  error: "text-red-400",
};

/** Minimum severity rank for the "warn"/"error" filters. */
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export default function LogsDrawer({ onClose }: { onClose: () => void }) {
  const entries = useLog((s) => s.entries);
  const clear = useLog((s) => s.clear);
  const [level, setLevel] = useState<LogLevel | "all">("all");

  const filtered = useMemo(() => {
    if (level === "all") return entries;
    const min = RANK[level];
    return entries.filter((e) => RANK[e.level] >= min);
  }, [entries, level]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Diagnostic logs">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="flex h-full w-[420px] max-w-full flex-col border-l border-[#222327] bg-[#111214] shadow-[0_0_60px_-10px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2 border-b border-[#1f2024] px-3 py-2.5">
          <span className="text-[13px] font-medium text-[#e7e7ea]">Diagnostics</span>
          <span className="text-[11px] text-[#6a6a72]">{filtered.length} entries</span>
          <div className="ml-auto flex items-center gap-1">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLevel(l.id)}
                className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                  level === l.id
                    ? "bg-[#26272c] text-[#f0f0f2]"
                    : "text-[#8a8a92] hover:bg-[#1a1b1f] hover:text-[#c7c7cd]"
                }`}
              >
                {l.label}
              </button>
            ))}
            <button
              onClick={clear}
              title="Clear log"
              className="ml-1 rounded-md px-2 py-0.5 text-[11px] text-[#8a8a92] hover:bg-[#1a1b1f] hover:text-[#c7c7cd]"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="rounded-md px-1.5 py-0.5 text-[13px] text-[#8a8a92] hover:text-[#e0e0e4]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 font-mono text-[11px] leading-relaxed">
          {filtered.length === 0 ? (
            <div className="px-2 py-8 text-center text-[12px] text-[#5f5f67]">No log entries yet.</div>
          ) : (
            filtered.map((e) => <LogRow key={e.id} e={e} />)
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ e }: { e: LogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = e.detail != null && e.detail !== "";
  return (
    <div className="border-b border-[#181a1d] px-1.5 py-1">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-start gap-2 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="shrink-0 text-[#4a4b52]">{fmtTime(e.ts)}</span>
        <span className={`shrink-0 uppercase ${LEVEL_COLOR[e.level]}`}>{e.scope}</span>
        <span className="flex-1 break-words text-[#c7c7cd]">{e.message}</span>
        {hasDetail && <span className="shrink-0 text-[#5f5f67]">{open ? "▾" : "▸"}</span>}
      </button>
      {open && hasDetail && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#0c0d0f] px-2 py-1 text-[10.5px] text-[#8a8a92]">
          {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
