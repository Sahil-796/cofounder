/**
 * Company tab — workspace file browser (REST fs/list + fs/read-text rooted at
 * the onboarding workspace path) and a roles grid with connector suggestions
 * from core/connectors.json.
 */

import { useCallback, useEffect, useState } from "react";
import { hermesRest } from "@/lib/hermes";
import { ROLES } from "@/lib/cofounder/roles";
import { CONNECTORS } from "@/lib/cofounder/assets";
import { joinPath } from "@/lib/cofounder/bootstrap";
import FileViewer from "@/views/library/FileViewer";

interface FsEntry {
  name: string;
  path?: string;
  // The Hermes fs/list endpoint returns `isDirectory` (camelCase); we also
  // accept snake_case variants defensively across builds.
  isDirectory?: boolean;
  is_dir?: boolean;
  is_directory?: boolean;
  type?: string;
  size?: number;
}

function isDir(e: FsEntry): boolean {
  if (typeof e.isDirectory === "boolean") return e.isDirectory;
  if (typeof e.is_dir === "boolean") return e.is_dir;
  if (typeof e.is_directory === "boolean") return e.is_directory;
  return e.type === "dir" || e.type === "directory";
}

export default function CompanyTab({
  workspaceRoot,
  onOpenAgentChat,
  onOpenDepartment,
}: {
  workspaceRoot: string;
  /** Open a role agent's chat directly (used as a fallback if onOpenDepartment isn't given). */
  onOpenAgentChat?: (agentId: string) => void;
  /** Open the department drill-down for a role (preferred — see RightPanel). */
  onOpenDepartment?: (agentId: string) => void;
}) {
  const [view, setView] = useState<"files" | "departments">("files");
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-4 pt-3">
        {(["files", "departments"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full px-3 py-1 text-[12px] capitalize transition ${
              view === v
                ? "bg-[#26272c] text-[#e7e7ea]"
                : "text-[#8a8a92] hover:text-[#c7c7cd]"
            }`}
          >
            {v === "files" ? "Workspace" : "Departments"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {view === "files" ? (
          <WorkspaceBrowser root={workspaceRoot} />
        ) : (
          <DepartmentsGrid onOpenDepartment={onOpenDepartment ?? onOpenAgentChat} />
        )}
      </div>
    </div>
  );
}

export function WorkspaceBrowser({ root }: { root: string }) {
  const [cwd, setCwd] = useState(root);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => setCwd(root), [root]);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setFile(null);
    try {
      const res = await hermesRest.fsList<{ entries?: FsEntry[]; error?: string }>(path);
      if (res.error) {
        setError(
          res.error === "ENOENT"
            ? "Workspace folder doesn't exist yet — finish onboarding to create it."
            : res.error,
        );
        setEntries([]);
      } else {
        setEntries(res.entries ?? []);
      }
    } catch (err) {
      setError(String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cwd);
  }, [cwd, load]);

  const openFile = async (path: string) => {
    setFile({ path, content: "" });
    setFileLoading(true);
    setFileError(null);
    try {
      // NOTE: GET /api/fs/read-text returns the file body under `text`, not
      // `content` (verified against hermes_cli/web_server.py:1887-1895 — the
      // response is {binary, byteSize, language, mimeType, path, text,
      // truncated}). Reading `res.content` here always resolved to undefined,
      // so every opened file (not just .md) silently rendered as empty —
      // this was the root cause of "can't see the md files."
      const res = await hermesRest.fsReadText<{ text?: string; binary?: boolean }>(path);
      if (res.binary) {
        setFileError("Binary file — preview not supported.");
        setFile({ path, content: "" });
        return;
      }
      setFile({ path, content: res.text ?? "" });
    } catch (err) {
      setFileError(String(err));
    } finally {
      setFileLoading(false);
    }
  };

  const atRoot = cwd.replace(/\/+$/, "") === root.replace(/\/+$/, "");

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-[12px] text-[#8a8a92]">
        <button
          disabled={atRoot}
          onClick={() => {
            const parent = cwd.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
            setCwd(parent || "/");
          }}
          className="rounded-md border border-[#2a2b30] px-2 py-0.5 disabled:opacity-30 enabled:hover:border-[#3a3b42]"
        >
          ↑ up
        </button>
        <span className="truncate font-mono text-[11px] text-[#6a6a72]">{cwd}</span>
      </div>

      {file ? (
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[#222327] bg-[#141518]">
          <div className="flex items-center justify-between border-b border-[#222327] px-3 py-2">
            <span className="truncate font-mono text-[11px] text-[#a7a7ae]">
              {file.path.split("/").pop()}
            </span>
            <button
              onClick={() => {
                setFile(null);
                setFileError(null);
              }}
              className="text-[12px] text-[#8a8a92] hover:text-[#e7e7ea]"
            >
              ✕ close
            </button>
          </div>
          {fileLoading ? (
            <div className="flex-1 p-3 text-[12.5px] text-[#6a6a72]">Loading…</div>
          ) : fileError ? (
            <div className="flex-1 p-3 text-[12.5px] text-[#8a8a92]">
              Could not read file: {fileError}
            </div>
          ) : (
            <FileViewer path={file.path} content={file.content} />
          )}
        </div>
      ) : loading ? (
        <div className="text-[12.5px] text-[#6a6a72]">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-6 text-center text-[12.5px] text-[#8a8a92]">
          {error}
        </div>
      ) : entries && entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#242529] px-3.5 py-6 text-center text-[12.5px] text-[#6a6a72]">
          Empty folder
        </div>
      ) : (
        <ul className="flex flex-col overflow-y-auto">
          {(entries ?? [])
            .slice()
            .sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name))
            .map((e) => {
              const path = e.path ?? joinPath(cwd, e.name);
              const dir = isDir(e);
              return (
                <li key={path}>
                  <button
                    onClick={() => (dir ? setCwd(path) : void openFile(path))}
                    className="flex w-full items-center gap-2.5 border-b border-[#1c1d20] px-1 py-2 text-left transition hover:bg-[#17181b]"
                  >
                    <span className="text-sm">{dir ? "📁" : "📄"}</span>
                    <span className="flex-1 truncate text-[13px] text-[#d0d0d5]">
                      {e.name}
                    </span>
                    {!dir && e.size != null && (
                      <span className="text-[10.5px] text-[#5f5f67]">{e.size} B</span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

function DepartmentsGrid({ onOpenDepartment }: { onOpenDepartment?: (agentId: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ROLES.map((r) => {
        const connectors = CONNECTORS.roles[r.id] ?? [];
        // Every department has an overview page (DepartmentView handles the
        // "no agent installed yet" case for roles without a skill).
        const clickable = !!onOpenDepartment;
        return (
          <div
            key={r.id}
            onClick={clickable ? () => onOpenDepartment!(r.id) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenDepartment!(r.id);
                    }
                  }
                : undefined
            }
            className={`rounded-xl border border-[#222327] bg-[#141518] p-3.5 transition ${
              clickable ? "cursor-pointer hover:border-[#33343a] hover:bg-[#181a1e]" : ""
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">{r.emoji}</span>
              <span className="text-[14px] font-medium text-[#e2e2e6]">{r.label}</span>
              {clickable && (
                <span className="text-[11px] text-[#6a6a72]" title={`Open ${r.label} department`}>
                  ›
                </span>
              )}
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${
                  r.skill
                    ? "bg-[#16211a] text-[#8fd0a5]"
                    : "bg-[#1c1d21] text-[#7f7f88]"
                }`}
              >
                {r.skill ? "active" : "soon"}
              </span>
            </div>
            <p className="mb-2.5 text-[12px] leading-relaxed text-[#9a9aa2]">{r.blurb}</p>
            {connectors.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[#6a6a72]">
                  Suggested connectors
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {connectors.slice(0, 5).map((c) => (
                    <span
                      key={c.id}
                      title={c.why}
                      className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                        c.builtin
                          ? "border-[#243027] bg-[#16211a] text-[#8fd0a5]"
                          : "border-[#2c2d33] bg-[#181a1e] text-[#a7a7ae]"
                      }`}
                    >
                      {c.name}
                      {c.builtin ? " ·built-in" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
