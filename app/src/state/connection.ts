/**
 * Connection state store: is the backend reachable (REST)? what's the WS state?
 * what does the Tauri sidecar report? A single wire-up (`initConnection`)
 * subscribes to the WS observable, polls REST liveness, and reads sidecar
 * status when running under Tauri.
 */

import { create } from "zustand";
import { hermesRest, hermesWs } from "@/lib/hermes";
import type { WsConnectionState } from "@/lib/hermes";
import { getSidecarStatus, isTauri, type SidecarStatus } from "@/lib/tauri";

interface ConnectionState {
  /** REST /api/status reachable. null = not yet probed. */
  backendReachable: boolean | null;
  wsState: WsConnectionState;
  sidecar: SidecarStatus | null;
  underTauri: boolean;

  setBackendReachable: (v: boolean) => void;
  setWsState: (s: WsConnectionState) => void;
  setSidecar: (s: SidecarStatus | null) => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  backendReachable: null,
  wsState: hermesWs.connectionState,
  sidecar: null,
  underTauri: isTauri(),

  setBackendReachable: (v) => set({ backendReachable: v }),
  setWsState: (s) => set({ wsState: s }),
  setSidecar: (s) => set({ sidecar: s }),
}));

let started = false;

/**
 * Wire the store to live sources. Safe to call once at app mount. Opens the WS
 * (auto-reconnecting) and starts a lightweight REST liveness poll.
 */
export function initConnection(): () => void {
  if (started) return () => {};
  started = true;
  const { setBackendReachable, setWsState, setSidecar } =
    useConnection.getState();

  const offState = hermesWs.onState(setWsState);

  let disposed = false;
  const probe = async () => {
    if (disposed) return;
    setBackendReachable(await hermesRest.reachable());
    if (isTauri()) setSidecar(await getSidecarStatus());
  };
  void probe();
  const poll = setInterval(probe, 5_000);

  // Open the WS best-effort; it self-heals via backoff if the backend is down.
  hermesWs.connect().catch(() => {
    /* reconnect loop takes over */
  });

  return () => {
    disposed = true;
    started = false;
    clearInterval(poll);
    offState();
  };
}
