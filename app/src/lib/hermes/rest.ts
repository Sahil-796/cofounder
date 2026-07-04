/**
 * REST client for the Hermes FastAPI backend (hermes_cli/web_server.py).
 *
 * Loopback (127.0.0.1) requires NO auth token (see should_require_auth in
 * web_server.py). Base URL is configurable; default matches `hermes serve
 * --port 9119`.
 */

import type { StatusResult } from "./types";
import { resolveSessionToken } from "./auth";
import { hermesFetch, restBaseUrl } from "./base";

/** Runtime-resolved default (direct loopback, or the Vite proxy in dev). */
export const DEFAULT_BASE_URL =
  typeof window !== "undefined" ? restBaseUrl() : "http://127.0.0.1:9119";

export interface RestClientOptions {
  baseUrl?: string;
  /** Per-request timeout in ms. Default 15s. */
  timeoutMs?: number;
}

export class HermesRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "HermesRestError";
  }
}

export class HermesRest {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: RestClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async fetch<T>(
    path: string,
    init: RequestInit = {},
    parse: "json" | "text" = "json",
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // Loopback still gates /api/* on the session token (verified empirically:
    // /api/skills, /api/profiles, /api/memory return 401 without it even on
    // 127.0.0.1). We reuse the same token scraper the WS client uses.
    let token = "";
    try {
      token = await resolveSessionToken(this.baseUrl);
    } catch {
      /* proceed tokenless — request may 401, surfaced as HermesRestError */
    }
    let res: Response;
    try {
      res = await hermesFetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HermesRestError(
        `${init.method ?? "GET"} ${path} → ${res.status}`,
        res.status,
        body,
      );
    }
    return (parse === "text" ? await res.text() : await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.fetch<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.fetch<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // ── Typed endpoint helpers (subset from PLAN.md §0) ────────────────────────

  /** GET /api/status — machine-level liveness probe (loopback = no auth). */
  status(): Promise<StatusResult> {
    return this.get<StatusResult>("/api/status");
  }

  /** True if the backend answered /api/status at all (any 2xx). */
  async reachable(): Promise<boolean> {
    try {
      await this.status();
      return true;
    } catch {
      return false;
    }
  }

  /** GET /api/profiles */
  profiles<T = unknown>(): Promise<T> {
    return this.get<T>("/api/profiles");
  }

  /** GET /api/sessions */
  sessions<T = unknown>(): Promise<T> {
    return this.get<T>("/api/sessions");
  }

  /** GET /api/sessions/{id}/messages */
  sessionMessages<T = unknown>(id: string): Promise<T> {
    return this.get<T>(`/api/sessions/${encodeURIComponent(id)}/messages`);
  }

  /** GET /api/skills — optionally scoped to a named profile. */
  skills<T = unknown>(profile?: string): Promise<T> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return this.get<T>(`/api/skills${q}`);
  }

  /** GET /api/memory */
  memory<T = unknown>(): Promise<T> {
    return this.get<T>("/api/memory");
  }

  /** GET /api/fs/list?path=... */
  fsList<T = unknown>(path: string): Promise<T> {
    return this.get<T>(`/api/fs/list?path=${encodeURIComponent(path)}`);
  }

  /** GET /api/fs/read-text?path=... */
  fsReadText<T = unknown>(path: string): Promise<T> {
    return this.get<T>(`/api/fs/read-text?path=${encodeURIComponent(path)}`);
  }

  /** POST /api/fs/write-text — parent dir MUST already exist (400 otherwise). */
  fsWriteText<T = unknown>(path: string, content: string): Promise<T> {
    return this.post<T>("/api/fs/write-text", { path, content });
  }

  /**
   * POST /api/files/mkdir { path } — recursive mkdir (parents=True). This
   * endpoint (web_server.py:1802) was found after core/bootstrap.md was written;
   * it accepts absolute paths with no locked root, so the workspace can be
   * created over pure REST — no Tauri fs command required. Idempotent
   * (exist_ok=True).
   */
  filesMkdir<T = unknown>(path: string): Promise<T> {
    return this.post<T>("/api/files/mkdir", { path });
  }

  // ── Bootstrap endpoints (see core/bootstrap.md) ────────────────────────────

  /** POST /api/profiles { name } — creates a profile, seeds bundled skills. */
  createProfile<T = unknown>(name: string): Promise<T> {
    return this.post<T>("/api/profiles", { name });
  }

  /** GET /api/profiles/{name}/soul */
  getSoul<T = unknown>(profile: string): Promise<T> {
    return this.get<T>(`/api/profiles/${encodeURIComponent(profile)}/soul`);
  }

  /** PUT /api/profiles/{name}/soul { content } — full overwrite. */
  putSoul<T = unknown>(profile: string, content: string): Promise<T> {
    return this.put<T>(
      `/api/profiles/${encodeURIComponent(profile)}/soul`,
      { content },
    );
  }

  /** PUT /api/profiles/{name}/description { description } */
  putDescription<T = unknown>(profile: string, description: string): Promise<T> {
    return this.put<T>(
      `/api/profiles/${encodeURIComponent(profile)}/description`,
      { description },
    );
  }

  /** GET /api/skills/content?name=&profile= — 404 if the skill is absent. */
  getSkillContent<T = unknown>(name: string, profile: string): Promise<T> {
    return this.get<T>(
      `/api/skills/content?name=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}`,
    );
  }

  /** POST /api/skills { name, content, category, profile } */
  createSkill<T = unknown>(body: {
    name: string;
    content: string;
    category?: string;
    profile?: string;
  }): Promise<T> {
    return this.post<T>("/api/skills", body);
  }

  /** GET /api/mcp/catalog — pre-approved MCP manifests (may 404 on some builds). */
  mcpCatalog<T = unknown>(): Promise<T> {
    return this.get<T>("/api/mcp/catalog");
  }

  // ── Skills management (Library tab) ────────────────────────────────────────

  /** GET /api/skills/content?name=&profile= — raw SKILL.md text for editing. */
  skillContent<T = unknown>(name: string, profile?: string): Promise<T> {
    const q = profile ? `&profile=${encodeURIComponent(profile)}` : "";
    return this.get<T>(`/api/skills/content?name=${encodeURIComponent(name)}${q}`);
  }

  /** PUT /api/skills/content { name, content, profile } — full-rewrite an existing skill. */
  updateSkillContent<T = unknown>(body: {
    name: string;
    content: string;
    profile?: string;
  }): Promise<T> {
    return this.put<T>("/api/skills/content", body);
  }

  /** PUT /api/skills/toggle { name, enabled, profile } */
  toggleSkill<T = unknown>(body: {
    name: string;
    enabled: boolean;
    profile?: string;
  }): Promise<T> {
    return this.put<T>("/api/skills/toggle", body);
  }

  // ── MCP connectors (Library tab) ────────────────────────────────────────────

  /** GET /api/mcp/servers?profile= — configured MCP servers for a profile. */
  mcpServers<T = unknown>(profile?: string): Promise<T> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return this.get<T>(`/api/mcp/servers${q}`);
  }

