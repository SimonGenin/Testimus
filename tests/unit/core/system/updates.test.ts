import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import {
  checkUpdates,
  compareVersions,
  type Installation,
  installationAt,
  installerArgs,
  parseVersion,
  readUpdates,
  scanReleases,
  sourceOf,
  update,
  updater,
} from "../../../../src/core/lib/updates.ts";
import { setupUpdatesMock } from "../../../../src/core/mock/updates.ts";
import { call } from "../registry.ts";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf8")) as {
  version: string;
};
const saved = { ...updater };
let dir = "";

function release(folder: string, version: string, meta?: Record<string, unknown>): string {
  mkdirSync(join(folder, "app"), { recursive: true });
  writeFileSync(join(folder, "app", "package.json"), JSON.stringify({ version }));
  writeFileSync(join(folder, "install.ps1"), "#");
  if (meta) writeFileSync(join(folder, "release.json"), JSON.stringify(meta));
  return folder;
}

function installed(root: string, version: string, info?: unknown): Installation {
  release(join(root, version), version);
  writeFileSync(join(root, "current.txt"), `\uFEFF${version}\r\n`);
  if (info !== undefined) writeFileSync(join(root, "install.json"), JSON.stringify(info));
  const inst = installationAt(join(root, version));
  if (!inst) throw new Error("not installed");
  return inst;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-updates-"));
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
});
afterEach(() => {
  Object.assign(updater, saved);
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  delete process.env.TESTIMUS_MOCK_UPDATES;
});

