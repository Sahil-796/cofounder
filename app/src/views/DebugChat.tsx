/**
 * Dev-only /debug route: a plain chat box that creates (or reuses) a session on
 * the `cofounder` profile and streams the reply text live, with a raw event log
 * below. This proves the REST + WS pipe end-to-end before the real UI lands.
 *
 * Degrades gracefully: if the `cofounder` profile doesn't exist yet (profile
 * bootstrap is another agent's job), we fall back to the default profile and
 * surface a clear notice. Runs standalone in a plain browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hermesWs, sessions } from "@/lib/hermes";
import type {
  ErrorEventPayload,
  HermesEvent,
  MessageCompletePayload,
  MessageDeltaPayload,
} from "@/lib/hermes";
import { initConnection, useConnection } from "@/state/connection";

const COFOUNDER_PROFILE = "cofounder";

interface LogLine {
  t: number;
  type: string;
  detail: string;
}

export default function DebugChat() {
  const wsState = useConnection((s) => s.wsState);
  const backendReachable = useConnection((s) => s.backendReachable);
  const underTauri = useConnection((s) => s.underTauri);
  const sidecar = useConnection((s) => s.sidecar);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profileInUse, setProfileInUse] = useState<string>(COFOUNDER_PROFILE);
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((type: string, detail: unknown) => {
    setLog((prev) =>
      [
        ...prev,
        {
          t: Date.now(),
          type,
          detail:
            typeof detail === "string" ? detail : JSON.stringify(detail),
        },
      ].slice(-200),
    );
  }, []);

  useEffect(() => {
    const dispose = initConnection();
    return dispose;
  }, []);

  // Subscribe to streaming + control events.
  useEffect(() => {
    const offAny = hermesWs.onAnyEvent((ev: HermesEvent) => {
      appendLog(ev.type, ev.payload ?? {});
    });
    const offStart = hermesWs.onEvent("message.start", () => {
      setReply("");
      setStreaming(true);
    });
    const offDelta = hermesWs.onEvent("message.delta", (ev) => {
      const p = ev.payload as MessageDeltaPayload | undefined;
      if (p?.text) setReply((r) => r + p.text);
    });
    const offComplete = hermesWs.onEvent("message.complete", (ev) => {
      const p = ev.payload as MessageCompletePayload | undefined;
      if (p?.text) setReply(p.text);
      setStreaming(false);
    });
    const offError = hermesWs.onEvent("error", (ev) => {
      const p = ev.payload as ErrorEventPayload | undefined;
      setNotice(p?.message ?? "backend error");
      setStreaming(false);
    });
    return () => {
      offAny();
      offStart();
      offDelta();
      offComplete();
      offError();
    };
  }, [appendLog]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    // Wait for the WS to be open (initConnection opens it with backoff).
    if (hermesWs.connectionState !== "open") await hermesWs.connect();

    // Try the cofounder profile first; degrade to default on failure.
    try {
      const res = await sessions.create({
        profile: COFOUNDER_PROFILE,
        source: "cofounder-debug",
        close_on_disconnect: true,
      });
      setSessionId(res.session_id);
      setProfileInUse(res.info.profile_name ?? COFOUNDER_PROFILE);
      return res.session_id;
    } catch (err) {
      appendLog("client.warn", `cofounder profile create failed: ${String(err)}`);
      setNotice(
        `Could not start a session on the "${COFOUNDER_PROFILE}" profile — ` +
          `falling back to the default profile. (${String(err)})`,
      );
      const res = await sessions.create({
        source: "cofounder-debug",
        close_on_disconnect: true,
      });
      setSessionId(res.session_id);
      setProfileInUse(res.info.profile_name ?? "default");
      return res.session_id;
    }
  }, [sessionId, appendLog]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setNotice(null);
    try {
      const sid = await ensureSession();
      setReply("");
      setStreaming(true);
      appendLog("client.submit", { session_id: sid, text });
      await sessions.submitPrompt(sid, text);
    } catch (err) {
      setStreaming(false);
      setNotice(`Send failed: ${String(err)}`);
      appendLog("client.error", String(err));
    }
  }, [input, streaming, ensureSession, appendLog]);

  const wsBadge = useMemo(() => {
    const color =
      wsState === "open"
        ? "#3ecf8e"
        : wsState === "connecting"
          ? "#e2c541"
          : "#e06c6c";
    return { color };
  }, [wsState]);

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cofounder · Debug pipe</h1>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>
            profile: <span className="text-neutral-200">{profileInUse}</span>
          </span>
          <span>
            REST:{" "}
            <span
              style={{
                color:
                  backendReachable == null
                    ? "#888"
                    : backendReachable
                      ? "#3ecf8e"
                      : "#e06c6c",
              }}
            >
              {backendReachable == null
                ? "…"
                : backendReachable
                  ? "up"
                  : "down"}
            </span>
          </span>
          <span>
            WS: <span style={wsBadge}>{wsState}</span>
          </span>
          {underTauri && (
            <span>
              sidecar:{" "}
              <span className="text-neutral-200">
                {sidecar
                  ? `${sidecar.running ? "running" : "off"}${
                      sidecar.spawned_by_us ? " (ours)" : ""
                    }`
                  : "…"}
              </span>
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {notice}
        </div>
      )}

      <div className="min-h-32 flex-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-100">
          {reply || (
            <span className="text-neutral-500">
              {streaming ? "…" : "Reply will stream here."}
            </span>
          )}
          {streaming && <span className="ml-0.5 animate-pulse">▋</span>}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          placeholder="Ask the cofounder something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
          onClick={() => void send()}
          disabled={streaming || !input.trim()}
        >
          Send
        </button>
      </div>

      <details open className="rounded-lg border border-neutral-800 bg-black/30">
        <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-400">
          Raw event log ({log.length})
        </summary>
        <div className="max-h-64 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-neutral-400">
          {log.map((l, i) => (
            <div key={i}>
              <span className="text-neutral-600">
                {new Date(l.t).toLocaleTimeString()}{" "}
              </span>
              <span className="text-sky-400">{l.type}</span>{" "}
              <span className="text-neutral-500">
                {l.detail.slice(0, 300)}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </details>
    </div>
  );
}
