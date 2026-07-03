/**
 * Cofounder onboarding config — founder name, workspace root, and the company
 * profile answered during onboarding. Persisted to localStorage (fast,
 * offline-friendly) and also written into the workspace (shared/company.md) by
 * bootstrap so the agents can read it. This module owns the localStorage
 * contract; UI reads/writes only through here.
 */

const KEY = "cofounder.config.v1";

/** Company stage — matches the onboarding step-3 options. */
export type CompanyStage = "idea" | "building" | "launched" | "revenue";

export const STAGE_OPTIONS: { id: CompanyStage; label: string; hint: string }[] = [
  { id: "idea", label: "Idea", hint: "Still shaping the concept" },
  { id: "building", label: "Building", hint: "Heads-down on the product" },
  { id: "launched", label: "Launched", hint: "Live, gathering users" },
  { id: "revenue", label: "Revenue", hint: "Paying customers" },
];

export interface CompanyProfile {
  /** Company / project name (may differ from a legal entity name). */
  name: string;
  /** One-line description of what the company does. */
  description: string;
  stage?: CompanyStage;
  /** Industry and/or target audience, free text. */
  industry: string;
  /** Top 1–3 goals right now, one per entry. */
  goals: string[];
}

export interface CofounderConfig {
  founderName: string;
  /** Kept for backward-compat; mirrors company.name. */
  companyName: string;
  workspaceRoot: string;
  /** Company context gathered during onboarding step 3 (optional / skippable). */
  company?: CompanyProfile;
  /** Set once bootstrap has completed successfully. */
  bootstrapped: boolean;
}

/** Default workspace root — `~/Cofounder-Workspace` resolved lazily at use. */
export const DEFAULT_WORKSPACE_HINT = "~/Cofounder-Workspace";

export function emptyCompany(): CompanyProfile {
  return { name: "", description: "", stage: undefined, industry: "", goals: [""] };
}

/** True if the founder actually filled in any company context. */
export function hasCompanyContext(c: CompanyProfile | undefined): boolean {
  if (!c) return false;
  return Boolean(
    c.name.trim() ||
      c.description.trim() ||
      c.industry.trim() ||
      c.stage ||
      c.goals.some((g) => g.trim()),
  );
}

export function loadConfig(): CofounderConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CofounderConfig>;
    if (!c.founderName || !c.workspaceRoot) return null;
    const company = c.company
      ? {
          name: c.company.name ?? c.companyName ?? "",
          description: c.company.description ?? "",
          stage: c.company.stage,
          industry: c.company.industry ?? "",
          goals: Array.isArray(c.company.goals) ? c.company.goals : [],
        }
      : c.companyName
        ? { ...emptyCompany(), name: c.companyName }
        : undefined;
    return {
      founderName: c.founderName,
      companyName: c.companyName ?? company?.name ?? "",
      workspaceRoot: c.workspaceRoot,
      company,
      bootstrapped: Boolean(c.bootstrapped),
    };
  } catch {
    return null;
  }
}

export function saveConfig(c: CofounderConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private-mode / quota — non-fatal, config just won't persist */
  }
}

export function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "there";
}

/** Two-letter uppercase initials from a name, for the profile chip. */
export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "S";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "P";
  return (a + b).toUpperCase();
}
