/**
 * Settings / Context panel — surfaced as a section in the Library tab.
 * Lets the founder manage the pieces of "context" the cofounder profile
 * actually uses: the workspace root, the company profile (also mirrored into
 * shared/company.md), a read-only model/provider readout, an optional context
 * breakdown for the live Cofounder chat session, and the custom system
 * prompt (falls back to a read-only SOUL view if config.set isn't wired for
 * this build).
 *
 * Backend calls used here (verified against source, see inline citations):
 *   - hermesRest.getSoul / putSoul     — GET/PUT /api/profiles/{name}/soul
 *     (app/src/lib/hermes/rest.ts:180-190)
 *   - hermesRest.fsWriteText           — POST /api/fs/write-text
 *     (app/src/lib/hermes/rest.ts:157-159; web_server.py:1903)
 *   - hermesWs.request("config.get", {key:"provider"})
 *     — tui_gateway/server.py:10722-10740 → {model, provider, providers}
 *   - hermesWs.request("config.get", {key:"prompt"})
 *     — tui_gateway/server.py:10754-10755 → {prompt}
 *   - hermesWs.request("config.set", {key:"prompt", value})
 *     — tui_gateway/server.py:10253-10263 → persists custom_prompt in
 *       config.yaml (global to the Hermes install, not per-profile — noted
 *       in the UI)
 *   - hermesWs.request("session.context_breakdown", {session_id})
 *     — tui_gateway/server.py:6213-6240 → requires a LIVE gateway session id
 *       (chats[agentId].sessionId from useChat, not the stored session key);
 *       returns {} shaped payload with categories/context_max/context_used.
 *
 * config.get/config.set here are global Hermes settings (not scoped to the
 * "cofounder" profile) — this is a limitation of the underlying RPCs, called
 * out inline in the UI copy so it isn't mistaken for per-profile state.
 */

