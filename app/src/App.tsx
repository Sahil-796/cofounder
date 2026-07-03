/**
 * App shell + minimal hash routing.
 *   #/        → the real Cofounder UI (org-map canvas + tabbed panel), gated
 *               behind first-run onboarding.
 *   #/debug   → the streaming chat pipe proof (Task A) — kept working.
 *
 * Runs standalone in a plain browser; all Tauri access is runtime-guarded.
 */

import { useEffect, useState } from "react";
import DebugChat from "@/views/DebugChat";
import AppShell from "@/views/AppShell";

function useHashRoute(): string {
  const [route, setRoute] = useState(
    () => window.location.hash.replace(/^#/, "") || "/",
  );
  useEffect(() => {
    const onHash = () =>
      setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  if (route.startsWith("/debug")) return <DebugChat />;
  return <AppShell />;
}
