/**
 * Skills (agents) management for the Library tab. Lists skills scoped to the
 * cofounder profile (GET /api/skills?profile=cofounder — falls back to the
 * default profile if that one 404s, matching the previous LibraryTab
 * behavior), with enable/disable (PUT /api/skills/toggle), a content editor
 * (GET/PUT /api/skills/content) and a "New skill" composer (POST /api/skills).
 * All mutations refetch the list afterward rather than mutating local state
 * optimistically — skills content can be sizeable so we don't want to guess
 * at server-side validation results (name/category rules, size limits).
 */

import { useEffect, useState } from "react";
import { hermesRest } from "@/lib/hermes";
import { COFOUNDER_PROFILE } from "@/lib/cofounder/bootstrap";

export interface Skill {
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
}

export default function SkillsSection() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [scope, setScope] = useState<string>(COFOUNDER_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    let list: Skill[] | null = null;
    let usedScope = COFOUNDER_PROFILE;
    try {
      list = await hermesRest.skills<Skill[]>(COFOUNDER_PROFILE);
    } catch {
      try {
        list = await hermesRest.skills<Skill[]>();
        usedScope = "default";
      } catch (err) {
        setError(String(err));
      }
    }
    setSkills(list ?? []);
    setScope(usedScope);
    if (list) setError(null);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (s: Skill) => {
    setBusy(s.name);
    try {
      await hermesRest.toggleSkill({
        name: s.name,
        enabled: s.enabled === false,
        profile: scope === "default" ? undefined : scope,
      });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const sorted = (skills ?? []).slice().sort((a, b) => {
    const ac = a.category === "cofounder" ? 0 : 1;
    const bc = b.category === "cofounder" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name);
  });

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
          Skills
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-[#5f5f67]">
            {scope === "default" ? "default profile" : "cofounder profile"}
          </span>
          <button
            onClick={() => setCreating(true)}
            className="rounded-full border border-[#2a2b30] px-2.5 py-0.5 text-[11px] text-[#c7c7cd] hover:border-[#3a3b42] hover:text-[#e7e7ea]"
          >
            + New skill
          </button>
        </div>
      </div>

      {creating && (
        <SkillCreateForm
          profile={scope === "default" ? undefined : scope}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {skills == null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[#17181b]" />
          ))}
        </div>
      ) : error && sorted.length === 0 ? (
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
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() =>
                      setEditing((cur) => (cur === s.name ? null : s.name))
                    }
                    className="text-[11px] text-[#8a8a92] hover:text-[#e7e7ea]"
                  >
                    {editing === s.name ? "close" : "edit"}
                  </button>
                  <button
                    disabled={busy === s.name}
                    onClick={() => void toggle(s)}
                    className={`rounded-full px-2 py-0.5 text-[10px] transition disabled:opacity-40 ${
                      s.enabled === false
                        ? "bg-[#1c1d21] text-[#7f7f88] hover:text-[#c7c7cd]"
                        : "bg-[#16211a] text-[#8fd0a5] hover:brightness-110"
                    }`}
                  >
                    {busy === s.name ? "…" : s.enabled === false ? "off" : "on"}
                  </button>
                </div>
              </div>
              {s.description && (
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[#8a8a92]">
                  {s.description}
                </p>
              )}
              {editing === s.name && (
                <SkillEditor
                  name={s.name}
                  profile={scope === "default" ? undefined : scope}
                  onSaved={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkillEditor({
  name,
  profile,
  onSaved,
}: {
  name: string;
  profile?: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hermesRest.skillContent<{ content?: string }>(name, profile);
        if (!cancelled) setContent(res.content ?? "");
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, profile]);

  const save = async () => {
    if (content == null) return;
    setSaving(true);
    setError(null);
    try {
      await hermesRest.updateSkillContent({ name, content, profile });
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2.5 rounded-lg border border-[#222327] bg-[#101113] p-2.5">
      {content == null ? (
        <div className="text-[11.5px] text-[#6a6a72]">
          {error ? `Couldn't load content: ${error}` : "Loading content…"}
        </div>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-[#2a2b30] bg-[#141518] p-2 font-mono text-[12px] leading-relaxed text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
          />
          {error && <div className="mt-1.5 text-[11px] text-[#d98a8a]">{error}</div>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              disabled={saving}
              onClick={() => void save()}
              className="rounded-full bg-[#26272c] px-3 py-1 text-[11.5px] text-[#e7e7ea] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SkillCreateForm({
  profile,
  onDone,
  onCancel,
}: {
  profile?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("---\nname: \ndescription: \n---\n\n");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await hermesRest.createSkill({
        name: name.trim(),
        content,
        category: "cofounder",
        profile: profile ?? "cofounder",
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-[#2a2b30] bg-[#141518] p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="skill-name"
          className="flex-1 rounded-md border border-[#2a2b30] bg-[#101113] px-2 py-1 text-[12.5px] text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder="SKILL.md content (frontmatter + markdown)…"
        className="w-full resize-y rounded-md border border-[#2a2b30] bg-[#101113] p-2 font-mono text-[12px] leading-relaxed text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
      />
      {error && <div className="mt-1.5 text-[11px] text-[#d98a8a]">{error}</div>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1 text-[11.5px] text-[#8a8a92] hover:text-[#e7e7ea]"
        >
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={() => void create()}
          className="rounded-full bg-[#26272c] px-3 py-1 text-[11.5px] text-[#e7e7ea] disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
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
