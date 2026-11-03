import type { QueryClient } from "@tanstack/react-query";
import { execute, read } from "./data/query.ts";
import { desktop } from "./desktop.ts";
import { restorePrefs as putBack, savedPrefs } from "./prefs.ts";

// ponytail: in the desktop app the page's origin follows the core's port — when that port had to change, the new
// origin starts with an empty storage; the copy kept in settings.json is put back (Xray Editor keeps these
// preferences in its settings file). True when something was put back, so the caller reloads once.
export async function restorePrefs(client: QueryClient): Promise<boolean> {
  if (!desktop() || Object.keys(savedPrefs()).length) return false;
  const s = await read(client, "system.settings", {}).catch(() => null);
  const ui = (s as { ui?: Record<string, string> } | null)?.ui ?? {};
  if (!Object.keys(ui).length) return false;
  putBack(ui);
  return Object.keys(savedPrefs()).length > 0;
}

// ponytail: and every change is copied there, a few seconds later or when the window hides
export function mirrorPrefs(client: QueryClient, everyMs = 5000): () => void {
  if (!desktop()) return () => {};
  let sent = JSON.stringify(savedPrefs());
  const push = () => {
    const now = savedPrefs();
    const json = JSON.stringify(now);
    if (json === sent) return;
    sent = json;
    void execute(client, "system.saveSettings", { ui: now }, { invalidates: [["system.settings"]] }).catch(() => {});
  };
  const timer = setInterval(push, everyMs);
  const onHide = () => document.visibilityState === "hidden" && push();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", push);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", push);
  };
}
