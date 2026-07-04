/**
 * Kanban dispatch tick — the piece that makes role-agent delegation actually
 * run. `hermes serve` does NOT run the kanban dispatcher on its own (verified
 * against hermes_cli/kanban_db.py: no dispatch_once/run_daemon call anywhere
 * in tui_gateway or web_server); a ready task just sits parked until something
 * invokes `hermes kanban dispatch`. Rather than spawn a second long-lived
 * `hermes kanban daemon` process (a Rust sidecar change), we run a lightweight
 * one-shot dispatch tick over the existing WS `shell.exec` RPC on an interval
 * while the app is open — same mechanism extraRest.ts already uses to read the
 * board. This means autonomous role work runs whenever Cofounder is running,
 * regardless of which tab or chat is focused; it does not run if the app is
 * fully closed (a real background daemon would be a separate, larger change).
 */

import { hermesWs } from "@/lib/hermes";
import { logEvent } from "@/state/log";

const DISPATCH_INTERVAL_MS = 20_000;

interface DispatchResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function tick(): Promise<void> {
  if (hermesWs.connectionState !== "open") return;
  try {
    const res = await hermesWs.request<DispatchResult>(
      "shell.exec",
      { command: "hermes kanban dispatch --json" },
      15_000,
    );
    if (res.code !== 0) {
      logEvent("warn", "dispatch", `kanban dispatch exited ${res.code}`, res.stderr?.slice(0, 300));
      return;
    }
    // Only log when something actually happened — a routine "nothing ready"
    // tick every 20s would just be noise in the Logs drawer.
    const spawned = /"spawned"\s*:\s*\[[^\]]+\]/.test(res.stdout) && !/"spawned"\s*:\s*\[\]/.test(res.stdout);
    if (spawned) logEvent("info", "dispatch", "kanban dispatch spawned worker(s)", res.stdout.slice(0, 1000));
  } catch (err) {
    // Best-effort — a single failed tick (e.g. mid-reconnect) isn't worth a notice.
    logEvent("warn", "dispatch", `kanban dispatch tick failed: ${String(err)}`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic dispatch tick (idempotent). Returns a stop function. */
export function startKanbanDispatchLoop(): () => void {
  if (!timer) {
    void tick();
    timer = setInterval(() => void tick(), DISPATCH_INTERVAL_MS);
  }
  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