import { useCallback, useEffect, useState } from "react";
import { hermesRest, hermesWs } from "@/lib/hermes";
import { useChat } from "@/state/chat";
import {
  loadConfig,
  saveConfig,
  emptyCompany,
  type CofounderConfig,
  type CompanyProfile,
  type CompanyStage,
  STAGE_OPTIONS,
} from "@/lib/cofounder/config";
import { COFOUNDER_PROFILE, renderSoul, joinPath } from "@/lib/cofounder/bootstrap";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function SettingsSection() {
  const [cfg, setCfg] = useState<CofounderConfig | null>(null);

  useEffect(() => {
    setCfg(loadConfig());
  }, []);

  if (!cfg) {
    return (
      <section>
        <SectionHeading>Settings</SectionHeading>
        <EmptyRow text="No saved configuration yet — finish onboarding first." />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <SectionHeading>Settings · Context</SectionHeading>
      <WorkspaceRootCard cfg={cfg} onSaved={setCfg} />
      <CompanyProfileCard cfg={cfg} onSaved={setCfg} />
      <ModelCard />
      <ContextBreakdownCard />
      <SystemPromptCard />
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
      {children}
    </h2>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-4 text-center text-[12.5px] text-[#6a6a72]">
      {text}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#222327] bg-[#141518] p-3.5">
      <div className="mb-3 text-[13px] font-medium text-[#e2e2e6]">{title}</div>
      {children}
    </div>
  );
}

function SaveButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : state === "error" ? "Retry" : "Save";
  return (
    <button
      onClick={onClick}
      disabled={state === "saving"}
      className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
        state === "error"
          ? "bg-[#2a1a1c] text-[#e08a8a] hover:bg-[#332022]"
          : "bg-[#26272c] text-[#e7e7ea] hover:bg-[#2e2f35]"
      }`}
    >
      {label}
    </button>
  );
}

// ── Workspace root ───────────────────────────────────────────────────────────

function WorkspaceRootCard({
  cfg,
  onSaved,
}: {
  cfg: CofounderConfig;
  onSaved: (c: CofounderConfig) => void;
}) {
  const [root, setRoot] = useState(cfg.workspaceRoot);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [soulRoot, setSoulRoot] = useState<string | null>(null);

  useEffect(() => setRoot(cfg.workspaceRoot), [cfg.workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hermesRest.getSoul<{ content?: string }>(COFOUNDER_PROFILE);
        const m = (res.content ?? "").match(/\*\*Workspace root:\*\*\s*`([^`]+)`/);
        if (!cancelled) setSoulRoot(m ? m[1] : null);
      } catch {
        if (!cancelled) setSoulRoot(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.workspaceRoot, state]);

  const save = useCallback(async () => {
    const trimmed = root.trim();
    if (!trimmed) {
      setState("error");
      setError("Workspace root can't be empty.");
      return;
    }
    setState("saving");
    setError(null);
    const next: CofounderConfig = { ...cfg, workspaceRoot: trimmed };
    try {
      // Re-point the SOUL so agents pick up the new root immediately — same
      // renderer bootstrap uses (bootstrap.ts renderSoul + putSoul).
      await hermesRest.putSoul(COFOUNDER_PROFILE, renderSoul(trimmed));
      saveConfig(next);
      onSaved(next);
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setState("error");
      setError(String(err));
    }
  }, [root, cfg, onSaved]);

  const dirty = root.trim() !== cfg.workspaceRoot;

  return (
    <Card title="Workspace root">
      <p className="mb-2.5 text-[12px] leading-relaxed text-[#9a9aa2]">
        All workspace reads/writes (Company tab file browser, agent file access) use this
        path. Saving also rewrites the cofounder profile's SOUL so agents switch to the new
        root immediately.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          spellCheck={false}
          className="flex-1 rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 font-mono text-[12px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
        />
        <SaveButton state={dirty ? state : "idle"} onClick={save} />
      </div>
      {error && <div className="mt-2 text-[11.5px] text-[#e08a8a]">{error}</div>}
      <div className="mt-2.5 text-[11px] text-[#6a6a72]">
        SOUL currently configured for:{" "}
        <span className="font-mono text-[#8a8a92]">{soulRoot ?? "(unreadable)"}</span>
        {soulRoot && soulRoot !== cfg.workspaceRoot && (
          <span className="text-[#c9a15a]"> — out of sync with saved config, save to fix</span>
        )}
      </div>
    </Card>
  );
}

// ── Company profile ──────────────────────────────────────────────────────────

function CompanyProfileCard({
  cfg,
  onSaved,
}: {
  cfg: CofounderConfig;
  onSaved: (c: CofounderConfig) => void;
}) {
  const [founderName, setFounderName] = useState(cfg.founderName);
  const [company, setCompany] = useState<CompanyProfile>(cfg.company ?? emptyCompany());
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [companyMdNote, setCompanyMdNote] = useState<string | null>(null);

  useEffect(() => {
    setFounderName(cfg.founderName);
    setCompany(cfg.company ?? emptyCompany());
  }, [cfg]);

  const setGoal = (i: number, value: string) => {
    setCompany((c) => {
      const goals = [...c.goals];
      goals[i] = value;
      return { ...c, goals };
    });
  };
  const addGoal = () => setCompany((c) => ({ ...c, goals: [...c.goals, ""] }));
  const removeGoal = (i: number) =>
    setCompany((c) => ({ ...c, goals: c.goals.filter((_, idx) => idx !== i) }));

  const save = useCallback(async () => {
    setState("saving");
    setError(null);
    setCompanyMdNote(null);
    const next: CofounderConfig = {
      ...cfg,
      founderName: founderName.trim() || cfg.founderName,
      companyName: company.name.trim() || cfg.companyName,
      company,
    };
    // localStorage save always succeeds (or silently no-ops in private mode);
    // the workspace-file mirror is best-effort.
    saveConfig(next);
    onSaved(next);
    try {
      await writeCompanyMarkdown(cfg.workspaceRoot, next);
      setCompanyMdNote("Saved locally and updated shared/company.md.");
    } catch (err) {
      setCompanyMdNote(`Saved locally. Could not update shared/company.md: ${String(err)}`);
    }
    setState("saved");
    setTimeout(() => setState("idle"), 1800);
  }, [cfg, founderName, company, onSaved]);

  return (
    <Card title="Company profile">
      <div className="flex flex-col gap-2.5">
        <Field label="Founder name">
          <input
            value={founderName}
            onChange={(e) => setFounderName(e.target.value)}
            className="w-full rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12.5px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
          />
        </Field>
        <Field label="Company / project name">
          <input
            value={company.name}
            onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
            className="w-full rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12.5px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={company.description}
            onChange={(e) => setCompany((c) => ({ ...c, description: e.target.value }))}
            rows={2}
            className="w-full resize-none rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12.5px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
          />
        </Field>
        <Field label="Industry / audience">
          <input
            value={company.industry}
            onChange={(e) => setCompany((c) => ({ ...c, industry: e.target.value }))}
            className="w-full rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12.5px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
          />
        </Field>
        <Field label="Stage">
          <div className="flex flex-wrap gap-1.5">
            {STAGE_OPTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  setCompany((c) => ({ ...c, stage: c.stage === s.id ? undefined : (s.id as CompanyStage) }))
                }
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                  company.stage === s.id
                    ? "border-[#3a3b42] bg-[#26272c] text-[#e7e7ea]"
                    : "border-[#2a2b30] text-[#8a8a92] hover:text-[#c7c7cd]"
                }`}
                title={s.hint}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Top goals">
          <div className="flex flex-col gap-1.5">
            {company.goals.map((g, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={g}
                  onChange={(e) => setGoal(i, e.target.value)}
                  className="flex-1 rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12.5px] text-[#d0d0d5] outline-none focus:border-[#3a3b42]"
                />
                <button
                  onClick={() => removeGoal(i)}
                  className="text-[12px] text-[#6a6a72] hover:text-[#e08a8a]"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addGoal}
              className="self-start text-[11.5px] text-[#8a8a92] hover:text-[#c7c7cd]"
            >
              + add goal
            </button>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <SaveButton state={state} onClick={save} />
      </div>
      {error && <div className="mt-2 text-[11.5px] text-[#e08a8a]">{error}</div>}
      {companyMdNote && <div className="mt-2 text-[11px] text-[#6a6a72]">{companyMdNote}</div>}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-wide text-[#6a6a72]">{label}</span>
      {children}
    </label>
  );
}

/**
 * Minimal shared/company.md writer — mirrors the structure bootstrap.ts's
 * (unexported) writeCompanyProfile produces, so re-saving from Settings keeps
 * the same file shape agents already read. Overwrites the file (same
 * "derived from onboarding, always safe to refresh" rule bootstrap uses).
 */
async function writeCompanyMarkdown(workspaceRoot: string, cfg: CofounderConfig): Promise<void> {
  const companyPath = joinPath(workspaceRoot, "shared/company.md");
  const c = cfg.company;
  const today = new Date().toISOString().slice(0, 10);
  const stageLabel = c?.stage ? (STAGE_OPTIONS.find((s) => s.id === c.stage)?.label ?? c.stage) : "";
  const goals = (c?.goals ?? []).map((g) => g.trim()).filter(Boolean);
  const name = (c?.name || cfg.companyName || "").trim();
  const lines = [
    `# ${name || "Company"}`,
    "",
    "> Company profile — edited from Settings. Cofounder and its role agents",
    "> read this file for context.",
    "",
    "## At a glance",
    "",
    `- **Company / project:** ${name || "(not set)"}`,
    `- **Founder:** ${(cfg.founderName || "").trim() || "(not set)"}`,
    `- **Stage:** ${stageLabel || "(not set)"}`,
    `- **Industry / audience:** ${(c?.industry || "").trim() || "(not set)"}`,
    `- **Workspace root:** ${workspaceRoot}`,
    `- **Updated:** ${today}`,
    "",
    "## What we do",
    "",
    (c?.description || "").trim() || "_(add a one-line description)_",
    "",
    "## Top goals right now",
    "",
    goals.length ? goals.map((g) => `- ${g}`).join("\n") : "_(add 1–3 goals)_",
    "",
  ];
  await hermesRest.fsWriteText(companyPath, lines.join("\n"));
}

