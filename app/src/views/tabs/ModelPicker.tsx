/**
 * Compact model picker for the Cofounder composer. Reads the backend's own
 * model catalog (sessions.modelOptions → model.options RPC), groups by provider,
 * marks the active model, dims providers without credentials, and applies the
 * choice via the chat store (persists to the profile + rebinds the next
 * session). Design language: dark, compact chip + dropdown.
 */

import { useEffect, useRef, useState } from "react";
import { sessions } from "@/lib/hermes";
import type { ModelProviderRow } from "@/lib/hermes";
import { useChat } from "@/state/chat";

/** Short display label for a model id (drop the provider prefix if present). */
function shortModel(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
}

export default function ModelPicker() {
  // Model is per-agent now (each role is its own profile) — read the active
  // chat's own slot, not a global value.
  const model = useChat((s) => s.chats[s.activeAgent]?.model ?? null);
  // Scope "current model" resolution to the active chat's live session.
  const sessionId = useChat((s) => s.chats[s.activeAgent]?.sessionId ?? null);
  const setModel = useChat((s) => s.setModel);

  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ModelProviderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Load the catalog the first time the menu opens.
  useEffect(() => {
    if (!open || providers || loading) return;
    setLoading(true);
    setError(null);
    void sessions
      .modelOptions(sessionId ? { session_id: sessionId } : {})
      .then((res) => {
        // Only providers with at least one model; authed first, then the rest.
        const rows = (res.providers ?? []).filter((p) => (p.models ?? []).length > 0);
        rows.sort((a, b) => Number(!!b.authenticated) - Number(!!a.authenticated));
        setProviders(rows);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open, providers, loading, sessionId]);

  const label = model ? shortModel(model) : "default model";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Model for new messages"
        className={`inline-flex max-w-[180px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
          open
            ? "border-[#3a3b42] bg-[#202127] text-[#e7e7ea]"
            : "border-[#2a2b30] bg-[#17181b] text-[#9a9aa2] hover:border-[#3a3b42] hover:text-[#c7c7cd]"
        }`}
      >
        <span className="text-[10px]">◇</span>
        <span className="truncate">{label}</span>
        <span className="text-[#6a6a72]">▾</span>
      </button>

      {open && (
        <div className="co-fadein absolute bottom-9 left-0 z-40 max-h-80 w-72 overflow-y-auto rounded-2xl border border-[#2a2b30] bg-[#141518] p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]">
          {loading && (
            <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">
              loading models…
            </div>
          )}
          {error && (
            <div className="px-2 py-3 text-center text-[12px] text-amber-400/90">
              Couldn't load models — {error}
            </div>
          )}
          {providers?.map((p) => {
            const authed = p.authenticated !== false;
            return (
              <div key={p.slug} className="mb-1 last:mb-0">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6a6a72]">
                  {p.name || p.slug}
                  {!authed && (
                    <span className="rounded-full border border-[#2a2b30] px-1.5 py-px text-[8.5px] font-medium normal-case tracking-normal text-[#5f5f67]">
                      no credentials
                    </span>
                  )}
                </div>
                {authed ? (
                  <ul>
                    {p.models.map((mid) => {
                      const active = mid === model;
                      return (
                        <li key={mid}>
                          <button
                            onClick={() => {
                              setOpen(false);
                              void setModel(mid, p.slug);
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition ${
                              active
                                ? "bg-[#202127] text-[#f0f0f2]"
                                : "text-[#c7c7cd] hover:bg-[#1a1b1f]"
                            }`}
                          >
                            <span className="w-3 text-[10px] text-emerald-400">
                              {active ? "✓" : ""}
                            </span>
                            <span className="flex-1 truncate">{shortModel(mid)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-2 pb-1 text-[11px] text-[#5f5f67]">
                    Add credentials in Hermes to use {p.name || p.slug}.
                  </div>
                )}
              </div>
            );
          })}
          {providers && providers.length === 0 && !loading && (
            <div className="px-2 py-4 text-center text-[12px] text-[#6a6a72]">
              No models available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
