/**
 * The real Cofounder shell: onboarding gate + two-zone layout (canvas org map
 * ~55% left, rounded tabbed panel ~45% right). Decides on mount whether
 * onboarding is needed (no saved config OR no `cofounder` profile on the
 * backend), then renders Onboarding or the workspace.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import CanvasView, { type Artifact } from "./CanvasView";
import RightPanel, { type PanelTab, type DeptNav } from "./RightPanel";
import Onboarding from "./Onboarding";
import { initConnection } from "@/state/connection";
import { loadConfig, type CofounderConfig } from "@/lib/cofounder/config";
import {
  cofounderProfileExists,
  ensureSoulCurrent,
  ensureRoleProfilesCurrent,
} from "@/lib/cofounder/bootstrap";
import { startKanbanDispatchLoop } from "@/lib/cofounder/dispatch";
import { useChat } from "@/state/chat";
import { hermesRest } from "@/lib/hermes";

type Gate = "checking" | "onboarding" | "ready";

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "S";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "P";
  return (a + b).toUpperCase();
}

const PANEL_TABS: PanelTab[] = ["home", "cofounder", "company", "tasks", "library"];

function tabFromHash(): PanelTab {
  const seg = window.location.hash.replace(/^#\/?/, "").split("/")[0] as PanelTab;
  return PANEL_TABS.includes(seg) ? seg : "home";
}

export default function AppShell() {
  const [gate, setGate] = useState<Gate>("checking");
  const [config, setConfig] = useState<CofounderConfig | null>(null);
  const [tab, setTabState] = useState<PanelTab>(tabFromHash);
  const [artifacts, setArtifacts] = useState<Artifact[] | undefined>(undefined);
  // Department drill-down (canvas pill / roles grid → DepartmentView →
  // AgentWorkspaceView), shared between the canvas and the right panel.
  const [dept, setDept] = useState<DeptNav | null>(null);
  const send = useChat((s) => s.send);
  const setActiveAgent = useChat((s) => s.setActiveAgent);

  // Tabs are hash-driven (deep-linkable): #/company, #/tasks, etc. Home lives
  // at #/ so the debug route (#/debug) is unaffected.
  const setTab = useCallback((t: PanelTab) => {
    setTabState(t);
    window.location.hash = t === "home" ? "/" : `/${t}`;
  }, []);
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => initConnection(), []);

  // Decide onboarding vs ready.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadConfig();
      // Config marked bootstrapped → trust it (fast path). Otherwise verify the
      // profile actually exists on the backend before skipping onboarding.
      if (saved?.bootstrapped) {
        if (!cancelled) {
          setConfig(saved);
          setGate("ready");
        }
        return;
      }
      const exists = await cofounderProfileExists();
      if (cancelled) return;
      if (exists && saved) {
        setConfig({ ...saved, bootstrapped: true });
        setGate("ready");
      } else {
        setGate("onboarding");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once ready, make sure the live SOUL carries the configured workspace root
  // (heals installs bootstrapped before the SOUL embedded it), and that every
  // role has its own real Hermes profile (heals installs from before role
  // agents were split off the shared cofounder profile — see bootstrap.ts's
  // ROLE_PROFILE_PREFIX comment for why that split is what makes delegation
  // real). Both are idempotent and best-effort.
  useEffect(() => {
    if (gate !== "ready" || !config?.workspaceRoot) return;
    void ensureSoulCurrent(config.workspaceRoot).catch(() => {});
    void ensureRoleProfilesCurrent(config.workspaceRoot, config.companyName).catch(() => {});
  }, [gate, config?.workspaceRoot, config?.companyName]);

  // The kanban dispatcher doesn't run on its own (see dispatch.ts) — tick it
  // for the lifetime of the app so tasks assigned to a role profile actually
  // get worked, regardless of which tab is open.
  useEffect(() => startKanbanDispatchLoop(), []);

  // Once ready, try to populate canvas artifact cards from the workspace.
  useEffect(() => {
    if (gate !== "ready" || !config) return;
    let cancelled = false;
    (async () => {
      const found: Artifact[] = [];
      for (const role of ["marketing", "research", "support", "operations", "finance"]) {
        try {
          const res = await hermesRest.fsList<{ entries?: { name: string }[] }>(
            `${config.workspaceRoot}/${role}`,
          );
          const files = (res.entries ?? []).filter((e) => /\.(md|csv|json)$/i.test(e.name));
          const pick = files.find((f) => !/^readme/i.test(f.name)) ?? files[0];
          if (pick) {
            found.push({
              label: pick.name,
              role,
              emoji: /\.csv$/i.test(pick.name) ? "📊" : "📄",
            });
          }
        } catch {
          /* folder missing — skip */
        }
      }
      if (!cancelled && found.length) setArtifacts(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [gate, config]);

  const onSendToChat = useCallback(
    (text: string) => {
      setTab("cofounder");
      void send(text);
    },
    [send, setTab],
  );

  // Open a specific agent's real chat: switch to the Cofounder tab and
  // activate that agent's chat slot. Used by the center canvas node directly,
  // and by the department drill-down's "chat" actions.
  const openAgentChat = useCallback(
    (agentId: string) => {
      setActiveAgent(agentId);
      setTab("cofounder");
    },
    [setActiveAgent, setTab],
  );

  // Open a department's overview from the canvas ring or the Company roles grid.
  const openDepartment = useCallback((agentId: string) => {
    setDept({ id: agentId, view: "department" });
  }, []);

  const founderInitials = useMemo(
    () => initials(config?.founderName ?? "Sahil"),
    [config?.founderName],
  );

  if (gate === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e0f11]">
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl">🌻</div>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#33343a] border-t-[#e8c37a]" />
        </div>
      </div>
    );
  }

  if (gate === "onboarding") {
    return (
      <Onboarding
        onDone={(c) => {
          setConfig(c);
          setGate("ready");
        }}
      />
    );
  }

  const cfg = config!;
  return (
    <div className="flex h-screen gap-3 bg-[#0e0f11] p-3">
      <div className="relative min-w-0 flex-[0_0_55%] overflow-hidden rounded-3xl border border-[#1c1d21]">
        <CanvasView
          founderInitials={founderInitials}
          companyName={cfg.companyName || "cofounder"}
          artifacts={artifacts}
          onAdd={() => setTab("cofounder")}
          onOpenAgentChat={openAgentChat}
          onOpenDepartment={openDepartment}
        />
      </div>
      <div className="min-w-0 flex-1">
        <RightPanel
          tab={tab}
          setTab={setTab}
          founderName={cfg.founderName}
          workspaceRoot={cfg.workspaceRoot}
          onSendToChat={onSendToChat}
          onOpenAgentChat={openAgentChat}
          dept={dept}
          setDept={setDept}
        />
      </div>
    </div>
  );
}
