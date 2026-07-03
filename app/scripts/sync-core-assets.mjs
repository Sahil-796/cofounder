/**
 * Sync Cofounder domain assets from the repo-level `core/` (source of truth,
 * owned by Task B) into `app/src/assets/cofounder/` so they can be imported by
 * the bundler via `?raw`. Run automatically before `dev`/`build` (see
 * package.json "predev"/"prebuild"). Keep `core/` authoritative — never edit
 * the copies under src/assets directly.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const coreRoot = resolve(appRoot, "..", "core");
const dest = resolve(appRoot, "src", "assets", "cofounder");

const files = [
  "orchestrator/SOUL.md",
  "connectors.json",
  "skills/marketing/SKILL.md",
  "skills/research/SKILL.md",
  "skills/support/SKILL.md",
  "skills/operations/SKILL.md",
  "skills/finance/SKILL.md",
  "workspace-template/marketing/README.md",
  "workspace-template/sales/README.md",
  "workspace-template/operations/README.md",
  "workspace-template/research/README.md",
  "workspace-template/shared/README.md",
  "workspace-template/.cofounder/decisions.md",
  "workspace-template/.cofounder/learnings/README.md",
];

await rm(dest, { recursive: true, force: true });
for (const rel of files) {
  const from = resolve(coreRoot, rel);
  const to = resolve(dest, rel);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
}
console.log(`[sync-core-assets] copied ${files.length} files → src/assets/cofounder/`);
