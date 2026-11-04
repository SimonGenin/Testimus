import { useCallback, useEffect, useState } from "react";
import type { Screen } from "../lib/app.ts";

const SCREENS: Screen[] = ["documents", "generate", "tests", "review", "jobs", "settings", "doctor", "setup", "kit"];

export const TITLES: Record<Screen, string> = {
  documents: "Documents",
  generate: "Generate",
  tests: "Tests",
  review: "Review",
  jobs: "Jobs",
  settings: "Settings",
  doctor: "System check",
  setup: "First launch",
  kit: "Kit",
};

export type Route = { screen: Screen; arg?: string };

export function parseRoute(hash: string): Route {
  const [screen, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const s = SCREENS.includes(screen as Screen) ? (screen as Screen) : "tests";
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : undefined;
  return { screen: s, arg };
}

export const hashOf = (screen: Screen, arg?: string) => `#/${screen}${arg ? `/${encodeURIComponent(arg)}` : ""}`;

// ponytail: the route is the page's hash — a link, the back button or a screen's navigate all move it
export function useRoute(): [Route, (screen: Screen, arg?: string) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((screen: Screen, arg?: string) => {
    const hash = hashOf(screen, arg);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute({ screen, arg });
  }, []);
  return [route, navigate];
}
