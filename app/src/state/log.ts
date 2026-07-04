/**
 * Diagnostic ring-buffer log for the Cofounder chat core. When a reply never
 * arrives the user has no visibility into what the backend did — this store
 * captures every WS request/response/error, connection-state change, session
 * create/resume/interrupt result, prompt.submit, and watchdog notice so the
 * "Logs" drawer in CofounderTab can show exactly what happened (and when).
 *
 * It's a bounded ring (LOG_CAP entries) so a long session can't grow memory
 * without bound; the oldest entries fall off the front. Every push also mirrors
 * to `console.debug` with a `[cofounder]` prefix so the browser/devtools console
 * carries the same trail. Pure client state — no backend I/O of its own.
 *
 * The WS request/response/error path is instrumented once via `installWsLogging`
 * (called from chat.ts's event subscription setup), which wraps hermesWs.request
 * and taps onAnyEvent + onState. Callers that want a semantic marker (e.g.
 * "session.create ok") use `logEvent` directly.
 */

import { create } from "zustand";
import { hermesWs } from "@/lib/hermes";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Monotonic id so React keys stay stable as the ring rotates. */
  id: number;
  /** epoch ms. */
  ts: number;
  level: LogLevel;
  /** Short scope tag, e.g. "ws", "rpc", "session", "watchdog". */
  scope: string;
  message: string;
  /** Optional structured detail (params, result, error text). */
  detail?: unknown;
}

/** Ring-buffer capacity. ~500 entries keeps a full session's trail in memory. */
const LOG_CAP = 500;

interface LogState {
  entries: LogEntry[];
  /** Push a new entry, trimming the ring to LOG_CAP. */
  push: (level: LogLevel, scope: string, message: string, detail?: unknown) => void;
  clear: () => void;
}

let seq = 0;

export const useLog = create<LogState>((set) => ({
  entries: [],
  push: (level, scope, message, detail) => {
    const entry: LogEntry = { id: ++seq, ts: Date.now(), level, scope, message, detail };
    // Mirror to devtools console — the same trail, always available even if the
    // drawer isn't open. console.debug keeps it out of the default console view.
    try {
      // eslint-disable-next-line no-console
      console.debug(`[cofounder] ${scope}: ${message}`, detail ?? "");
    } catch {
      /* console unavailable — ignore */
    }
    set((s) => {
      const next = s.entries.length >= LOG_CAP ? s.entries.slice(s.entries.length - LOG_CAP + 1) : s.entries;
      return { entries: [...next, entry] };
    });
  },
  clear: () => set({ entries: [] }),
}));

/** Imperative logger for non-React call sites (chat.ts, wrappers). */
export function logEvent(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  useLog.getState().push(level, scope, message, detail);
}

/** Truncate a value to a short string so params/results don't bloat the ring. */
function brief(value: unknown, max = 300): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > max ? value.slice(0, max) + "…" : value;
  try {
    const s = JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : JSON.parse(s);
  } catch {
    return String(value);
  }
}

let installed = false;

/**
 * Instrument hermesWs once: every request/response/error, every server event,
 * and every connection-state change flows into the ring. Idempotent — safe to
 * call from chat.ts's subscribeEvents (which also runs once).
 */
export function installWsLogging(): void {
  if (installed) return;
  installed = true;
  const log = useLog.getState().push;

  // Wrap the request path so both the outbound call and its settlement land in
  // the ring. We keep the original bound reference and delegate to it.
  const orig = hermesWs.request.bind(hermesWs);
  (hermesWs as unknown as { request: typeof hermesWs.request }).request = ((
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => {
    log("debug", "rpc", `→ ${method}`, brief(params));
    return orig(method, params, timeoutMs).then(
      (res: unknown) => {
        log("debug", "rpc", `✓ ${method}`, brief(res));
        return res;
      },
      (err: unknown) => {
        log("error", "rpc", `✗ ${method}: ${String(err)}`, brief(params));
        throw err;
      },
    );
  }) as typeof hermesWs.request;

  // Every server-push event (message.*, tool.*, error, …). Keep it terse.
  hermesWs.onAnyEvent((ev) => {
    const level: LogLevel = ev.type === "error" ? "error" : "debug";
    log(level, "event", ev.type, ev.session_id ? { session_id: ev.session_id, payload: brief(ev.payload) } : brief(ev.payload));
  });

  // Connection lifecycle — the first thing to check when replies stop.
  hermesWs.onState((st) => log(st === "error" || st === "closed" ? "warn" : "info", "ws", `state: ${st}`));
}
