/**
 * MCP connector management for the Library tab. Lists configured servers
 * (GET /api/mcp/servers), lets the founder add one from the pre-approved
 * Hermes catalog (GET /api/mcp/catalog, POST /api/mcp/catalog/install — see
 * web_server.py:9129 / :9214) or remove one (DELETE /api/mcp/servers/{name}),
 * and tests a connection (POST /api/mcp/servers/{name}/test — connects,
 * lists tools, disconnects; web_server.py:9062). Cross-references the
 * per-role suggested connectors (CONNECTORS in lib/cofounder/assets.ts) so
 * catalog-backed suggestions that aren't installed yet show an install
 * shortcut inline. As of this Hermes install the catalog only ships
 * linear/n8n/unreal-engine (per connectors.json's notes) — everything else
 * suggested is manual-only (`catalog_id: null`) and shown as "add manually"
 * guidance rather than a broken install button.
 */

import { useEffect, useMemo, useState } from "react";
import { hermesRest } from "@/lib/hermes";
import { CONNECTORS } from "@/lib/cofounder/assets";
import { COFOUNDER_PROFILE } from "@/lib/cofounder/bootstrap";

interface McpServer {
  name: string;
  transport: string;
  url?: string | null;
  command?: string | null;
  args?: string[];
  enabled?: boolean;
}

interface CatalogEntry {
  name: string;
  description?: string;
  transport: string;
  needs_install?: boolean;
  installed?: boolean;
  enabled?: boolean;
  required_env?: { name: string; prompt?: string; required?: boolean }[];
}