// ── Model / provider (read-only) ─────────────────────────────────────────────

function ModelCard() {
  const [info, setInfo] = useState<{ model?: string; provider?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (hermesWs.connectionState !== "open") await hermesWs.connect();
        const res = await hermesWs.request<{ model?: string; provider?: string }>(
          "config.get",
          { key: "provider" },
        );
        if (!cancelled) setInfo(res);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card title="Model / provider">
      <p className="mb-2 text-[12px] leading-relaxed text-[#9a9aa2]">
        Default model for this Hermes install (per-session model choice happens in chat, not
        here).
      </p>
      {error ? (
        <div className="text-[11.5px] text-[#8a8a92]">Unavailable: {error}</div>
      ) : !info ? (
        <div className="text-[11.5px] text-[#6a6a72]">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <span className="rounded-full border border-[#2c2d33] bg-[#181a1e] px-2.5 py-1 text-[#a7a7ae]">
            model: <span className="text-[#e8c37a]">{info.model || "unknown"}</span>
          </span>
          <span className="rounded-full border border-[#2c2d33] bg-[#181a1e] px-2.5 py-1 text-[#a7a7ae]">
            provider: <span className="text-[#e8c37a]">{info.provider || "unknown"}</span>
          </span>
        </div>
      )}
    </Card>
  );
}

