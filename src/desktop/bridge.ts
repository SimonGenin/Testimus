import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  type BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Notification,
  shell,
} from "electron";
import { BRIDGE_CALLS, CHANNEL, type DesktopVersion, type FileFilter, SHELL_CALLS } from "./bridge-types.ts";
import { log } from "./log.ts";

export type Checked = { ok: true; value: unknown } | { ok: false; error: string };

const bad = (error: string): Checked => ({ ok: false, error });
const good = (value: unknown): Checked => ({ ok: true, value });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const control = (s: string) =>
  [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n < 32 && n !== 9 && n !== 10 && n !== 13;
  });

function text(v: unknown, max: number, min = 1): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max && !control(v);
}

function absPath(v: unknown): v is string {
  return text(v, 1024) && !v.includes("\0") && isAbsolute(v) && !/^\\\\[?.]\\/.test(v);
}

export function httpsUrl(v: unknown): string | null {
  if (!text(v, 2048)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

function filters(v: unknown): FileFilter[] | null {
  if (!Array.isArray(v) || v.length > 10) return null;
  const out: FileFilter[] = [];
  for (const f of v) {
    if (!isObj(f) || !text(f.name, 100) || !Array.isArray(f.extensions)) return null;
    if (!f.extensions.length || f.extensions.length > 20) return null;
    if (!f.extensions.every((e) => typeof e === "string" && /^(\*|[A-Za-z0-9]{1,16})$/.test(e))) return null;
    out.push({ name: f.name, extensions: [...(f.extensions as string[])] });
  }
  return out;
}

export function checkArgs(name: string, args: unknown[]): Checked {
  const [a] = args;
  switch (name) {
    case "version":
    case "details":
    case "restart":
    case "openLogs":
      return good(undefined);
    case "pickFolder":
      if (!isObj(a) || !text(a.title, 200)) return bad("pickFolder needs { title }.");
      if (a.defaultPath !== undefined && !absPath(a.defaultPath))
        return bad("pickFolder: defaultPath must be an absolute path.");
      return good({ title: a.title, defaultPath: a.defaultPath });
    case "pickFiles": {
      if (!isObj(a) || !text(a.title, 200)) return bad("pickFiles needs { title, filters, multiple }.");
      const f = filters(a.filters);
      if (!f) return bad("pickFiles: filters are [{ name, extensions: ['docx', …] }].");
      if (typeof a.multiple !== "boolean") return bad("pickFiles: multiple must be true or false.");
      return good({ title: a.title, filters: f, multiple: a.multiple });
    }
    case "reveal":
      return absPath(a) ? good(resolve(a)) : bad("reveal needs an absolute path.");
    case "openExternal": {
      const url = httpsUrl(a);
      return url ? good(url) : bad("openExternal opens https: links only.");
    }
    case "setProgress":
      if (a === null) return good(null);
      return typeof a === "number" && Number.isFinite(a) && a >= 0 && a <= 1
        ? good(a)
        : bad("setProgress takes a fraction between 0 and 1, or null.");
    case "notify":
      if (!isObj(a) || !text(a.title, 200) || !text(a.body ?? "", 1000, 0)) return bad("notify needs { title, body }.");
      return good({ title: a.title, body: a.body ?? "" });
    default:
      return bad(`Unknown desktop call ${name}.`);
  }
}

export function insideAny(path: string, roots: string[]): boolean {
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const p = norm(path);
  return roots.some((root) => {
    if (!root) return false;
    const rel = relative(norm(root), p);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

export type Role = "bridge" | "shell" | null;

export function senderRole(
  s: { isMain: boolean; isTop: boolean; url: string },
  origin: string | null,
  shellPage: string,
): Role {
  if (!s.isMain || !s.isTop) return null;
  let u: URL;
  try {
    u = new URL(s.url);
  } catch {
    return null;
  }
  if (origin && u.origin === origin) return "bridge";
  if (u.protocol !== "file:") return null;
  u.search = "";
  u.hash = "";
  return u.href.toLowerCase() === new URL(shellPage).href.toLowerCase() ? "shell" : null;
}

export type BridgeDeps = {
  window(): BrowserWindow | null;
  origin(): string | null;
  shellPage: string;
  version: DesktopVersion;
  knownRoots(): Promise<string[]>;
  details(): { message: string; lines: string[]; logDir: string };
  restart(): void;
  openLogs(): void;
};

function roleOf(event: IpcMainEvent | IpcMainInvokeEvent, deps: BridgeDeps): Role {
  const win = deps.window();
  const frame = event.senderFrame;
  return senderRole(
    { isMain: !!win && event.sender === win.webContents, isTop: !!frame && !frame.parent, url: frame?.url ?? "" },
    deps.origin(),
    deps.shellPage,
  );
}

export function registerBridge(deps: BridgeDeps): void {
  ipcMain.on(CHANNEL.hello, (event) => {
    event.returnValue = roleOf(event, deps);
  });
  const handle = (name: string, role: Role, run: (value: unknown, win: BrowserWindow) => unknown) =>
    ipcMain.handle(CHANNEL.call(name), async (event, ...args: unknown[]) => {
      const win = deps.window();
      if (!win || roleOf(event, deps) !== role) throw new Error(`Testimus desktop: ${name} refused for this page.`);
      const checked = checkArgs(name, args);
      if (!checked.ok) {
        log("shell", `bridge ${name} refused: ${checked.error}`);
        throw new Error(checked.error);
      }
      return await run(checked.value, win);
    });

  const calls: Record<(typeof BRIDGE_CALLS)[number], (value: unknown, win: BrowserWindow) => unknown> = {
    version: () => deps.version,
    async pickFolder(v, win) {
      const o = v as { title: string; defaultPath?: string };
      const r = await dialog.showOpenDialog(win, {
        title: o.title,
        defaultPath: o.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async pickFiles(v, win) {
      const o = v as { title: string; filters: FileFilter[]; multiple: boolean };
      const r = await dialog.showOpenDialog(win, {
        title: o.title,
        filters: o.filters,
        properties: o.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      });
      return r.canceled ? [] : r.filePaths;
    },
    async reveal(v) {
      const path = v as string;
      if (!existsSync(path) || !insideAny(path, await deps.knownRoots())) {
        log("shell", `reveal refused: ${path}`);
        return false;
      }
      shell.showItemInFolder(path);
      return true;
    },
    async openExternal(v) {
      await shell.openExternal(v as string);
      return true;
    },
    setProgress(v, win) {
      win.setProgressBar(v === null ? -1 : (v as number));
    },
    notify(v, win) {
      const o = v as { title: string; body: string };
      if (win.isFocused() || !Notification.isSupported()) return false;
      const n = new Notification({ title: o.title, body: o.body });
      n.on("click", () => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      n.show();
      return true;
    },
  };
  for (const name of BRIDGE_CALLS) handle(name, "bridge", calls[name]);

  const shellCalls: Record<(typeof SHELL_CALLS)[number], () => unknown> = {
    details: () => deps.details(),
    restart: () => deps.restart(),
    openLogs: () => deps.openLogs(),
  };
  for (const name of SHELL_CALLS) handle(name, "shell", shellCalls[name]);
}
