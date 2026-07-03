/**
 * Runtime-guarded bridge to the Tauri shell. Every export is safe to call in a
 * plain browser (npm run dev) — it detects the absence of the Tauri runtime and
 * degrades gracefully, so the UI agent + verifier can work without the Rust
 * shell.
 */

export interface SidecarStatus {
  running: boolean;
  spawned_by_us: boolean;
  port: number;
}

/** True only inside the Tauri webview. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 injects these globals into the webview.
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Invoke the `sidecar_status` command, or null when not running under Tauri. */
export async function getSidecarStatus(): Promise<SidecarStatus | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SidecarStatus>("sidecar_status");
  } catch {
    return null;
  }
}
