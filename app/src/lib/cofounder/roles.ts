/**
 * Static role definitions that drive the canvas org map, the Company roles
 * grid, and the Home "Suggested next" module. Eight roles ring the center node
 * to match the reference screenshot; the five with `skill:true` are the ones
 * Cofounder actually installs as Hermes skills (marketing, research, support,
 * operations, finance). Sales, Design, and Legal are shown as future/aspirational
 * seats on the org chart (no skill yet), matching the screenshot's fuller ring.
 */

export interface Role {
  id: string;
  label: string;
  emoji: string;
  /** True if this role has an installed Cofounder skill (see core/skills/). */
  skill: boolean;
  /** Short description for the Company roles grid. */
  blurb: string;
  /** Fuller sentence for the department overview header. */
  deptBlurb: string;
  /** Accent color (hex) for canvas badges, switcher dots, and role chips. */
  color: string;
}

export const ROLES: Role[] = [
  { id: "sales", label: "Sales", emoji: "🤝", skill: false, blurb: "Pipeline, prospecting, deal tracking.", deptBlurb: "Sales agents work the pipeline, follow up with prospects, and keep deals moving.", color: "#e0b15a" },
  { id: "operations", label: "Operations", emoji: "⚙️", skill: true, blurb: "Process, scheduling, reporting, calendar.", deptBlurb: "Operations agents streamline your processes, coordinate teams, and keep everything running smoothly.", color: "#7ea6e0" },
  { id: "marketing", label: "Marketing", emoji: "📣", skill: true, blurb: "Campaigns, content, SEO, brand, social.", deptBlurb: "Marketing agents plan campaigns, write content, and grow your reach across every channel.", color: "#e07ea6" },
  { id: "finance", label: "Finance", emoji: "💰", skill: true, blurb: "Budgeting, invoicing, expense tracking.", deptBlurb: "Finance agents track spend, manage invoices, and keep your numbers straight.", color: "#6fce9f" },
  { id: "design", label: "Design", emoji: "🎨", skill: false, blurb: "Brand visuals, assets, product design.", deptBlurb: "Design agents shape your brand's look and feel, from product UI to marketing assets.", color: "#b98ce0" },
  { id: "legal", label: "Legal", emoji: "⚖️", skill: false, blurb: "Contracts, compliance, policy review.", deptBlurb: "Legal agents review contracts, track compliance, and flag risk before it becomes a problem.", color: "#c9c9cf" },
  { id: "support", label: "Support", emoji: "💬", skill: true, blurb: "Tickets, FAQs, triage, escalation.", deptBlurb: "Support agents triage tickets, answer questions, and escalate what needs a human.", color: "#e09a6f" },
  { id: "research", label: "Research", emoji: "🔬", skill: true, blurb: "Competitor & market intel, company research.", deptBlurb: "Research agents track competitors, scan the market, and dig up the intel you need to decide.", color: "#9fd06f" },
];

/** Roles that map to an installable/installed Cofounder skill. */
export const SKILL_ROLES = ROLES.filter((r) => r.skill);

/**
 * Emoji for a kanban assignee. Board assignees are role names (e.g.
 * "marketing") or role-shaped strings; unknown / unassigned falls back to the
 * Cofounder sunflower. Case-insensitive, tolerant of prefixes like
 * "cofounder/marketing".
 */
export function roleEmoji(assignee?: string | null): string {
  if (!assignee) return "🌻";
  const key = assignee.toLowerCase();
  for (const r of ROLES) {
    if (key === r.id || key.endsWith(`/${r.id}`) || key.includes(r.id)) return r.emoji;
  }
  return "🌻";
}

/** Human label for an assignee (role label, or "Cofounder" when unassigned). */
export function roleLabel(assignee?: string | null): string {
  if (!assignee) return "Cofounder";
  const key = assignee.toLowerCase();
  for (const r of ROLES) {
    if (key === r.id || key.endsWith(`/${r.id}`) || key.includes(r.id)) return r.label;
  }
  return assignee;
}

/**
 * True if a kanban `created_by` (or `assignee`) string resolves to a known
 * role id (as opposed to generic authors like "user"/"worker"/null).
 */
function isRoleId(value?: string | null): boolean {
  if (!value) return false;
  const key = value.toLowerCase();
  return ROLES.some((r) => key === r.id || key.endsWith(`/${r.id}`) || key.includes(r.id));
}

