/**
 * WebSocket auth token resolution.
 *
 * IMPORTANT (verified against hermes_cli/web_server.py::_ws_auth_reason):
 * the `/api/ws` upgrade ALWAYS requires a credential — even on loopback, where
 * it expects `?token=<_SESSION_TOKEN>`. Only the REST API is truly auth-free on
 * loopback. The dashboard SPA gets this token injected into its served
 * index.html as `window.__HERMES_SESSION_TOKEN__`; our standalone app is not
 * served by hermes, so we fetch hermes's own index.html over loopback REST
 * (no auth) and parse the token out of it.
 *
 * Order of resolution:
 *   1. An explicitly configured token (e.g. injected by the Tauri shell).
 *   2. `window.__HERMES_SESSION_TOKEN__` if the page happens to be hermes-served.
 *   3. Scrape it from `GET <baseUrl>/` (hermes index.html) — the standalone path.
 */

import { DEFAULT_BASE_URL } from "./rest";
import { hermesFetch } from "./base";

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
  }
}

let cached: string | null = null;
let override: string | null = null;

/** Explicitly set the token (e.g. from a Tauri command). Clears any cache. */
export function setSessionToken(token: string | null): void {
  override = token;
  cached = token;
}

const TOKEN_RE = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/;

/**
 * Resolve the WS session token, caching the result. Returns "" if it cannot be
 * found — callers should still attempt the connection (loopback with an empty
 * token simply fails auth, surfacing as a normal connection error).
 */
export async function resolveSessionToken(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<string> {
  if (override) return override;
  if (cached) return cached;

  if (typeof window !== "undefined" && window.__HERMES_SESSION_TOKEN__) {
    cached = window.__HERMES_SESSION_TOKEN__;
    return cached;
  }

  try {
    const res = await hermesFetch(`${baseUrl.replace(/\/+$/, "")}/`, {
      headers: { Accept: "text/html" },
    });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(TOKEN_RE);
      if (m) {
        cached = m[1];
        return cached;
      }
    }
  } catch {
    /* backend down / unreachable — fall through */
  }
  return "";
}

/** Build the authenticated `/api/ws` URL by appending `?token=`. */
export function buildWsUrl(wsUrl: string, token: string): string {
  if (!token) return wsUrl;
  const sep = wsUrl.includes("?") ? "&" : "?";
  return `${wsUrl}${sep}token=${encodeURIComponent(token)}`;
}
