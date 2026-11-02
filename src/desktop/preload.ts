import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CHANNEL, type ShellPage, type TestimusDesktop } from "./bridge-types.ts";

const call =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(CHANNEL.call(name), ...args);

const role = ipcRenderer.sendSync(CHANNEL.hello) as "bridge" | "shell" | null;

if (role === "bridge") {
  const listeners = new Set<(dir: string) => void>();
  let pending: string | null = null;
  ipcRenderer.on(CHANNEL.openProject, (_event, dir: unknown) => {
    if (typeof dir !== "string") return;
    if (!listeners.size) pending = dir;
    for (const cb of listeners) cb(dir);
  });
  const desktop: TestimusDesktop = {
    version: call("version") as TestimusDesktop["version"],
    pickFolder: call("pickFolder") as TestimusDesktop["pickFolder"],
    pickFiles: call("pickFiles") as TestimusDesktop["pickFiles"],
    pathOf: (file) => {
      try {
        return file instanceof File ? webUtils.getPathForFile(file) : "";
      } catch {
        return "";
      }
    },
    reveal: call("reveal") as TestimusDesktop["reveal"],
    openExternal: call("openExternal") as TestimusDesktop["openExternal"],
    setProgress: call("setProgress") as TestimusDesktop["setProgress"],
    notify: call("notify") as TestimusDesktop["notify"],
    onOpenProject(cb) {
      if (typeof cb !== "function") return () => {};
      listeners.add(cb);
      if (pending !== null) {
        const dir = pending;
        pending = null;
        cb(dir);
      }
      return () => {
        listeners.delete(cb);
      };
    },
  };
  contextBridge.exposeInMainWorld("testimusDesktop", desktop);
}

if (role === "shell") {
  const page: ShellPage = {
    details: call("details") as ShellPage["details"],
    restart: call("restart") as ShellPage["restart"],
    openLogs: call("openLogs") as ShellPage["openLogs"],
  };
  contextBridge.exposeInMainWorld("testimusShell", page);
}