/**
 * Human label for who *delegated* a task, from the kanban `created_by` field.
 * `created_by` is usually a generic author ("user", "worker") rather than a
 * role id, so anything that isn't a recognized role falls back to "Cofounder"
 * (the orchestrator) by convention — the founder always delegates through
 * Cofounder in the product's mental model.
 */
export function delegatorLabel(createdBy?: string | null): string {
  return isRoleId(createdBy) ? roleLabel(createdBy) : "Cofounder";
}

/** Matching emoji for `delegatorLabel` — the role emoji, or the sunflower. */
export function delegatorEmoji(createdBy?: string | null): string {
  return isRoleId(createdBy) ? roleEmoji(createdBy) : "🌻";
}

/**
 * The set of agents that own their own chat session: the cofounder orchestrator
 * plus every skill role. `id` is the chat/agent key used throughout the chat
 * store and the switcher. The orchestrator uses the sunflower; roles carry
 * their emoji + accent color from ROLES.
 */
export interface Agent {
  id: string;
  label: string;
  emoji: string;
  color: string;
  /** True for the cofounder orchestrator (no role persona seeding). */
  orchestrator: boolean;
}

export const COFOUNDER_AGENT: Agent = {
  id: "cofounder",
  label: "Cofounder",
  emoji: "🌻",
  color: "#e8c37a",
  orchestrator: true,
};

/** cofounder orchestrator first, then the five skill roles in a stable order. */
export const AGENTS: Agent[] = [
  COFOUNDER_AGENT,
  ...["marketing", "research", "support", "operations", "finance"].map((id) => {
    const r = ROLES.find((x) => x.id === id)!;
    return { id: r.id, label: r.label, emoji: r.emoji, color: r.color, orchestrator: false };
  }),
];

export function agentById(id: string): Agent {
  return AGENTS.find((a) => a.id === id) ?? COFOUNDER_AGENT;
}

/**
 * Suggested-next actions, one or two per skill role. The Home module samples
 * from this pool; "refresh" reshuffles the sample. Kept static for v1 per PLAN.
 */
export interface Suggestion {
  role: string;
  emoji: string;
  text: string;
}

export const SUGGESTIONS: Suggestion[] = [
  { role: "marketing", emoji: "📣", text: "Draft a launch announcement for this week" },
  { role: "marketing", emoji: "📣", text: "Audit our landing page SEO and list quick wins" },
  { role: "research", emoji: "🔬", text: "Map our top 5 competitors and their pricing" },
  { role: "research", emoji: "🔬", text: "Find recent market trends in our category" },
  { role: "operations", emoji: "⚙️", text: "Set up a weekly status digest" },
  { role: "operations", emoji: "⚙️", text: "Draft an onboarding checklist for new hires" },
  { role: "finance", emoji: "💰", text: "Build a simple monthly burn tracker" },
  { role: "finance", emoji: "💰", text: "Summarize this quarter's spend by category" },
  { role: "support", emoji: "💬", text: "Draft answers to our 10 most common questions" },
  { role: "support", emoji: "💬", text: "Set up a triage flow for incoming tickets" },
];

/** Fisher–Yates sample of `n` suggestions. */
export function sampleSuggestions(n = 4, seed = SUGGESTIONS): Suggestion[] {
  const arr = [...seed];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** Context used to make suggestions company-aware (no LLM — plain templating). */
export interface SuggestionContext {
  companyName?: string;
  goals?: string[];
}

/**
 * Build starter-idea suggestions. When company context exists (name/goals from
 * onboarding), a couple of interpolated, context-aware ideas are prepended so
 * the list visibly reflects *this* company; the rest are sampled from the
 * static pool. Purely template-based — no model call.
 */
export function buildSuggestions(n = 4, ctx?: SuggestionContext): Suggestion[] {
  const contextual: Suggestion[] = [];
  const co = ctx?.companyName?.trim();
  const goals = (ctx?.goals ?? []).map((g) => g.trim()).filter(Boolean);
  if (goals.length) {
    contextual.push({
      role: "operations",
      emoji: "⚙️",
      text: `Break down "${goals[0]}" into a plan with next steps`,
    });
  }
  if (co) {
    contextual.push({
      role: "research",
      emoji: "🔬",
      text: `Research the competitive landscape for ${co}`,
    });
  }
  if (co && goals.length > 1) {
    contextual.push({
      role: "marketing",
      emoji: "📣",
      text: `Draft a message positioning ${co} around "${goals[1]}"`,
    });
  }
  if (!contextual.length) return sampleSuggestions(n);
  const rest = sampleSuggestions(Math.max(0, n - contextual.length));
  return [...contextual, ...rest].slice(0, n);
}
