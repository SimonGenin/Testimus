import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFile } from "@electron/asar";
import { describe, expect, it } from "vitest";
import {
  asarFiles,
  asarHeaderHash,
  asarIntegrityOf,
  FUSES,
  LOCALES,
  layoutProblems,
  pinnedElectron,
  ROOT,
  readFuses,
} from "../../scripts/release.ts";

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const OUT = join(ROOT, "dist", `testimus-${version}-win-x64`);
const EXE = join(OUT, "Testimus.exe");
const ASAR = join(OUT, "resources", "app.asar");
const built = existsSync(EXE) && existsSync(ASAR);

describe.skipIf(!built)("release: the desktop shell as produced by npm run release", () => {
  it("has the expected layout", () => {
    expect(layoutProblems(OUT)).toEqual([]);
    for (const f of ["node", "app", "models", "resources", "locales"]) expect(existsSync(join(OUT, f))).toBe(true);
  });

  it("is the pinned Electron", () => {
    expect(readFileSync(join(OUT, "version"), "utf8").trim()).toBe(pinnedElectron());
  });

  it("flips the fuses of runtime B in Testimus.exe", async () => {
    expect(await readFuses(EXE)).toEqual(FUSES);
    expect(FUSES).toEqual({
      RunAsNode: false,
      EnableCookieEncryption: true,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
    });
  });

  it("keeps the en-US and fr locales only", () => {
    expect(readdirSync(join(OUT, "locales")).sort()).toEqual([...LOCALES].sort());
  });

  it("packs main.mjs, preload.cjs and pages/ in app.asar", () => {
    const files = asarFiles(ASAR);
    for (const f of ["package.json", "main.mjs", "preload.cjs", "pages", "pages/splash.html", "pages/error.html"])
      expect(files).toContain(f);
    expect(files.some((f) => f.startsWith("pages/") && f.endsWith(".js"))).toBe(true);
    const pkg = JSON.parse(extractFile(ASAR, "package.json").toString("utf8"));
    expect(pkg).toMatchObject({ main: "main.mjs", productName: "Testimus", version });
  });

  it("embeds the hash of app.asar's header in Testimus.exe", { timeout: 60_000 }, () => {
    expect(asarIntegrityOf(EXE)).toEqual([{ file: "resources\\app.asar", alg: "SHA256", value: asarHeaderHash(ASAR) }]);
  });

  it("bundles the model catalog into the core", () => {
    const bundle = readFileSync(join(OUT, "app", "testimus.mjs"), "utf8");
    const catalog = JSON.parse(readFileSync(join(ROOT, "models", "catalog.json"), "utf8")) as {
      entries?: { id: string }[];
    };
    expect(bundle).toContain("models/catalog.json");
    for (const e of catalog.entries ?? []) expect(bundle).toContain(e.id);
  });
});
