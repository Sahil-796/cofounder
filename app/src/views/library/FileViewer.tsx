/**
 * Renders an opened workspace file by extension: markdown gets the sanitized
 * `.md` rendering (with a raw/rendered toggle), csv/tsv get a scrollable
 * table (parsed with `parseDelimited`, capped at MAX_ROWS with a note), json
 * gets pretty-printed monospace, everything else falls back to the plain
 * `<pre>` the workspace browser used before. Loading/error states are the
 * caller's responsibility (CompanyTab); this component only renders content.
 */

import { useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { parseDelimited } from "./csv";

const MAX_ROWS = 500;

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export default function FileViewer({ path, content }: { path: string; content: string }) {
  const ext = extOf(path);
  if (ext === "md" || ext === "markdown") return <MarkdownView content={content} />;
  if (ext === "csv") return <DelimitedView content={content} delimiter="," />;
  if (ext === "tsv") return <DelimitedView content={content} delimiter={"\t"} />;
  if (ext === "json") return <JsonView content={content} />;
  return (
    <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-[#cfcfd4]">
      {content || "(empty)"}
    </pre>
  );
}

function MarkdownView({ content }: { content: string }) {
  const [raw, setRaw] = useState(false);
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToggle raw={raw} onChange={setRaw} renderedLabel="Rendered" />
      {raw ? (
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-[#cfcfd4]">
          {content || "(empty)"}
        </pre>
      ) : content ? (
        <div
          className="md flex-1 overflow-auto p-3 text-[13px] text-[#d0d0d5]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="flex-1 p-3 text-[12px] text-[#6a6a72]">(empty)</div>
      )}
    </div>
  );
}

function DelimitedView({ content, delimiter }: { content: string; delimiter: "," | "\t" }) {
  const [raw, setRaw] = useState(false);
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const shown = body.slice(0, MAX_ROWS);
  const truncated = body.length > MAX_ROWS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToggle raw={raw} onChange={setRaw} renderedLabel="Table" />
      {raw ? (
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-[#cfcfd4]">
          {content || "(empty)"}
        </pre>
      ) : rows.length === 0 ? (
        <div className="flex-1 p-3 text-[12px] text-[#6a6a72]">(empty)</div>
      ) : (
        <div className="flex-1 overflow-auto p-2">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th
                    key={i}
                    className="sticky top-0 border-b border-[#2a2b30] bg-[#141518] px-2 py-1.5 text-left font-medium text-[#a7a7ae]"
                  >
                    {h || `col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, ri) => (
                <tr key={ri} className="border-b border-[#1c1d20] hover:bg-[#17181b]">
                  {header.map((_, ci) => (
                    <td key={ci} className="whitespace-pre-wrap px-2 py-1 text-[#cfcfd4]">
                      {r[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && (
            <div className="px-2 py-2 text-[11px] text-[#6a6a72]">
              Showing first {MAX_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JsonView({ content }: { content: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return null;
    }
  }, [content]);
  return (
    <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed text-[#cfcfd4]">
      {pretty ?? (content || "(empty)")}
    </pre>
  );
}

function ViewToggle({
  raw,
  onChange,
  renderedLabel,
}: {
  raw: boolean;
  onChange: (raw: boolean) => void;
  renderedLabel: string;
}) {
  return (
    <div className="flex gap-1 border-b border-[#222327] px-2 py-1.5">
      {[
        { key: false, label: renderedLabel },
        { key: true, label: "Raw" },
      ].map((opt) => (
        <button
          key={String(opt.key)}
          onClick={() => onChange(opt.key)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
            raw === opt.key
              ? "bg-[#26272c] text-[#e7e7ea]"
              : "text-[#8a8a92] hover:text-[#c7c7cd]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
