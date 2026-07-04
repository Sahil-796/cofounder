/**
 * Department-scoped scratchpad — reached from DepartmentView's "Scratchpad"
 * row. Browses this department's own workspace subfolder (created at
 * bootstrap, see WORKSPACE_DIRS in lib/cofounder/assets.ts) instead of
 * dropping the user into the full Company workspace browser rooted at the
 * shared workspace root. Not every role has a dedicated subfolder yet (only
 * marketing/sales/operations/research do) — WorkspaceBrowser already renders
 * a friendly "doesn't exist yet" message via the ENOENT path, so a missing
 * folder degrades gracefully instead of erroring.
 */

import { loadConfig } from "@/lib/cofounder/config";
import { joinPath } from "@/lib/cofounder/bootstrap";
import { ROLES } from "@/lib/cofounder/roles";
import { WorkspaceBrowser } from "@/views/tabs/CompanyTab";

export default function DepartmentScratchpadView({
  deptId,
  onBack,
}: {
  deptId: string;
  onBack: () => void;
}) {
  const role = ROLES.find((r) => r.id === deptId);
  const config = loadConfig();
  const root = joinPath(config?.workspaceRoot ?? "", deptId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-[#1f2024] px-4 py-3 text-[11.5px]">
        <button onClick={onBack} className="text-[#8a8a92] transition hover:text-[#c7c7cd]">
          {role?.label ?? deptId}
        </button>
        <span className="text-[#4a4b52]">›</span>
        <span className="text-[#e4e4e8]">Scratchpad</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <WorkspaceBrowser root={root} />
      </div>
    </div>
  );
}
