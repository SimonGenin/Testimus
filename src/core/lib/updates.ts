import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { run } from "../../shared/run/process.ts";
import { isCancelled, timeout } from "../../shared/run/work.ts";
import { type Ctx, UserError } from "../command.ts";
import { withProcess } from "../jobs.ts";
import type { Settings } from "../types.ts";
import { natural } from "./natural.ts";

export type Release = { version: string; folder: string; notes: string; built: string };

export type InstallOptions = { noPath?: boolean; noShortcut?: boolean; noDesktop?: boolean; shortcutDir?: string };

// ponytail: an installed copy is <root>\<version>\ next to <root>\current.txt (install.ps1); install.json says where
// the release came from (its parent folder is the channel) and how it was installed, so an update installs the same way
export type Installation = {
  root: string;
  running: string;
  current: string;
  channel: string;
  options: InstallOptions;
};

export type SourceFrom = "settings" | "install" | "none";

export type UpdateState = {
  current: string;
  installed: boolean;
  pending: string;
  source: string;
  sourceFrom: SourceFrom;
  reachable: boolean;
  problem: string;
  latest: Release | null;
  available: boolean;
};

const CHECK_MS = 15_000;

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(v: string): [number, number, number, string] | null {
  const m = VERSION.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""] : null;
}

// ponytail: x.y.z numerically, a pre-release (0.4.0-beta) before its release; a version that does not parse is the oldest
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return natural(x[3], y[3]);
}

const readText = (file: string): string => {
  try {
    return readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .trim();
  } catch {
    return "";
  }
};

function readObject(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readText(file));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function installationAt(home: string | undefined): Installation | null {
  const release = home?.trim().replace(/[\\/]+$/, "");
  if (!release) return null;
  const root = dirname(release);
  const current = readText(join(root, "current.txt"));
  if (!current || !existsSync(join(root, current))) return null;
  const info = readObject(join(root, "install.json"));
  const o = info.options && typeof info.options === "object" ? (info.options as Record<string, unknown>) : {};
  return {
    root,
    running: basename(release),
    current,
    channel: str(info.channel),
    options: {
      ...(o.noPath === true ? { noPath: true } : {}),
      ...(o.noShortcut === true ? { noShortcut: true } : {}),
      ...(o.noDesktop === true ? { noDesktop: true } : {}),
      ...(str(o.shortcutDir) ? { shortcutDir: str(o.shortcutDir) } : {}),
    },
  };
}

export function sourceOf(
  settings: Pick<Settings, "updates">,
  inst: Installation | null,
): { path: string; from: SourceFrom } {
  const typed = settings.updates?.from?.trim() ?? "";
  if (typed) return { path: typed, from: "settings" };
  if (inst?.channel) return { path: inst.channel, from: "install" };
  return { path: "", from: "none" };
}

const SKIPPED = /^[._]|\.partial$/i;

// ponytail: a release folder is one install.ps1 can install: app\package.json gives its version; release.json (written
// last by the release) adds notes, and one that names another version marks a folder copied over badly — skipped
export async function readRelease(folder: string): Promise<Release | null> {
  try {
    if (!(await stat(join(folder, "install.ps1"))).isFile()) return null;
    const pkg = JSON.parse((await readFile(join(folder, "app", "package.json"), "utf8")).replace(/^\uFEFF/, ""));
    const version = str(pkg?.version);
    if (!parseVersion(version)) return null;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse((await readFile(join(folder, "release.json"), "utf8")).replace(/^\uFEFF/, ""));
    } catch {}
    if (str(meta.version) && str(meta.version) !== version) return null;
    return { version, folder, notes: str(meta.notes).trim(), built: str(meta.built) };
  } catch {
    return null;
  }
}

// ponytail: the folder is a channel holding release folders (any names), or one release folder itself; newest first
export async function scanReleases(path: string): Promise<Release[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const found = await Promise.all([
    readRelease(path),
    ...entries.filter((e) => e.isDirectory() && !SKIPPED.test(e.name)).map((e) => readRelease(join(path, e.name))),
  ]);
  return found.filter((r): r is Release => !!r).sort((a, b) => compareVersions(b.version, a.version));
}

function unreadable(path: string, e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError")
    return `The update folder ${path} did not answer in ${CHECK_MS / 1000} s (network or VPN down?).`;
  const code = (e as { code?: string })?.code;
  if (code === "ENOENT") return `The update folder ${path} does not exist (moved or renamed?).`;
  if (code === "ENOTDIR") return `The update source ${path} is a file, not a folder.`;
  if (code === "EACCES" || code === "EPERM") return `The update folder ${path} cannot be read with your account.`;
  return `The update folder ${path} cannot be read (${code ?? (e instanceof Error ? e.message : String(e))}).`;
}