export default function ConnectorsSection() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const res = await hermesRest.mcpServers<{ servers?: McpServer[] }>(COFOUNDER_PROFILE);
      setServers(res.servers ?? []);
    } catch (err) {
      setError(String(err));
      setServers([]);
    }
    try {
      const res = await hermesRest.mcpCatalog<{ entries?: CatalogEntry[] }>();
      setCatalog(res.entries ?? []);
    } catch {
      // Catalog may not exist on some builds — degrade to manual-only.
      setCatalog([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const installedNames = new Set((servers ?? []).map((s) => s.name));

  const install = async (name: string) => {
    setBusy(name);
    try {
      await hermesRest.installMcpCatalogEntry({ name, profile: COFOUNDER_PROFILE });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    try {
      await hermesRest.removeMcpServer(name, COFOUNDER_PROFILE);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (name: string) => {
    setBusy(name);
    try {
      const res = await hermesRest.testMcpServer<{
        ok: boolean;
        error?: string;
        tools: { name: string }[];
      }>(name, COFOUNDER_PROFILE);
      setTestResult((cur) => ({
        ...cur,
        [name]: res.ok ? `OK — ${res.tools.length} tool(s)` : `Failed: ${res.error ?? "unknown"}`,
      }));
    } catch (err) {
      setTestResult((cur) => ({ ...cur, [name]: `Failed: ${String(err)}` }));
    } finally {
      setBusy(null);
    }
  };

  // Suggested connectors across all roles that map to a real catalog id and
  // aren't installed yet — these get a one-click install shortcut.
  const suggestedInstallable = useMemo(() => {
    const catalogNames = new Set((catalog ?? []).map((c) => c.name));
    const seen = new Set<string>();
    const out: { id: string; name: string; why: string; catalog_id: string }[] = [];
    for (const list of Object.values(CONNECTORS.roles)) {
      for (const c of list) {
        if (
          c.catalog_id &&
          catalogNames.has(c.catalog_id) &&
          !installedNames.has(c.catalog_id) &&
          !seen.has(c.catalog_id)
        ) {
          seen.add(c.catalog_id);
          out.push({ id: c.id, name: c.name, why: c.why, catalog_id: c.catalog_id });
        }
      }
    }
    return out;
  }, [catalog, servers]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7a82]">
          Connectors
        </h2>
        <span className="text-[10.5px] text-[#5f5f67]">MCP servers</span>
      </div>

      {servers == null ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[#17181b]" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <EmptyRow text="No connectors configured yet." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {servers.map((s) => (
            <li
              key={s.name}
              className="rounded-lg border border-[#222327] bg-[#141518] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#e2e2e6]">{s.name}</span>
                <span className="rounded-full bg-[#202127] px-1.5 py-0.5 text-[10px] text-[#8a8a92]">
                  {s.transport}
                </span>
                <span
                  className={`text-[10px] ${
                    s.enabled === false ? "text-[#6a6a72]" : "text-[#8fd0a5]"
                  }`}
                >
                  {s.enabled === false ? "off" : "on"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    disabled={busy === s.name}
                    onClick={() => void test(s.name)}
                    className="text-[11px] text-[#8a8a92] hover:text-[#e7e7ea] disabled:opacity-40"
                  >
                    test
                  </button>
                  <button
                    disabled={busy === s.name}
                    onClick={() => void remove(s.name)}
                    className="text-[11px] text-[#d98a8a] hover:text-[#e7a7a7] disabled:opacity-40"
                  >
                    remove
                  </button>
                </div>
              </div>
              {(s.url || s.command) && (
                <p className="mt-1 truncate font-mono text-[11px] text-[#6a6a72]">
                  {s.url ?? `${s.command} ${(s.args ?? []).join(" ")}`}
                </p>
              )}
              {testResult[s.name] && (
                <p className="mt-1 text-[11px] text-[#a7a7ae]">{testResult[s.name]}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-[11px] text-[#d98a8a]">{error}</p>}

      {suggestedInstallable.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[#6a6a72]">
            Suggested from the catalog
          </div>
          <div className="flex flex-col gap-1.5">
            {suggestedInstallable.map((c) => (
              <div
                key={c.catalog_id}
                className="flex items-center gap-2 rounded-lg border border-[#2c2d33] bg-[#181a1e] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-[#d0d0d5]">{c.name}</div>
                  <div className="truncate text-[11px] text-[#7f7f88]">{c.why}</div>
                </div>
                <button
                  disabled={busy === c.catalog_id}
                  onClick={() => void install(c.catalog_id)}
                  className="rounded-full bg-[#26272c] px-2.5 py-0.5 text-[11px] text-[#e7e7ea] disabled:opacity-40"
                >
                  {busy === c.catalog_id ? "Installing…" : "Install"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {catalog && catalog.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-[#6a6a72] hover:text-[#8a8a92]">
            Browse full catalog ({catalog.length})
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {catalog.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-2 rounded-lg border border-[#222327] bg-[#141518] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-[#d0d0d5]">{entry.name}</div>
                  {entry.description && (
                    <div className="truncate text-[11px] text-[#7f7f88]">
                      {entry.description}
                    </div>
                  )}
                </div>
                {entry.installed ? (
                  <span className="text-[10.5px] text-[#8fd0a5]">installed</span>
                ) : (entry.required_env ?? []).some((e) => e.required) ? (
                  <span
                    className="text-[10.5px] text-[#6a6a72]"
                    title="Requires credentials — add manually via a server entry with env vars."
                  >
                    needs setup
                  </span>
                ) : (
                  <button
                    disabled={busy === entry.name}
                    onClick={() => void install(entry.name)}
                    className="rounded-full bg-[#26272c] px-2.5 py-0.5 text-[11px] text-[#e7e7ea] disabled:opacity-40"
                  >
                    {busy === entry.name ? "Installing…" : "Install"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <ManualAddForm onAdded={load} />
    </section>
  );
}

function ManualAddForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || (!url.trim() && !command.trim())) {
      setError("Name and either a URL or a command are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await hermesRest.addMcpServer({
        name: name.trim(),
        url: url.trim() || undefined,
        command: command.trim() || undefined,
        profile: COFOUNDER_PROFILE,
      });
      setName("");
      setUrl("");
      setCommand("");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 rounded-full border border-[#2a2b30] px-2.5 py-0.5 text-[11px] text-[#c7c7cd] hover:border-[#3a3b42] hover:text-[#e7e7ea]"
      >
        + Add connector manually
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[#2a2b30] bg-[#141518] p-3">
      <div className="mb-2 flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          className="rounded-md border border-[#2a2b30] bg-[#101113] px-2 py-1 text-[12.5px] text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL (HTTP/SSE server) — or leave blank and use a command below"
          className="rounded-md border border-[#2a2b30] bg-[#101113] px-2 py-1 text-[12.5px] text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Command (stdio server) — e.g. npx some-mcp-server"
          className="rounded-md border border-[#2a2b30] bg-[#101113] px-2 py-1 text-[12.5px] text-[#e7e7ea] outline-none focus:border-[#3a3b42]"
        />
      </div>
      {error && <div className="mb-1.5 text-[11px] text-[#d98a8a]">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-full px-3 py-1 text-[11.5px] text-[#8a8a92] hover:text-[#e7e7ea]"
        >
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={() => void submit()}
          className="rounded-full bg-[#26272c] px-3 py-1 text-[11.5px] text-[#e7e7ea] disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
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
