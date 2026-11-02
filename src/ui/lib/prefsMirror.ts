import { call } from "../api.ts";
import { desktop } from "./desktop.ts";

const OURS = /^testimus\./;

const snapshot = (): Record<string, string> => {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && OURS.test(k)) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch {}
  return out;
};

// ponytail: in the desktop app the page's origin follows the core's port — when that port had to change, the new
// origin starts with an empty localStorage; the copy kept in settings.json is put back (Xray Editor keeps these
// preferences in its settings file). True when something was put back, so the caller reloads once.
export async function restorePrefs(): Promise<boolean> {
  if (!desktop() || Object.keys(snapshot()).length) return false;
  const s = await call<{ ui?: Record<string, string> }>("system.settings", {}).catch(() => null);
  const saved = Object.entries(s?.ui ?? {}).filter(([k]) => OURS.test(k));
  if (!saved.length) return false;
  try {
    for (const [k, v] of saved) localStorage.setItem(k, v);
  } catch {
    return false;
  }
  return true;
}

// ponytail: and every change is copied there, a few seconds later or when the window hides
export function mirrorPrefs(everyMs = 5000): () => void {
  if (!desktop()) return () => {};
  let sent = JSON.stringify(snapshot());
  const push = () => {
    const now = snapshot();
    const json = JSON.stringify(now);
    if (json === sent) return;
    sent = json;
    void call("system.saveSettings", { ui: now }).catch(() => {});
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