  /** POST /api/mcp/servers { name, url?, command?, args?, env?, auth?, profile? } */
  addMcpServer<T = unknown>(body: {
    name: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    auth?: string;
    profile?: string;
  }): Promise<T> {
    return this.post<T>("/api/mcp/servers", body);
  }

  /** DELETE /api/mcp/servers/{name}?profile= */
  removeMcpServer<T = unknown>(name: string, profile?: string): Promise<T> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return this.fetch<T>(`/api/mcp/servers/${encodeURIComponent(name)}${q}`, {
      method: "DELETE",
    });
  }

  /** POST /api/mcp/servers/{name}/test?profile= — connect + list tools, then disconnect. */
  testMcpServer<T = unknown>(name: string, profile?: string): Promise<T> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return this.post<T>(`/api/mcp/servers/${encodeURIComponent(name)}/test${q}`);
  }

  /** PUT /api/mcp/servers/{name}/enabled { enabled, profile? } */
  setMcpServerEnabled<T = unknown>(
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<T> {
    return this.put<T>(`/api/mcp/servers/${encodeURIComponent(name)}/enabled`, {
      enabled,
      profile,
    });
  }

  /** POST /api/mcp/catalog/install { name, env?, enable?, profile? } */
  installMcpCatalogEntry<T = unknown>(body: {
    name: string;
    env?: Record<string, string>;
    enable?: boolean;
    profile?: string;
  }): Promise<T> {
    return this.post<T>("/api/mcp/catalog/install", body);
  }

  /**
   * PUT /api/profiles/{name}/model { provider, model } — persist the profile's
   * default model (config.yaml). Both fields required (400 otherwise). Used to
   * make an in-app model choice stick across restarts.
   */
  setProfileModel<T = unknown>(
    profile: string,
    provider: string,
    model: string,
  ): Promise<T> {
    return this.put<T>(
      `/api/profiles/${encodeURIComponent(profile)}/model`,
      { provider, model },
    );
  }
}

export const hermesRest = new HermesRest();
