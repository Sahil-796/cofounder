/**
 * Transcript rendering helpers shared by the task-detail drawer and the
 * Activity (delegations) detail view. Renders a readable thread from either a
 * Hermes ChatMessage[] (session.history / spawn_tree child history) or a live
 * DelegationEntry[] (streamed subagent events): assistant/user text, tool
 * calls as compact chips, thinking as muted italic lines.
 *
 * Rendering is speaker-separated (avatar-less "rail" + label) with a capped
 * line length for prose, monospace reserved for tool chips/previews only.
 */

import type { ChatMessage } from "@/lib/hermes";
import type { DelegationEntry } from "@/state/delegations";

/** Flatten a ChatMessage's `content` (string | blocks[]) into display parts. */
interface Part {
  kind: "text" | "tool" | "thinking";
  text?: string;
  tool?: string;
  preview?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const o = b as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

/** Extract renderable parts from one ChatMessage. */
function partsFromMessage(m: ChatMessage): Part[] {
  const parts: Part[] = [];
  const content = m.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        if (typeof block === "string" && block.trim())
          parts.push({ kind: "text", text: block });
        continue;
      }
      const o = block as Record<string, unknown>;
      const type = String(o.type ?? "");
      if (type === "tool_use" || o.tool_use || o.name) {
        parts.push({
          kind: "tool",
          tool: String(o.name ?? "tool"),
          preview:
            typeof o.input === "object" && o.input
              ? shortJson(o.input)
              : undefined,
        });
      } else if (type === "thinking" || type === "reasoning") {
        const t = String(o.text ?? o.thinking ?? "");
        if (t.trim()) parts.push({ kind: "thinking", text: t });
      } else if (typeof o.text === "string" && o.text.trim()) {
        parts.push({ kind: "text", text: o.text });
      }
    }
  } else {
    const t = textOf(content);
    if (t.trim()) parts.push({ kind: "text", text: t });
  }
  return parts;
}

function shortJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return "";
  }
}

const ROLE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "Agent",
  system: "System",
  tool: "Tool",
};

const ROLE_COLOR: Record<string, string> = {
  user: "#7aa2e8",
  assistant: "#c7c7cd",
  system: "#a68ae0",
  tool: "#9a9aa2",
};

/** Render a Hermes ChatMessage[] as a readable, speaker-separated thread. */
export function MessageThread({ messages }: { messages: ChatMessage[] }) {
  const rows = messages.filter((m) => m.role !== "tool");
  if (!rows.length) {
    return (
      <div className="px-1 py-3 text-[12px] text-[#6a6a72]">
        No transcript for this run yet.
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      {rows.map((m, i) => {
        const parts = partsFromMessage(m);
        if (!parts.length) return null;
        const role = m.role ?? "assistant";
        return (
          <ThreadRow
            key={i}
            label={ROLE_LABEL[role] ?? role}
            accent={ROLE_COLOR[role] ?? "#c7c7cd"}
            parts={parts}
          />
        );
      })}
    </div>
  );
}

/** One speaker turn: label rail + content, with a subtle left guide line. */
function ThreadRow({
  label,
  accent,
  parts,
}: {
  label: string;
  accent: string;
  parts: Part[];
}) {
  return (
    <div className="flex gap-3">
      <div
        className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: accent, boxShadow: `0 0 0 3px ${accent}22` }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6a6a72]">
          {label}
        </div>
        <PartList parts={parts} accent={accent} />
      </div>
    </div>
  );
}

function PartList({ parts, accent }: { parts: Part[]; accent: string }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p, i) => {
        if (p.kind === "tool") return <ToolChip key={i} tool={p.tool} preview={p.preview} />;
        if (p.kind === "thinking")
          return (
            <div
              key={i}
              className="whitespace-pre-wrap rounded-md border-l-2 border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[11.5px] italic leading-relaxed text-[#7a7a82]"
            >
              {p.text}
            </div>
          );
        return (
          <div
            key={i}
            className="whitespace-pre-wrap text-[13px] leading-[1.6]"
            style={{ color: accent }}
          >
            {p.text}
          </div>
        );
      })}
    </div>
  );
}

export function ToolChip({ tool, preview }: { tool?: string; preview?: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md border border-[#26272c] bg-[#17181b] px-2 py-1 text-[11px] text-[#9a9aa2]"
      title={preview}
    >
      <span className="text-[#7aa2e8]">⚙</span>
      <span className="font-medium text-[#b6b6bc]">{tool ?? "tool"}</span>
      {preview && (
        <span className="truncate font-mono text-[10px] text-[#6a6a72]">{preview}</span>
      )}
    </span>
  );
}

/** Render a live DelegationEntry[] stream, speaker-separated like MessageThread. */
export function LiveThread({ entries }: { entries: DelegationEntry[] }) {
  if (!entries.length) {
    return (
      <div className="px-1 py-3 text-[12px] text-[#6a6a72]">
        Waiting for output…
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
      {entries.map((e, i) => {
        if (e.kind === "start")
          return (
            <div
              key={i}
              className="rounded-md border border-[#222327] bg-[#141518] px-3 py-2 text-[11px] text-[#9a9aa2]"
            >
              <span className="font-semibold uppercase tracking-wide text-[#6a6a72]">
                Goal
              </span>{" "}
              <span className="text-[#c7c7cd]">{e.text}</span>
            </div>
          );
        if (e.kind === "tool")
          return (
            <div key={i} className="flex gap-3">
              <div className="w-[7px] shrink-0" />
              <ToolChip tool={e.tool} preview={e.preview} />
            </div>
          );
        if (e.kind === "thinking")
          return (
            <div key={i} className="flex gap-3">
              <div className="w-[7px] shrink-0" />
              <div className="whitespace-pre-wrap rounded-md border-l-2 border-[#2a2b30] bg-[#0f1012] px-2.5 py-1.5 text-[11.5px] italic leading-relaxed text-[#7a7a82]">
                {e.text}
              </div>
            </div>
          );
        return (
          <div key={i} className="flex gap-3">
            <div
              className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: "#c7c7cd", boxShadow: "0 0 0 3px #c7c7cd22" }}
            />
            <div className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-[1.6] text-[#c7c7cd]">
              {e.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