describe("versions", () => {
  it("compares x.y.z numerically, a pre-release before its release, an unparsable one oldest", () => {
    expect(parseVersion("v1.2.3-beta.2")).toEqual([1, 2, 3, "beta.2"]);
    expect(parseVersion("1.2")).toBeNull();
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
    expect(compareVersions("0.4.0-beta", "0.4.0")).toBeLessThan(0);
    expect(compareVersions("0.4.0", "0.4.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0-rc.10", "0.4.0-rc.9")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0-rc", "0.4.0-rc")).toBe(0);
    expect(compareVersions("junk", "0.0.1")).toBeLessThan(0);
    expect(compareVersions("0.0.1", "junk")).toBeGreaterThan(0);
    expect(compareVersions("junk", "other")).toBe(0);
  });
});

describe("where Testimus is installed and where it looks", () => {
  it("is an installed copy only beside a current.txt naming an existing version folder", () => {
    expect(installationAt(undefined)).toBeNull();
    expect(installationAt("  ")).toBeNull();
    release(join(dir, "dist", "testimus-0.3.0-win-x64"), "0.3.0");
    expect(installationAt(join(dir, "dist", "testimus-0.3.0-win-x64"))).toBeNull();
    writeFileSync(join(dir, "dist", "current.txt"), "9.9.9");
    expect(installationAt(join(dir, "dist", "testimus-0.3.0-win-x64"))).toBeNull();
  });

  it("reads install.json's channel and options, and survives a broken one", () => {
    const root = join(dir, "Testimus");
    const inst = installed(root, "0.3.0", {
      channel: "\\\\srv\\tools\\Testimus",
      options: { noPath: true, noShortcut: true, noDesktop: true, shortcutDir: "C:\\x", junk: 1 },
    });
    expect(inst).toEqual({
      root,
      running: "0.3.0",
      current: "0.3.0",
      channel: "\\\\srv\\tools\\Testimus",
      options: { noPath: true, noShortcut: true, noDesktop: true, shortcutDir: "C:\\x" },
    });
    expect(installationAt(`${join(root, "0.3.0")}\\`)?.running).toBe("0.3.0");
    writeFileSync(join(root, "install.json"), "{ not json");
    expect(installationAt(join(root, "0.3.0"))).toMatchObject({ channel: "", options: {} });
    writeFileSync(join(root, "install.json"), "[1]");
    expect(installationAt(join(root, "0.3.0"))).toMatchObject({ channel: "", options: {} });
    writeFileSync(join(root, "install.json"), JSON.stringify({ channel: 3, options: "x" }));
    expect(installationAt(join(root, "0.3.0"))).toMatchObject({ channel: "", options: {} });
  });

  it("a folder set by hand wins over the one installed from", () => {
    const inst = installed(join(dir, "T"), "0.3.0", { channel: "C:\\from" });
    expect(sourceOf({ updates: { from: "  D:\\share  " } }, inst)).toEqual({ path: "D:\\share", from: "settings" });
    expect(sourceOf({ updates: { from: " " } }, inst)).toEqual({ path: "C:\\from", from: "install" });
    expect(sourceOf({}, null)).toEqual({ path: "", from: "none" });
  });
});

describe("reading the update folder", () => {
  it("finds the release folders of a channel, newest first, whatever their names", async () => {
    const ch = join(dir, "share");
    release(join(ch, "testimus-0.3.0-win-x64"), "0.3.0");
    release(join(ch, "0.10.0"), "0.10.0", { version: "0.10.0", notes: "  New!\n", built: "2026-11-05" });
    release(join(ch, ".testimus-0.11.0-win-x64.partial"), "0.11.0");
    release(join(ch, "_old"), "0.12.0");
    release(join(ch, "half"), "0.13.0", { version: "0.12.9" });
    release(join(ch, "bad-version"), "next");
    mkdirSync(join(ch, "notes"));
    writeFileSync(join(ch, "readme.txt"), "hi");
    const noInstaller = join(ch, "no-ps1");
    mkdirSync(join(noInstaller, "app"), { recursive: true });
    writeFileSync(join(noInstaller, "app", "package.json"), '{"version":"0.20.0"}');
    const brokenPkg = join(ch, "broken");
    release(brokenPkg, "0.21.0");
    writeFileSync(join(brokenPkg, "app", "package.json"), "{");
    const r = await scanReleases(ch);
    expect(r.map((x) => x.version)).toEqual(["0.10.0", "0.3.0"]);
    expect(r[0]).toEqual({ version: "0.10.0", folder: join(ch, "0.10.0"), notes: "New!", built: "2026-11-05" });
    expect(r[1]).toMatchObject({ notes: "", built: "" });
  });

  it("reads a release folder given itself", async () => {
    const one = release(join(dir, "testimus-0.5.0-win-x64"), "0.5.0", { notes: "x" });
    expect((await scanReleases(one)).map((x) => x.version)).toEqual(["0.5.0"]);
  });

  it("never fails: no folder, a gone folder, a file, an empty folder each say why", async () => {
    expect(await checkUpdates("0.3.0", {}, null)).toMatchObject({
      installed: false,
      sourceFrom: "none",
      reachable: false,
      available: false,
      problem: expect.stringContaining("No update folder"),
    });
    const gone = await checkUpdates("0.3.0", { updates: { from: join(dir, "gone") } }, null);
    expect(gone).toMatchObject({ reachable: false, latest: null, problem: expect.stringContaining("does not exist") });
    writeFileSync(join(dir, "file"), "x");
    const file = await checkUpdates("0.3.0", { updates: { from: join(dir, "file") } }, null);
    expect(file.problem).toMatch(/is a file|cannot be read/);
    mkdirSync(join(dir, "empty"));
    const empty = await checkUpdates("0.3.0", { updates: { from: join(dir, "empty") } }, null);
    expect(empty).toMatchObject({ reachable: true, latest: null, available: false });
    expect(empty.problem).toContain("No Testimus release");
  });

  it("offers a newer release only, and not twice once it waits for a restart", async () => {
    const ch = join(dir, "share");
    release(join(ch, "a"), "0.4.0", { notes: "n" });
    const root = join(dir, "T");
    const inst = installed(root, "0.3.0", { channel: ch });
    const s = await checkUpdates("0.3.0", {}, inst);
    expect(s).toMatchObject({
      current: "0.3.0",
      installed: true,
      pending: "",
      source: ch,
      sourceFrom: "install",
      reachable: true,
      problem: "",
      available: true,
      latest: { version: "0.4.0", notes: "n" },
    });
    expect((await checkUpdates("0.4.0", {}, inst)).available).toBe(false);
    expect((await checkUpdates("0.5.0", {}, inst)).available).toBe(false);
    release(join(root, "0.4.0"), "0.4.0");
    writeFileSync(join(root, "current.txt"), "0.4.0");
    const waiting = await checkUpdates("0.3.0", {}, installationAt(join(root, "0.3.0")));
    expect(waiting).toMatchObject({ pending: "0.4.0", available: false });
    release(join(ch, "b"), "0.5.0");
    expect(await checkUpdates("0.3.0", {}, installationAt(join(root, "0.3.0")))).toMatchObject({
      pending: "0.4.0",
      available: true,
      latest: { version: "0.5.0" },
    });
  });

  it("asks the folder once at a time", async () => {
    updater.installation = () => null;
    const a = readUpdates("0.3.0", { updates: { from: dir } });
    const b = readUpdates("0.3.0", { updates: { from: dir } });
    expect(a).toBe(b);
    await a;
    expect(readUpdates("0.3.0", { updates: { from: dir } })).not.toBe(a);
  });
});

describe("installing an update", () => {
  it("runs the release's install.ps1 into the same root, the same way it was installed", () => {
    const r = { version: "0.4.0", folder: "\\\\srv\\t\\0.4.0", notes: "", built: "" };
    const base = { root: "C:\\T", running: "0.3.0", current: "0.3.0", channel: "" };
    expect(installerArgs(r, { ...base, options: {} })).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join("\\\\srv\\t\\0.4.0", "install.ps1"),
      "-Root",
      "C:\\T",
      "-NoPrompt",
      "-NoSetup",
    ]);
    expect(
      installerArgs(r, {
        ...base,
        options: { noPath: true, noShortcut: true, noDesktop: true, shortcutDir: "D:\\links" },
      }).slice(10),
    ).toEqual(["-NoPath", "-NoShortcut", "-NoDesktop", "-ShortcutDir", "D:\\links"]);
  });

  it("refuses a copy that is not installed, a missing folder, an empty one and an unknown version", async () => {
    updater.installation = () => null;
    await expect(update(quietCtx(null), "0.3.0", {})).rejects.toThrow("not an installed copy");
    const root = join(dir, "T");
    const inst = installed(root, "0.3.0", {});
    updater.installation = () => inst;
    await expect(update(quietCtx(null), "0.3.0", {})).rejects.toThrow("No update folder");
    await expect(update(quietCtx(null), "0.3.0", { updates: { from: join(dir, "gone") } })).rejects.toThrow(
      "does not exist",
    );
    mkdirSync(join(dir, "share"));
    await expect(update(quietCtx(null), "0.3.0", { updates: { from: join(dir, "share") } })).rejects.toThrow(
      "No Testimus release",
    );
    release(join(dir, "share", "a"), "0.4.0");
    await expect(update(quietCtx(null), "0.3.0", { updates: { from: join(dir, "share") } }, "0.9.0")).rejects.toThrow(
      "No release 0.9.0",
    );
  });

  it("installs the newest (or the version asked) and checks it became current", async () => {
    const ch = join(dir, "share");
    release(join(ch, "a"), "0.4.0");
    release(join(ch, "b"), "0.5.0");
    const root = join(dir, "T");
    installed(root, "0.3.0", { channel: ch });
    updater.installation = () => installationAt(join(root, "0.3.0"));
    const seen: string[] = [];
    updater.install = async (_ctx, r, inst) => {
      seen.push(`${r.version} into ${inst.root}`);
      release(join(inst.root, r.version), r.version);
      writeFileSync(join(inst.root, "current.txt"), r.version);
    };
    expect(await update(quietCtx(null), "0.3.0", {})).toEqual({
      version: "0.5.0",
      from: join(ch, "b"),
      previous: "0.3.0",
    });
    expect(await update(quietCtx(null), "0.3.0", {}, "0.4.0")).toMatchObject({ version: "0.4.0" });
    expect(seen).toEqual([`0.5.0 into ${root}`, `0.4.0 into ${root}`]);
  });

  it("fails when the installer ends without switching, and one update runs at a time", async () => {
    const ch = join(dir, "share");
    release(join(ch, "a"), "0.4.0");
    const inst = installed(join(dir, "T"), "0.3.0", { channel: ch });
    updater.installation = () => inst;
    let open: (() => void) | null = null;
    updater.install = () =>
      new Promise<void>((resolve) => {
        open = resolve;
      });
    const first = update(quietCtx(null), "0.3.0", {});
    first.catch(() => {});
    await expect(update(quietCtx(null), "0.3.0", {})).rejects.toThrow("already being installed");
    await expect.poll(() => open).not.toBeNull();
    (open as unknown as () => void)();
    await expect(first).rejects.toThrow("is not the current version");
  });
});

