/**
 * Resolve the Hermes REST + WS base URLs for the current runtime.
 *
 * The problem: from the standalone Vite dev origin (http://localhost:1420) a
 * direct call to http://127.0.0.1:9119 is cross-origin. The token header makes
 * it a "non-simple" request, so the browser sends a CORS *preflight* (OPTIONS)
 * — which the Hermes auth middleware rejects with 401 (the preflight carries no
 * token). Result: "TypeError: Failed to fetch".
 *
 * The fix: when we're running under the Vite dev server (and NOT hermes-served,
 * NOT Tauri), talk to the backend through the Vite proxy at a *same-origin*
 * path (`/hermes-api` → 127.0.0.1:9119, see vite.config.ts). Same origin ⇒ no
 * preflight ⇒ no 401. In the hermes-served dashboard or the Tauri shell we use
 * the direct loopback URLs.
 */

const DIRECT_REST = "http://127.0.0.1:9119";
const DIRECT_WS = "ws://127.0.0.1:9119/api/ws";
const PROXY_PREFIX = "/hermes-api";

function underTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Running inside a page served by hermes itself (token already injected)? */
function hermesServed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { __HERMES_SESSION_TOKEN__?: string }).__HERMES_SESSION_TOKEN__ ===
      "string"
  );
}

/** True when we should route through the Vite same-origin proxy. */
export function useProxy(): boolean {
  if (typeof window === "undefined") return false;
  if (underTauri() || hermesServed()) return false;
  // Any browser dev origin that isn't hermes's own port → use the proxy.
  return true;
}

/** Base URL for REST calls (no trailing slash). */
export function restBaseUrl(): string {
  return useProxy() ? `${window.location.origin}${PROXY_PREFIX}` : DIRECT_REST;
}

/** Full ws:// URL for the JSON-RPC gateway. */
export function wsUrl(): string {
  if (!useProxy()) return DIRECT_WS;
  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}${PROXY_PREFIX}/api/ws`;
}

/**
 * fetch implementation for REST calls. Under Tauri the webview enforces CORS
 * exactly like a browser, and Hermes's auth middleware 401s the unauthenticated
 * OPTIONS preflight triggered by the Authorization header — so direct loopback
 * calls from the webview would fail. The Tauri HTTP plugin performs the request
 * from the Rust side, where CORS does not exist (scope-limited to
 * 127.0.0.1:9119 in capabilities/default.json). WebSocket needs no equivalent:
 * WS upgrades are exempt from CORS and authenticate via `?token=`.
 */
export async function hermesFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (underTauri()) {
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return await tauriFetch(input, init);
    } catch {
      /* plugin unavailable (e.g. built frontend opened in a plain browser) —
         fall through to the native fetch */
    }
  }
  return fetch(input, init);
}
