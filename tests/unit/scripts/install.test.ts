import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishRelease, ROOT, writeManifest } from "../../../scripts/release.ts";
import { quietCtx } from "../../../src/core/command.ts";
import { installationAt, update, updater } from "../../../src/core/lib/updates.ts";
import { run } from "../../../src/shared/run/process.ts";

const WIN = process.platform === "win32";
const powershell = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
let dir = "";
const saved = { ...updater };

function fakeRelease(channel: string, version: string, manifest = true): string {
  const out = join(channel, `testimus-${version}-win-x64`);
  mkdirSync(join(out, "app"), { recursive: true });
  writeFileSync(join(out, "app", "package.json"), JSON.stringify({ version }));
  writeFileSync(join(out, "app", "testimus.mjs"), `// ${version}\n`);
  copyFileSync(join(ROOT, "scripts", "install.ps1"), join(out, "install.ps1"));
  if (manifest) writeManifest(out, version, `notes ${version}`);
  return out;
}

const install = (release: string, root: string, more: string[] = []) =>
  run({
    exe: powershell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(release, "install.ps1"),
      "-Root",
      root,
      "-NoPath",
      "-NoShortcut",
      "-NoSetup",
      "-NoPrompt",
      ...more,
    ],
    timeoutMs: 60_000,
  });

beforeAll(() => {
  // ponytail: PowerShell writes the long form of a path; %TEMP% may be an 8.3 one (SFD21~1.GEN)
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "testimus-install-")));
});
afterAll(() => {
  Object.assign(updater, saved);
  rmSync(dir, { recursive: true, force: true });
});

describe.runIf(WIN)("install.ps1: install, update from the shared folder, refuse a half copy, prune", () => {
  const share = () => join(dir, "share");
  const root = () => join(dir, "Testimus");

  it("installs, remembers the folder it came from and how", async () => {
    const r = await install(fakeRelease(share(), "0.3.0"), root());
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(join(root(), "current.txt"), "utf8")).toBe("0.3.0");
    const info = JSON.parse(readFileSync(join(root(), "install.json"), "utf8"));
    expect(info).toMatchObject({
      version: "0.3.0",
      from: join(share(), "testimus-0.3.0-win-x64"),
      channel: share(),
      options: { noPath: true, noShortcut: true, noDesktop: false, shortcutDir: "" },
    });
    expect(installationAt(join(root(), "0.3.0"))).toMatchObject({ channel: share(), current: "0.3.0" });
  }, 90_000);

  it("refuses a release whose copy does not match its release.json, and leaves the current one", async () => {
    const half = fakeRelease(share(), "0.3.5");
    writeFileSync(join(half, "app", "late.js"), "arrived after the manifest");
    const r = await install(half, root());
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("incomplete");
    expect(existsSync(join(root(), "0.3.5"))).toBe(false);
    expect(readFileSync(join(root(), "current.txt"), "utf8")).toBe("0.3.0");
    rmSync(half, { recursive: true, force: true });
  }, 90_000);

  it("updates through system.update's installer, the same way, and keeps two versions", async () => {
    updater.installation = () => installationAt(join(root(), "0.3.0"));
    fakeRelease(share(), "0.4.0");
    expect(await update(quietCtx(null), "0.3.0", {})).toMatchObject({ version: "0.4.0", previous: "0.3.0" });
    expect(readFileSync(join(root(), "current.txt"), "utf8")).toBe("0.4.0");
    const info = JSON.parse(readFileSync(join(root(), "install.json"), "utf8"));
    expect(info).toMatchObject({ version: "0.4.0", channel: share(), options: { noPath: true, noShortcut: true } });
    fakeRelease(share(), "0.5.0", false);
    expect(await update(quietCtx(null), "0.4.0", {})).toMatchObject({ version: "0.5.0" });
    expect(existsSync(join(root(), "0.3.0"))).toBe(false);
    expect(existsSync(join(root(), "0.4.0"))).toBe(true);
    expect(existsSync(join(root(), "0.5.0"))).toBe(true);
  }, 180_000);

  it("a failing installer is told with its last lines, and nothing switches", async () => {
    const bad = fakeRelease(share(), "0.6.0");
    writeFileSync(join(bad, "install.ps1"), 'Write-Host "testimus: disk full"\nexit 3\n');
    writeManifest(bad, "0.6.0", "");
    await expect(update(quietCtx(null), "0.5.0", {})).rejects.toThrow(/failed \(exit 3\): disk full/);
    expect(readFileSync(join(root(), "current.txt"), "utf8")).toBe("0.5.0");
  }, 90_000);

  it("a published release names its folder: installed from a copy taken elsewhere, it still looks there", async () => {
    const published = publishRelease(fakeRelease(join(dir, "dist"), "0.7.0"), share());
    const elsewhere = join(dir, "Desktop", "testimus-0.7.0-win-x64");
    cpSync(published, elsewhere, { recursive: true });
    const r = await install(elsewhere, root());
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root(), "install.json"), "utf8"))).toMatchObject({
      version: "0.7.0",
      from: elsewhere,
      channel: share(),
    });
  }, 90_000);
});
