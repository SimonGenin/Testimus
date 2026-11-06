import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alreadyPublished, installChannel, publishArgs, withVersion } from "../../../scripts/publish.ts";
import { renameSoon } from "../../../scripts/release.ts";

const failing = (codes: string[]) => {
  const calls: string[] = [];
  const rename = (from: string, to: string) => {
    calls.push(`${from}>${to}`);
    const code = codes.shift();
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, rename };
};

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-publish-cmd-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("npm run publish <x.x.x>", () => {
  it("takes the version wherever it is, with --notes and --to, and refuses anything but x.x.x", () => {
    expect(publishArgs(["0.0.6"])).toEqual({ version: "0.0.6", notes: "", to: "" });
    expect(publishArgs(["--notes", "Du neuf", "1.2.3", "--to", "S:\\T"])).toEqual({
      version: "1.2.3",
      notes: "Du neuf",
      to: "S:\\T",
    });
    for (const bad of [[], ["0.0"], ["v0.0.6"], ["0.0.6-beta"], ["--notes", "0.0.6"]])
      expect(() => publishArgs(bad)).toThrow(/x\.x\.x/);
  });

  it("finds a version the folder already holds, by its name or by its release", async () => {
    expect(await alreadyPublished(join(dir, "none"), "0.0.6")).toBeNull();
    mkdirSync(join(dir, "testimus-0.0.6-win-x64"));
    expect(await alreadyPublished(dir, "0.0.6")).toBe(join(dir, "testimus-0.0.6-win-x64"));
    const renamed = join(dir, "Testimus 0.0.7");
    mkdirSync(join(renamed, "app"), { recursive: true });
    writeFileSync(join(renamed, "app", "package.json"), JSON.stringify({ version: "0.0.7" }));
    writeFileSync(join(renamed, "install.ps1"), "#");
    expect(await alreadyPublished(dir, "0.0.7")).toBe(renamed);
    expect(await alreadyPublished(dir, "0.0.8")).toBeNull();
  });

  it("renames the published copy again while the share holds it, but not on any other error", () => {
    const held = failing(["EPERM", "EBUSY"]);
    renameSoon("a", "b", held.rename, 8, 1);
    expect(held.calls).toEqual(["a>b", "a>b", "a>b"]);
    const stuck = failing(["EPERM", "EPERM", "EPERM"]);
    expect(() => renameSoon("a", "b", stuck.rename, 3, 1)).toThrow("EPERM");
    const gone = failing(["ENOENT"]);
    expect(() => renameSoon("a", "b", gone.rename, 8, 1)).toThrow("ENOENT");
    expect(gone.calls).toHaveLength(1);
  });

  it("reads the channel this PC's installed copy follows, and sets package.json's version alone", () => {
    expect(installChannel(dir)).toBe("");
    writeFileSync(join(dir, "install.json"), `\uFEFF${JSON.stringify({ channel: "\\\\NAS\\public\\Testimus" })}`);
    expect(installChannel(dir)).toBe("\\\\NAS\\public\\Testimus");
    writeFileSync(join(dir, "install.json"), JSON.stringify({ channel: 3 }));
    expect(installChannel(dir)).toBe("");
    const pkg = '{\n  "name": "testimus",\n  "version": "0.0.5",\n  "dependencies": { "x": { "version": "9" } }\n}\n';
    expect(withVersion(pkg, "0.0.6")).toBe(pkg.replace('"0.0.5"', '"0.0.6"'));
  });
});
