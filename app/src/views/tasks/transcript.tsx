/**
 * Transcript rendering helpers shared by the task-detail drawer, the live
 * delegation viewer, and the session viewer. Renders a readable thread from
 * either a Hermes ChatMessage[] (session.history / spawn_tree child history) or
 * a live DelegationEntry[] (streamed subagent events): assistant/user text,
 * tool calls as compact chips, thinking as muted lines.
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

/** Render a Hermes ChatMessage[] as a readable thread. */
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
    <div className="flex flex-col gap-3">
      {rows.map((m, i) => {
        const parts = partsFromMessage(m);
        if (!parts.length) return null;
        const isUser = m.role === "user";
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[#5f5f67]">
              {ROLE_LABEL[m.role] ?? m.role}
            </div>
            <PartList parts={parts} accent={isUser ? "#7aa2e8" : "#c7c7cd"} />
          </div>
        );
      })}
    </div>
  );
}

function PartList({ parts, accent }: { parts: Part[]; accent: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((p, i) => {
        if (p.kind === "tool") return <ToolChip key={i} tool={p.tool} preview={p.preview} />;
        if (p.kind === "thinking")
          return (
            <div
              key={i}
              className="whitespace-pre-wrap rounded-md border-l-2 border-[#2a2b30] bg-[#0f1012] px-2 py-1 text-[11px] italic text-[#7a7a82]"
            >
              {p.text}
            </div>
          );
        return (
          <div
            key={i}
            className="whitespace-pre-wrap text-[12.5px] leading-relaxed"
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
      className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md border border-[#26272c] bg-[#17181b] px-2 py-0.5 text-[10.5px] text-[#9a9aa2]"
      title={preview}
    >
      <span className="text-[#7aa2e8]">⚙</span>
      <span className="font-medium text-[#b6b6bc]">{tool ?? "tool"}</span>
      {preview && <span className="truncate text-[#6a6a72]">{preview}</span>}
    </span>
  );
}

/** Render a live DelegationEntry[] stream. */
export function LiveThread({ entries }: { entries: DelegationEntry[] }) {
  if (!entries.length) {
    return (
      <div className="px-1 py-2 text-[12px] text-[#6a6a72]">
        Waiting for output…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((e, i) => {
        if (e.kind === "tool") return <ToolChip key={i} tool={e.tool} preview={e.preview} />;
        if (e.kind === "thinking")
          return (
            <div
              key={i}
              className="whitespace-pre-wrap rounded-md border-l-2 border-[#2a2b30] bg-[#0f1012] px-2 py-1 text-[11px] italic text-[#7a7a82]"
            >
              {e.text}
            </div>
          );
        if (e.kind === "start")
          return (
            <div
              key={i}
              className="text-[9.5px] font-semibold uppercase tracking-wide text-[#5f5f67]"
            >
              Goal · {e.text}
            </div>
          );
        return (
          <div key={i} className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c7c7cd]">
            {e.text}
          </div>
        );
      })}
    </div>
  );
}