export async function checkUpdates(
  current: string,
  settings: Pick<Settings, "updates">,
  inst: Installation | null,
  ms = CHECK_MS,
): Promise<UpdateState> {
  const source = sourceOf(settings, inst);
  const pending = inst && inst.current !== inst.running && inst.current !== current ? inst.current : "";
  const base = { current, installed: !!inst, pending, source: source.path, sourceFrom: source.from };
  if (source.from === "none")
    return {
      ...base,
      reachable: false,
      problem: "No update folder: set one here, or install Testimus from the team folder once.",
      latest: null,
      available: false,
    };
  let releases: Release[];
  try {
    releases = await timeout(ms, () => scanReleases(source.path));
  } catch (e) {
    return { ...base, reachable: false, problem: unreadable(source.path, e), latest: null, available: false };
  }
  const latest = releases[0] ?? null;
  const have = pending && compareVersions(pending, current) > 0 ? pending : current;
  return {
    ...base,
    reachable: true,
    problem: latest ? "" : `No Testimus release in ${source.path}.`,
    latest,
    available: !!latest && compareVersions(latest.version, have) > 0,
  };
}

export function installerArgs(release: Release, inst: Installation): string[] {
  const o = inst.options;
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(release.folder, "install.ps1"),
    "-Root",
    inst.root,
    "-NoPrompt",
    "-NoSetup",
    ...(o.noPath ? ["-NoPath"] : []),
    ...(o.noShortcut ? ["-NoShortcut"] : []),
    ...(o.noDesktop ? ["-NoDesktop"] : []),
    ...(o.shortcutDir ? ["-ShortcutDir", o.shortcutDir] : []),
  ];
}

const powershell = () =>
  join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// ponytail: the release's own install.ps1 does the work — it copies next to the running version (never over it),
// checks the copy against release.json, then switches current.txt; a cancel or a failure leaves the running one current
async function runInstaller(ctx: Ctx, release: Release, inst: Installation): Promise<void> {
  const args = installerArgs(release, inst);
  const lines: string[] = [];
  const exit = await withProcess(
    "install.ps1",
    `powershell ${args.join(" ")}`,
    (pid) =>
      run({
        exe: powershell(),
        args,
        cwd: inst.root,
        signal: ctx.signal,
        onSpawn: pid,
        onLine(line, stream) {
          const text = line.replace(/^testimus: /, "").trim();
          if (!text) return;
          lines.push(text);
          if (stream === "stderr") ctx.log("warn", text);
          else ctx.progress({ message: text });
        },
      }),
    (r) => r.code,
  );
  if (exit.cancelled) throw new UserError("Update cancelled: the running version stays current.");
  if (exit.code !== 0)
    throw new UserError(
      `The installer of ${release.version} failed (exit ${exit.code}): ${lines.slice(-3).join(" · ") || exit.error || "no output"}`,
      `Run it by hand to see why: powershell -ExecutionPolicy Bypass -File "${join(release.folder, "install.ps1")}"`,
    );
}

// ponytail: how an update is found and run — this PC's installation and its install.ps1; --mock swaps both
export const updater: {
  installation(): Installation | null;
  install(ctx: Ctx, release: Release, inst: Installation): Promise<void>;
} = {
  installation: () => installationAt(process.env.TESTIMUS_HOME_BIN),
  install: runInstaller,
};

let checking: Promise<UpdateState> | null = null;

export function readUpdates(current: string, settings: Pick<Settings, "updates">): Promise<UpdateState> {
  checking ??= checkUpdates(current, settings, updater.installation()).finally(() => {
    checking = null;
  });
  return checking;
}

let installing = false;

export async function update(
  ctx: Ctx,
  current: string,
  settings: Pick<Settings, "updates">,
  version?: string,
): Promise<{ version: string; from: string; previous: string }> {
  const inst = updater.installation();
  if (!inst)
    throw new UserError(
      "This Testimus is not an installed copy, so it cannot update itself.",
      "Install a release with its install.ps1 (from the team folder), then update from there.",
    );
  if (installing) throw new UserError("An update is already being installed.");
  const source = sourceOf(settings, inst);
  if (!source.path) throw new UserError("No update folder.", "Set one in Settings › Updates.");
  installing = true;
  try {
    return await installFrom(ctx, source.path, inst, current, version);
  } finally {
    installing = false;
  }
}

async function installFrom(
  ctx: Ctx,
  path: string,
  inst: Installation,
  current: string,
  version?: string,
): Promise<{ version: string; from: string; previous: string }> {
  ctx.steps?.([
    { id: "find", label: "Find the release" },
    { id: "install", label: "Install it" },
  ]);
  ctx.step?.("find");
  let releases: Release[];
  try {
    releases = await timeout(CHECK_MS, () => scanReleases(path), ctx.signal);
  } catch (e) {
    if (isCancelled(e)) throw e;
    throw new UserError(unreadable(path, e), "Check the folder in Settings › Updates.");
  }
  const release = version ? releases.find((r) => r.version === version) : releases[0];
  if (!release) throw new UserError(version ? `No release ${version} in ${path}.` : `No Testimus release in ${path}.`);
  ctx.step?.("install", `Install ${release.version}`);
  ctx.progress({ message: `Installing ${release.version} from ${release.folder}` });
  await updater.install(ctx, release, inst);
  const now = updater.installation();
  if (now?.current !== release.version)
    throw new UserError(
      `The installer ended but ${release.version} is not the current version (${now?.current || "none"}).`,
      "Look at the job's log; rerun the update.",
    );
  return { version: release.version, from: release.folder, previous: current };
}
