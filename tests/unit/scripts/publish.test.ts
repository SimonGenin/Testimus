import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishFolder, publishRelease, releaseArgs, uncPath, writeManifest } from "../../../scripts/release.ts";
import { scanReleases } from "../../../src/core/lib/updates.ts";

let dir = "";

function built(version: string): string {
  const out = join(dir, "dist", `testimus-${version}-win-x64`);
  mkdirSync(join(out, "app"), { recursive: true });
  writeFileSync(join(out, "app", "package.json"), JSON.stringify({ version }));
  writeFileSync(join(out, "install.ps1"), "#");
  writeFileSync(join(out, "Testimus.exe"), "12345");
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-publish-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("release.json and publishing to the shared folder", () => {
  it("release.json counts every file but itself, and is rewritten whole", () => {
    const out = built("0.4.0");
    const m = writeManifest(out, "0.4.0", "  New!  ", new Date("2026-11-05T10:00:00Z"));
    expect(m).toEqual({ version: "0.4.0", built: "2026-11-05T10:00:00.000Z", files: 3, bytes: 25, notes: "New!" });
    expect(JSON.parse(readFileSync(join(out, "release.json"), "utf8"))).toEqual(m);
    expect(writeManifest(out, "0.4.0", "").files).toBe(3);
  });

  it("publishes under a hidden .partial name, then renames: Testimus finds it whole", async () => {
    const out = built("0.4.0");
    writeManifest(out, "0.4.0", "n");
    const share = join(dir, "share");
    expect(publishRelease(out, share)).toBe(join(share, "testimus-0.4.0-win-x64"));
    expect(readdirSync(share)).toEqual(["testimus-0.4.0-win-x64"]);
    expect((await scanReleases(share)).map((r) => [r.version, r.notes])).toEqual([["0.4.0", "n"]]);
    const meta = JSON.parse(readFileSync(join(share, "testimus-0.4.0-win-x64", "release.json"), "utf8"));
    expect(meta).toMatchObject({ version: "0.4.0", files: 3, channel: share });
    expect(JSON.parse(readFileSync(join(out, "release.json"), "utf8")).channel).toBeUndefined();
  });

  it("never replaces a version already there, and wants a built release", () => {
    const out = built("0.4.0");
    expect(() => publishRelease(out, join(dir, "share"))).toThrow("has no release.json");
    writeManifest(out, "0.4.0", "");
    publishRelease(out, join(dir, "share"));
    expect(() => publishRelease(out, join(dir, "share"))).toThrow("raise the version");
    expect(existsSync(join(dir, "share", ".testimus-0.4.0-win-x64.partial"))).toBe(false);
  });

  it("a move: the release goes to the old folder but sends the PCs to the new one", () => {
    const out = built("0.5.0");
    writeManifest(out, "0.5.0", "");
    const target = publishRelease(out, join(dir, "old"), "\\\\new\\share\\Testimus");
    expect(JSON.parse(readFileSync(join(target, "release.json"), "utf8")).channel).toBe("\\\\new\\share\\Testimus");
  });

  it("reads its flags", () => {
    expect(releaseArgs([])).toEqual({
      reuseUi: false,
      skipNode: false,
      notes: "",
      publish: false,
      publishTo: "",
      channel: "",
      publishOnly: false,
    });
    expect(
      releaseArgs([
        "--reuse-ui",
        "--notes",
        "Two panes",
        "--publish",
        "S:\\Softs\\Testimus",
        "--channel",
        "\\\\new\\t",
        "--skip-node",
      ]),
    ).toEqual({
      reuseUi: true,
      skipNode: true,
      notes: "Two panes",
      publish: true,
      publishTo: "S:\\Softs\\Testimus",
      channel: "\\\\new\\t",
      publishOnly: false,
    });
    expect(releaseArgs(["--publish", "--notes", "x"])).toMatchObject({ publish: true, publishTo: "" });
    expect(releaseArgs(["--publish-only"])).toMatchObject({ publish: true, publishOnly: true });
  });

  it("publishes to the folder given, else to Settings › Updates, else says how", () => {
    expect(publishFolder(" D:\\a ", "S:\\b")).toBe("D:\\a");
    expect(publishFolder("", " S:\\b ")).toBe("S:\\b");
    expect(() => publishFolder("", undefined)).toThrow("Settings › Updates");
    expect(() => publishFolder(" ", " ")).toThrow("No folder to publish to");
  });

  it("writes a mapped drive as its \\\\server\\share path, and leaves the rest", () => {
    const roots: Record<string, string> = { S: "\\\\RACKSTATION\\public\\", T: "" };
    const root = (l: string) => roots[l] ?? "";
    expect(uncPath("S:\\For SimonG\\Softs\\Testimus", root)).toBe(
      "\\\\RACKSTATION\\public\\For SimonG\\Softs\\Testimus",
    );
    expect(uncPath("s:/x/y", root)).toBe("\\\\RACKSTATION\\public\\x\\y");
    expect(uncPath("T:\\local", root)).toBe("T:\\local");
    expect(uncPath("\\\\srv\\t", root)).toBe("\\\\srv\\t");
    expect(uncPath("relative\\x", root)).toBe("relative\\x");
  });
});