// ── Context breakdown (optional) ─────────────────────────────────────────────

interface ContextBreakdown {
  categories?: { label?: string; tokens?: number }[];
  context_max?: number;
  context_used?: number;
  context_percent?: number;
  model?: string;
}

function ContextBreakdownCard() {
  const sessionId = useChat((s) => s.chats["cofounder"]?.sessionId ?? null);
  const [data, setData] = useState<ContextBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      const res = await hermesWs.request<ContextBreakdown>("session.context_breakdown", {
        session_id: sessionId,
      });
      setData(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  return (
    <Card title="Context breakdown">
      {!sessionId ? (
        <div className="text-[11.5px] text-[#6a6a72]">
          No live Cofounder chat session yet — open the Cofounder tab and send a message, then
          come back here to see its context usage.
        </div>
      ) : (
        <>
          <button
            onClick={load}
            disabled={loading}
            className="mb-2.5 rounded-full bg-[#26272c] px-3 py-1 text-[11.5px] text-[#e7e7ea] hover:bg-[#2e2f35] disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          {error && <div className="text-[11.5px] text-[#8a8a92]">Unavailable: {error}</div>}
          {data && (
            <div className="flex flex-col gap-1.5 text-[12px] text-[#c7c7cd]">
              <div>
                Used: {data.context_used ?? 0} / {data.context_max ?? 0} tokens (
                {data.context_percent ?? 0}%)
              </div>
              {(data.categories ?? []).map((c, i) => (
                <div key={i} className="flex justify-between text-[11.5px] text-[#9a9aa2]">
                  <span>{c.label ?? "?"}</span>
                  <span>{c.tokens ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Custom system prompt ──────────────────────────────────────────────────────

function SystemPromptCard() {
  const [prompt, setPrompt] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [soul, setSoul] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (hermesWs.connectionState !== "open") await hermesWs.connect();
        const res = await hermesWs.request<{ prompt?: string }>("config.get", { key: "prompt" });
        if (!cancelled) {
          setPrompt(res.prompt ?? "");
          setAvailable(true);
        }
      } catch {
        if (!cancelled) setAvailable(false);
      }
      try {
        const res = await hermesRest.getSoul<{ content?: string }>(COFOUNDER_PROFILE);
        if (!cancelled) setSoul(res.content ?? "");
      } catch {
        if (!cancelled) setSoul(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    setState("saving");
    setError(null);
    try {
      await hermesWs.request("config.set", { key: "prompt", value: prompt });
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setState("error");
      setError(String(err));
    }
  }, [prompt]);

  return (
    <Card title="Custom system prompt">
      {available === false ? (
        <>
          <p className="mb-2 text-[12px] leading-relaxed text-[#9a9aa2]">
            Custom prompt config isn't reachable right now. Showing the cofounder profile's SOUL
            (read-only) instead — this is what actually drives the orchestrator's behavior.
          </p>
          {soul == null ? (
            <div className="text-[11.5px] text-[#6a6a72]">Loading…</div>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[#2a2b30] bg-[#0f1012] p-2.5 text-[11px] leading-relaxed text-[#a7a7ae]">
              {soul || "(empty)"}
            </pre>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-[12px] leading-relaxed text-[#9a9aa2]">
            Extra instructions layered on top of the base agent prompt. This is a Hermes-wide
            setting (not scoped to the cofounder profile specifically).
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={available === null ? "Loading…" : "(none set)"}
            disabled={available === null}
            className="w-full resize-none rounded-lg border border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[12px] text-[#d0d0d5] outline-none focus:border-[#3a3b42] disabled:opacity-50"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <SaveButton state={state} onClick={save} />
          </div>
          {error && <div className="mt-2 text-[11.5px] text-[#e08a8a]">{error}</div>}
        </>
      )}
    </Card>
  );
}
