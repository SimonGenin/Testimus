import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BrowserWindow, Menu, type Session, shell, type WebContents } from "electron";
import { dataDir, log } from "./log.ts";

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = Rect & { maximized: boolean; zoom: number; port?: number };

export const DEFAULT_SIZE = { width: 1440, height: 960 };
// ponytail: narrow enough to sit beside Jira or the simulator (Xray Editor's 520 × 600); the test list becomes a drawer
export const MIN_SIZE = { width: 520, height: 600 };
const MIN_VISIBLE = { width: 160, height: 80 };
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const stateFile = () => join(dataDir(), "window.json");

export function readState(file = stateFile()): Partial<WindowState> {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const out: Partial<WindowState> = {};
    for (const k of ["x", "y", "width", "height", "zoom", "port"] as const)
      if (typeof v[k] === "number" && Number.isFinite(v[k])) out[k] = v[k] as number;
    if (typeof v.maximized === "boolean") out.maximized = v.maximized;
    return out;
  } catch {
    return {};
  }
}

export function writeState(s: WindowState, file = stateFile()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
  } catch (e) {
    log("shell", `window state not saved: ${e instanceof Error ? e.message : e}`);
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

export function clampZoom(z: number | undefined): number {
  if (typeof z !== "number" || !Number.isFinite(z)) return 1;
  return Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z));
}

export function clampState(saved: Partial<WindowState>, workAreas: Rect[], primary: Rect): WindowState {
  const width = Math.max(MIN_SIZE.width, Math.round(saved.width ?? DEFAULT_SIZE.width));
  const height = Math.max(MIN_SIZE.height, Math.round(saved.height ?? DEFAULT_SIZE.height));
  const base = { maximized: saved.maximized === true, zoom: clampZoom(saved.zoom) };
  if (typeof saved.x === "number" && typeof saved.y === "number") {
    const rect = { x: Math.round(saved.x), y: Math.round(saved.y), width, height };
    const area = workAreas.find((a) => {
      const o = overlap(rect, a);
      return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height;
    });
    const titleBarVisible = area && rect.y >= area.y && rect.y < area.y + area.height;
    if (area && titleBarVisible) {
      const w = Math.min(width, area.width);
      const h = Math.min(height, area.height);
      return { ...rect, width: w, height: h, ...base };
    }
  }
  const w = Math.min(width, primary.width);
  const h = Math.min(height, primary.height);
  return {
    x: primary.x + Math.round((primary.width - w) / 2),
    y: primary.y + Math.round((primary.height - h) / 2),
    width: w,
    height: h,
    ...base,
  };
}

export function nextZoom(current: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return 1;
  const i = ZOOMS.findIndex((z) => z >= current - 1e-3);
  const at = i < 0 ? ZOOMS.length - 1 : i;
  const exact = Math.abs(ZOOMS[at] - current) < 1e-3;
  const next = dir > 0 ? (exact ? at + 1 : at) : at - 1;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, next))];
}

export function sameOrigin(url: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export function navigationAllowed(url: string, origin: string | null): boolean {
  return sameOrigin(url, origin);
}

export type OpenAction = "external" | "child" | "deny";

export function openAction(url: string, origin: string | null): OpenAction {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "deny";
  }
  if (u.protocol === "https:" && !u.username && !u.password) return "external";
  if (origin && u.origin === origin && u.pathname.startsWith("/files/")) return "child";
  return "deny";
}

export const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

export const permissionAllowed = (permission: string) => ALLOWED_PERMISSIONS.has(permission);

export const LOCKED_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
  navigateOnDragDrop: false,
} as const;

export function lockSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permissionAllowed(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission));
  ses.on("will-download", (event, item) => {
    log("shell", `download refused: ${item.getURL().slice(0, 200)}`);
    event.preventDefault();
  });
}

export function lockContents(contents: WebContents, origin: () => string | null): void {
  const refuse = (event: { preventDefault(): void }, url: string) => {
    if (navigationAllowed(url, origin())) return;
    log("shell", `navigation refused: ${url.slice(0, 200)}`);
    event.preventDefault();
  };
  contents.on("will-navigate", (event) => refuse(event, event.url));
  contents.on("will-redirect", (event) => refuse(event, event.url));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const action = openAction(url, origin());
    if (action === "external") {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    if (action === "child")
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { ...LOCKED_PREFERENCES, preload: undefined },
        },
      };
    log("shell", `window refused: ${url.slice(0, 200)}`);
    return { action: "deny" };
  });
}

export function hiddenMenu(dev: boolean): void {
  const zoom = (dir: 1 | -1 | 0) => (_item: unknown, win: unknown) => {
    const w = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow();
    if (!w) return;
    const wc = w.webContents;
    wc.setZoomFactor(nextZoom(wc.getZoomFactor(), dir));
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Zoom in", accelerator: "CommandOrControl+=", click: zoom(1) },
          {
            label: "Zoom in ",
            accelerator: "CommandOrControl+Plus",
            click: zoom(1),
            visible: false,
            acceleratorWorksWhenHidden: true,
          },
          {
            label: "Zoom in  ",
            accelerator: "CommandOrControl+numadd",
            click: zoom(1),
            visible: false,
            acceleratorWorksWhenHidden: true,
          },
          { label: "Zoom out", accelerator: "CommandOrControl+-", click: zoom(-1) },
          {
            label: "Zoom out ",
            accelerator: "CommandOrControl+numsub",
            click: zoom(-1),
            visible: false,
            acceleratorWorksWhenHidden: true,
          },
          { label: "Actual size", accelerator: "CommandOrControl+0", click: zoom(0) },
          {
            label: "Actual size ",
            accelerator: "CommandOrControl+num0",
            click: zoom(0),
            visible: false,
            acceleratorWorksWhenHidden: true,
          },
          { type: "separator" },
          { role: "reload" },
          ...(dev ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
    ]),
  );
}
