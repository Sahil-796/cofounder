/**
 * Library tab — skills list (GET /api/skills, cofounder-category first) and a
 * memory provider summary (GET /api/memory). Falls back to the default profile
 * if the cofounder profile isn't set up yet.
 */

import { useEffect, useState } from "react";
import { hermesRest } from "@/lib/hermes";
import { COFOUNDER_PROFILE } from "@/lib/cofounder/bootstrap";

interface Skill {
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
}
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
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [memory, setMemory] = useState<MemoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<string>(COFOUNDER_PROFILE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Prefer the cofounder profile; fall back to default (no param).
      let list: Skill[] | null = null;
      let usedScope = COFOUNDER_PROFILE;
      try {
        list = await hermesRest.skills<Skill[]>(COFOUNDER_PROFILE);
      } catch {
        try {
          list = await hermesRest.skills<Skill[]>();
          usedScope = "default";
        } catch (err) {
          if (!cancelled) setError(String(err));
        }
      }
      // Always leave a DEFINITE state — never leave `skills` null on failure
      // (the render shows the skeleton while null, which would otherwise spin
      // forever). On total failure `list` is [] and `error` drives the message.
      if (!cancelled) {
        setSkills(list ?? []);
        setScope(usedScope);
      }
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

  // Cofounder-category skills first, then the rest by category.
  const sorted = (skills ?? []).slice().sort((a, b) => {
    const ac = a.category === "cofounder" ? 0 : 1;
    const bc = b.category === "cofounder" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name);
  });

  return (
    <div className="h-full overflow-y-auto p-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
            Skills
          </h2>
          <span className="text-[10.5px] text-[#5f5f67]">
            {scope === "default" ? "default profile" : "cofounder profile"}
          </span>
        </div>

        {skills == null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-[#17181b]" />
            ))}
          </div>
        ) : error ? (
          <EmptyRow text="Couldn't load skills." />
        ) : sorted.length === 0 ? (
          <EmptyRow text="No skills installed yet." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sorted.map((s) => (
              <li
                key={`${s.category}/${s.name}`}
                className={`rounded-lg border px-3 py-2.5 ${
                  s.category === "cofounder"
                    ? "border-[#33341f] bg-[#1a1b12]"
                    : "border-[#222327] bg-[#141518]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.category === "cofounder" && <span>🌻</span>}
                  <span className="text-[13px] font-medium text-[#e2e2e6]">{s.name}</span>
                  {s.category && (
                    <span className="rounded-full bg-[#202127] px-1.5 py-0.5 text-[10px] text-[#8a8a92]">
                      {s.category}
                    </span>
                  )}
                  <span
                    className={`ml-auto text-[10px] ${
                      s.enabled === false ? "text-[#6a6a72]" : "text-[#8fd0a5]"
                    }`}
                  >
                    {s.enabled === false ? "off" : "on"}
                  </span>
                </div>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[#8a8a92]">
                    {s.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
