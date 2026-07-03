/**
 * First-run onboarding v2 — a polished multi-step flow in the app's design
 * language (serif display headings, dark #111214):
 *
 *   1. Welcome        → founder name.
 *   2. Workspace      → pick/create the workspace folder.
 *   3. Company context→ name, one-line description, stage, industry/audience,
 *                       top 1–3 goals. Skippable but encouraged.
 *   4. Bootstrap      → live step checklist (src/lib/cofounder/bootstrap.ts),
 *                       which also writes shared/company.md, appends a
 *                       decisions.md entry, and ensures the profile's toolsets.
 *
 * On success, saves config (including the company profile) and calls onDone().
 */

import { useState } from "react";
import { runBootstrap, type BootstrapStep } from "@/lib/cofounder/bootstrap";
import {
  DEFAULT_WORKSPACE_HINT,
  STAGE_OPTIONS,
  emptyCompany,
  hasCompanyContext,
  saveConfig,
  type CofounderConfig,
  type CompanyProfile,
  type CompanyStage,
} from "@/lib/cofounder/config";

type Phase = "form" | "installing" | "error";
type Step = 1 | 2 | 3;

export default function Onboarding({ onDone }: { onDone: (c: CofounderConfig) => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<Step>(1);
  const [founder, setFounder] = useState("");
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE_HINT);
  const [company, setCompany] = useState<CompanyProfile>(() => emptyCompany());
  const [steps, setSteps] = useState<BootstrapStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  const patchCompany = (p: Partial<CompanyProfile>) =>
    setCompany((c) => ({ ...c, ...p }));
  const setGoal = (i: number, v: string) =>
    setCompany((c) => {
      const goals = [...c.goals];
      goals[i] = v;
      return { ...c, goals };
    });

  const start = async () => {
    if (!founder.trim()) return;
    setPhase("installing");
    setError(null);
    const cleanGoals = company.goals.map((g) => g.trim()).filter(Boolean);
    const companyProfile: CompanyProfile | undefined = hasCompanyContext(company)
      ? { ...company, goals: cleanGoals }
      : undefined;
    const cfg: CofounderConfig = {
      founderName: founder.trim(),
      companyName: (companyProfile?.name ?? "").trim(),
      workspaceRoot: workspace.trim() || DEFAULT_WORKSPACE_HINT,
      company: companyProfile,
      bootstrapped: false,
    };
    try {
      await runBootstrap({
        workspaceRoot: cfg.workspaceRoot,
        founderName: cfg.founderName,
        companyName: cfg.companyName,
        company: companyProfile,
        onProgress: (p) => setSteps(p.steps),
      });
      const done = { ...cfg, bootstrapped: true };
      saveConfig(done);
      setTimeout(() => onDone(done), 550);
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  };

  const next = () => setStep((s) => (s === 3 ? 3 : ((s + 1) as Step)));
  const back = () => setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)));

  return (
    <div className="flex h-screen items-center justify-center bg-[#0e0f11] p-6">
      <div className="w-full max-w-md co-fadein">
        <div className="mb-6 text-center">
          <div className="mb-2 text-5xl">🌻</div>
          <h1 className="font-serif-display text-[34px] text-[#efeff1]">
            Welcome to Cofounder
          </h1>
          <p className="mt-1 text-[13px] text-[#8a8a92]">
            Your full company in software. Let's set up your AI team.
          </p>
        </div>

        {phase === "form" && (
          <div className="rounded-2xl border border-[#222327] bg-[#141518] p-5">
            <StepDots step={step} />

            {step === 1 && (
              <div className="co-fadein">
                <h2 className="mb-1 font-serif-display text-[22px] text-[#efeff1]">
                  First, who are you?
                </h2>
                <p className="mb-4 text-[12px] text-[#8a8a92]">
                  So Cofounder knows who it's working with.
                </p>
                <Field label="Your name">
                  <input
                    autoFocus
                    value={founder}
                    onChange={(e) => setFounder(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && founder.trim() && next()}
                    placeholder="e.g. Sahil"
                    className={inputCls}
                  />
                </Field>
                <PrimaryBtn onClick={next} disabled={!founder.trim()}>
                  Continue →
                </PrimaryBtn>
              </div>
            )}

            {step === 2 && (
              <div className="co-fadein">
                <h2 className="mb-1 font-serif-display text-[22px] text-[#efeff1]">
                  Where should your team work?
                </h2>
                <p className="mb-4 text-[12px] text-[#8a8a92]">
                  A folder your agents read and write files in. We'll create it if
                  it doesn't exist. <span className="text-[#6a6a72]">~ expands to your home.</span>
                </p>
                <Field label="Workspace folder">
                  <input
                    autoFocus
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && next()}
                    className={`${inputCls} font-mono text-[13px]`}
                  />
                </Field>
                <div className="mb-4 rounded-lg border border-[#222327] bg-[#111214] px-3 py-2 text-[11.5px] text-[#8a8a92]">
                  📁 Creates <span className="font-mono text-[#b6b6bc]">{workspace || DEFAULT_WORKSPACE_HINT}</span> with per-role folders and a decision log.
                </div>
                <div className="flex gap-2">
                  <SecondaryBtn onClick={back}>← Back</SecondaryBtn>
                  <PrimaryBtn onClick={next}>Continue →</PrimaryBtn>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="co-fadein">
                <h2 className="mb-1 font-serif-display text-[22px] text-[#efeff1]">
                  Tell Cofounder about your company
                </h2>
                <p className="mb-4 text-[12px] text-[#8a8a92]">
                  Optional, but it makes every answer sharper. You can edit this
                  anytime in <span className="font-mono text-[#6a6a72]">shared/company.md</span>.
                </p>

                <div className="max-h-[46vh] overflow-y-auto pr-1">
                  <Field label="Company or project name">
                    <input
                      autoFocus
                      value={company.name}
                      onChange={(e) => patchCompany({ name: e.target.value })}
                      placeholder="e.g. Acme Inc."
                      className={inputCls}
                    />
                  </Field>
                  <Field label="One-line description">
                    <input
                      value={company.description}
                      onChange={(e) => patchCompany({ description: e.target.value })}
                      placeholder="What does it do, in a sentence?"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Stage">
                    <div className="grid grid-cols-2 gap-2">
                      {STAGE_OPTIONS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            patchCompany({
                              stage: company.stage === s.id ? undefined : (s.id as CompanyStage),
                            })
                          }
                          className={`rounded-lg border px-3 py-2 text-left transition ${
                            company.stage === s.id
                              ? "border-[#4a4b52] bg-[#1f2126]"
                              : "border-[#2a2b30] bg-[#111214] hover:border-[#3a3b42]"
                          }`}
                        >
                          <div className="text-[13px] text-[#e2e2e6]">{s.label}</div>
                          <div className="text-[10.5px] text-[#7a7a82]">{s.hint}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Industry / audience">
                    <input
                      value={company.industry}
                      onChange={(e) => patchCompany({ industry: e.target.value })}
                      placeholder="e.g. B2B SaaS for restaurants"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Top goals right now" hint="Up to three.">
                    <div className="flex flex-col gap-2">
                      {[0, 1, 2].map((i) => (
                        <input
                          key={i}
                          value={company.goals[i] ?? ""}
                          onChange={(e) => setGoal(i, e.target.value)}
                          placeholder={
                            i === 0
                              ? "e.g. Land first 10 paying customers"
                              : `Goal ${i + 1} (optional)`
                          }
                          className={inputCls}
                        />
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="mt-2 flex gap-2">
                  <SecondaryBtn onClick={back}>← Back</SecondaryBtn>
                  <PrimaryBtn onClick={() => void start()} disabled={!founder.trim()}>
                    {hasCompanyContext(company) ? "Set up my company →" : "Skip & set up →"}
                  </PrimaryBtn>
                </div>
              </div>
            )}
          </div>
        )}

        {(phase === "installing" || phase === "error") && (
          <div className="rounded-2xl border border-[#222327] bg-[#141518] p-5">
            <ul className="flex flex-col gap-2.5">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <StepIcon status={s.status} />
                  <div className="flex-1">
                    <div
                      className={`text-[13px] ${
                        s.status === "error"
                          ? "text-red-300"
                          : s.status === "pending"
                            ? "text-[#6a6a72]"
                            : "text-[#d6d6da]"
                      }`}
                    >
                      {s.label}
                    </div>
                    {s.detail && (
                      <div className="text-[11px] text-[#6a6a72]">{s.detail}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {phase === "error" && (
              <div className="mt-4">
                <div className="mb-3 rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2 text-[12px] text-red-300">
                  {error}
                </div>
                <button
                  onClick={() => void start()}
                  className="w-full rounded-lg border border-[#3a3b42] py-2 text-[13px] text-[#d0d0d6] transition hover:bg-[#26272c]"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#2a2b30] bg-[#111214] px-3 py-2.5 text-[14px] text-[#e7e7ea] outline-none focus:border-[#4a4b52] placeholder:text-[#5f5f67]";

function StepDots({ step }: { step: Step }) {
  const labels = ["You", "Workspace", "Company"];
  return (
    <div className="mb-5 flex items-center gap-2">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                active
                  ? "bg-[#e7e7ea] text-black"
                  : done
                    ? "bg-emerald-600/90 text-white"
                    : "border border-[#33343a] text-[#6a6a72]"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-[11px] ${active ? "text-[#d6d6da]" : "text-[#6a6a72]"}`}>
              {l}
            </span>
            {i < labels.length - 1 && <span className="text-[#33343a]">·</span>}
          </div>
        );
      })}
    </div>
  );
}

function PrimaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg bg-[#e7e7ea] py-2.5 text-[14px] font-medium text-black transition hover:bg-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-lg border border-[#3a3b42] px-4 py-2.5 text-[13px] text-[#d0d0d6] transition hover:bg-[#26272c]"
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-[12px] font-medium text-[#c7c7cd]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#6a6a72]">{hint}</p>}
    </div>
  );
}

function StepIcon({ status }: { status: BootstrapStep["status"] }) {
  if (status === "running")
    return (
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#4a4b52] border-t-[#e8c37a]" />
    );
  if (status === "done" || status === "skipped")
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/90 text-[10px] text-white">
        ✓
      </span>
    );
  if (status === "error")
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">
        !
      </span>
    );
  return <span className="h-4 w-4 shrink-0 rounded-full border border-[#33343a]" />;
}
