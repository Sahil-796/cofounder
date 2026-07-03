/**
 * Raw text of the Cofounder domain assets, imported via Vite `?raw`. The source
 * of truth lives in the repo-level `core/` directory (Task B); a small sync
 * step (scripts/sync-core-assets.mjs, run on predev/prebuild) copies them into
 * `src/assets/cofounder/` so the bundler can inline them here. Never edit the
 * copies under src/assets — edit `core/` and re-run `npm run sync-core`.
 */

import SOUL from "@/assets/cofounder/orchestrator/SOUL.md?raw";
import connectorsJson from "@/assets/cofounder/connectors.json?raw";

import marketingSkill from "@/assets/cofounder/skills/marketing/SKILL.md?raw";
import researchSkill from "@/assets/cofounder/skills/research/SKILL.md?raw";
import supportSkill from "@/assets/cofounder/skills/support/SKILL.md?raw";
import operationsSkill from "@/assets/cofounder/skills/operations/SKILL.md?raw";
import financeSkill from "@/assets/cofounder/skills/finance/SKILL.md?raw";

import wsMarketing from "@/assets/cofounder/workspace-template/marketing/README.md?raw";
import wsSales from "@/assets/cofounder/workspace-template/sales/README.md?raw";
import wsOperations from "@/assets/cofounder/workspace-template/operations/README.md?raw";
import wsResearch from "@/assets/cofounder/workspace-template/research/README.md?raw";
import wsShared from "@/assets/cofounder/workspace-template/shared/README.md?raw";
import wsDecisions from "@/assets/cofounder/workspace-template/.cofounder/decisions.md?raw";
import wsLearnings from "@/assets/cofounder/workspace-template/.cofounder/learnings/README.md?raw";

export const SOUL_MD = SOUL;

/** The five Cofounder role skills, installed under category "cofounder". */
export const ROLE_SKILLS: Record<string, string> = {
  marketing: marketingSkill,
  research: researchSkill,
  support: supportSkill,
  operations: operationsSkill,
  finance: financeSkill,
};

/**
 * Workspace seed files, keyed by their path *relative to the workspace root*.
 * Directories (the keys' parents) are created via `filesMkdir` first.
 */
export const WORKSPACE_SEED_FILES: Record<string, string> = {
  "marketing/README.md": wsMarketing,
  "sales/README.md": wsSales,
  "operations/README.md": wsOperations,
  "research/README.md": wsResearch,
  "shared/README.md": wsShared,
  ".cofounder/decisions.md": wsDecisions,
  ".cofounder/learnings/README.md": wsLearnings,
};

/** Directory tree (relative to workspace root) that must exist before seeding. */
export const WORKSPACE_DIRS = [
  "marketing",
  "sales",
  "operations",
  "research",
  "shared",
  ".cofounder",
  ".cofounder/learnings",
];

export interface Connector {
  id: string;
  name: string;
  why: string;
  builtin: boolean;
  catalog_id?: string | null;
}
export interface ConnectorsFile {
  roles: Record<string, Connector[]>;
  notes?: string[];
}

export const CONNECTORS: ConnectorsFile = JSON.parse(connectorsJson);