describe("system.updates, system.update and system.set through the registry", () => {
  it("saves the folder (quotes dropped), clears it when empty, and reads it", async () => {
    const ch = join(dir, "share");
    release(join(ch, "x"), "99.0.0", { notes: "big" });
    updater.installation = () => null;
    const s = await call<{ updates?: { from?: string } }>("system.set", { updatesFrom: ` "${ch}" ` }, null);
    expect(s.updates).toEqual({ from: ch });
    const u = await call<{ available: boolean; sourceFrom: string; latest: { notes: string } }>(
      "system.updates",
      {},
      null,
    );
    expect(u).toMatchObject({ available: true, sourceFrom: "settings", latest: { notes: "big" } });
    expect((await call<{ updates?: unknown }>("system.set", { updatesFrom: "" }, null)).updates).toBeUndefined();
    await expect(call("system.update", {}, null, { wait: true })).rejects.toThrow("not an installed copy");
  });

  it("--mock: an installed sandbox, a fake team folder, an update that waits for a restart", async () => {
    process.env.TESTIMUS_MOCK_UPDATES = "0.9.0, 99.1.0";
    process.env.TESTIMUS_MOCK_UPDATE_MS = "1";
    setupUpdatesMock(dir);
    const before = await call<{ available: boolean; installed: boolean; latest: { version: string; notes: string } }>(
      "system.updates",
      {},
      null,
    );
    expect(before).toMatchObject({ installed: true, available: true, latest: { version: "99.1.0" } });
    expect(before.latest.notes).toContain("release notes");
    const out = await call<{ version: string; previous: string }>("system.update", {}, null, { wait: true });
    expect(out).toMatchObject({ version: "99.1.0", previous: pkg.version });
    expect(await call("system.updates", {}, null)).toMatchObject({ pending: "99.1.0", available: false });
    delete process.env.TESTIMUS_MOCK_UPDATE_MS;
  });

  it("--mock unreachable: the folder is gone, and the page is told so", async () => {
    process.env.TESTIMUS_MOCK_UPDATES = "unreachable";
    setupUpdatesMock(dir);
    expect(await call("system.updates", {}, null)).toMatchObject({
      installed: true,
      reachable: false,
      available: false,
      problem: expect.stringContaining("does not exist"),
    });
  });
});
