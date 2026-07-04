/**
 * Library tab — agent/skill management, MCP connector management, and a
 * memory provider summary. Rebuilt from a read-only skills list into full
 * management UI: SkillsSection (list/toggle/edit/create — see
 * views/library/SkillsSection.tsx) and ConnectorsSection (MCP servers +
 * Hermes catalog install/remove/test — see views/library/ConnectorsSection.tsx).
 * Memory stays a read-only summary (GET /api/memory) as before; no write
 * endpoints were in scope here.
 */

import { useEffect, useState } from "react";
import { hermesRest } from "@/lib/hermes";
import SkillsSection from "@/views/library/SkillsSection";
import ConnectorsSection from "@/views/library/ConnectorsSection";
import SettingsSection from "@/views/settings/SettingsSection";

interface MemoryProvider {
  name: string;
  description?: string;
  configured?: boolean;
}
interface MemoryResult {
  active?: string;
  providers?: MemoryProvider[];
}

export default function LibraryTab() {
  const [memory, setMemory] = useState<MemoryResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mem = await hermesRest.memory<MemoryResult>();
        if (!cancelled) setMemory(mem);
      } catch {
        // Memory is optional — resolve to a definite empty state so the
        // "Loading memory…" placeholder doesn't hang.
        if (!cancelled) setMemory({ active: "", providers: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4">
      <SkillsSection />

      <div className="mt-7">
        <ConnectorsSection />
      </div>

      <section className="mt-7">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
          Memory
        </h2>
        {memory == null ? (
          <EmptyRow text="Loading memory…" />
        ) : (
          <div className="rounded-xl border border-[#222327] bg-[#141518] p-3.5">
            <div className="mb-2 text-[12px] text-[#c7c7cd]">
              Active provider:{" "}
              <span className="text-[#e8c37a]">
                {memory.active || "none configured"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(memory.providers ?? []).map((p) => (
                <span
                  key={p.name}
                  title={p.description}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                    p.configured
                      ? "border-[#243027] bg-[#16211a] text-[#8fd0a5]"
                      : "border-[#2c2d33] bg-[#181a1e] text-[#8a8a92]"
                  }`}
                >
                  {p.name}
                  {p.configured ? " ·on" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="mt-7">
        <SettingsSection />
      </div>

      <div className="h-4" />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-4 text-center text-[12.5px] text-[#6a6a72]">
      {text}
    </div>
  );
}
