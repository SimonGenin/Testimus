import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLES,
  dependencyClosure,
  download,
  EXTERNALS,
  electronZip,
  keepElectronFile,
  keepFile,
  LAYOUT,
  LOCALES,
  layoutProblems,
  mapPath,
  parseElectronShasums,
  parseShasums,
  pinnedElectron,
  ROOT,
  rewriteUrls,
  shellPackageJson,
  windowsText,
} from "../../../scripts/release.ts";

const src = (...p: string[]) => join(ROOT, "src", ...p);

describe("release: paths next to the bundle", () => {
  it("maps repo paths to the release layout", () => {
    expect(mapPath("package.json")).toBe("package.json");
    expect(mapPath("templates/project")).toBe("templates/project");
    expect(mapPath("tests/fixtures")).toBe("fixtures");
    expect(mapPath(".models")).toBe("../models");
    expect(mapPath("src/faces/cli.ts")).toBeNull();
    expect(mapPath("templatesX")).toBeNull();
  });

  it("rewrites new URL(..., import.meta.url) that point at mapped files", () => {
    const sys = 'readFileSync(new URL("../../../package.json", import.meta.url), "utf8")';
    expect(rewriteUrls(sys, src("core", "commands", "system.ts"))).toBe(
      'readFileSync(new URL("./package.json", import.meta.url), "utf8")',
    );
    const tpl = 'fileURLToPath(new URL("../../../templates/project/", import.meta.url))';
    expect(rewriteUrls(tpl, src("core", "commands", "project.ts"))).toBe(
      'fileURLToPath(new URL("./templates/project/", import.meta.url))',
    );
    const models = 'new URL("../../../.models/", import.meta.url)';
    expect(rewriteUrls(models, src("core", "lib", "models-store.ts"))).toBe('new URL("../models/", import.meta.url)');
    const rel = "$" + "{rel}";
    const fx = "new URL(`../../../tests/fixtures/" + rel + "`, import.meta.url)";
    expect(rewriteUrls(fx, src("core", "mock", "jira.ts"))).toBe("new URL(`./fixtures/" + rel + "`, import.meta.url)");
  });

  it("bundles the embed worker beside the core, and the core starts it there", () => {
    expect(BUNDLES).toEqual([
      ["src/faces/cli.ts", "testimus.mjs"],
      ["src/core/rag/runtimes/embed-worker.ts", "embed-worker.mjs"],
    ]);
    for (const [input] of BUNDLES) expect(existsSync(join(ROOT, ...input.split("/")))).toBe(true);
    const file = src("core", "rag", "runtimes", "embed-process.ts");
    const code = readFileSync(file, "utf8");
    expect(code).toContain('new URL("./embed-worker.ts", import.meta.url)');
    expect(rewriteUrls(code, file)).toContain('new URL("./embed-worker.mjs", import.meta.url)');
  });

  it("leaves other URLs alone", () => {
    for (const code of [
      'new URL(".", import.meta.url)',
      'new URL("../../faces/cli.ts", import.meta.url)',
      'new URL("https://example.com/x")',
      'new URL("../../../package.json", base)',
    ])
      expect(rewriteUrls(code, src("core", "claude", "run.ts"))).toBe(code);
  });
});

describe("release: node runtime", () => {
  it("finds the win-x64 zip of the wanted major in SHASUMS256.txt", () => {
    const text = [
      `${"a".repeat(64)}  node-v26.2.0-darwin-arm64.tar.gz`,
      `${"b".repeat(64)}  node-v26.2.0-win-x64.zip`,
      `${"c".repeat(64)}  node-v26.2.0-win-x64.7z`,
    ].join("\n");
    expect(parseShasums(text, 26)).toEqual({
      sha256: "b".repeat(64),
      file: "node-v26.2.0-win-x64.zip",
      version: "v26.2.0",
    });
    expect(parseShasums(text, 24)).toBeNull();
  });

  it("writes a shim that turns the env proxy on and runs the bundle with the bundled node", () => {
    const cmd = windowsText(join(ROOT, "scripts", "testimus.cmd"));
    expect(cmd).toContain('set "NODE_USE_ENV_PROXY=1"');
    expect(cmd).toContain('"%~dp0node\\node.exe" "%~dp0app\\testimus.mjs" %*');
    expect(cmd).toMatch(/\r\n/);
    expect(cmd).not.toMatch(/[^\r]\n/);
    expect(windowsText(join(ROOT, "scripts", "install.ps1"))).not.toMatch(/[^\r]\n/);
  });
});

describe("release: externals", () => {
  it("keeps only win32-x64 binaries and runtime files", () => {
    expect(keepFile("onnxruntime-node", "bin/napi-v6/win32/x64/onnxruntime_binding.node")).toBe(true);
    expect(keepFile("onnxruntime-node", "bin/napi-v6/linux/x64/libonnxruntime.so")).toBe(false);
    expect(keepFile("onnxruntime-node", "bin/napi-v6/win32/arm64/onnxruntime.dll")).toBe(false);
    expect(keepFile("onnxruntime-node", "dist/index.js")).toBe(true);
    expect(keepFile("onnxruntime-node", "bin", true)).toBe(true);
    expect(keepFile("onnxruntime-node", "bin/napi-v6/win32", true)).toBe(true);
    expect(keepFile("onnxruntime-node", "bin/napi-v6/linux", true)).toBe(false);
    expect(keepFile("@huggingface/transformers", "dist", true)).toBe(true);
    expect(keepFile("@huggingface/transformers", "src", true)).toBe(false);
    expect(keepFile("pdfjs-dist", "web", true)).toBe(false);
    expect(keepFile("pdfjs-dist", "legacy/build/pdf.mjs")).toBe(true);
    expect(keepFile("onnxruntime-node", "script/install.js")).toBe(false);
    expect(keepFile("@huggingface/transformers", "dist/transformers.node.mjs")).toBe(true);
    expect(keepFile("@huggingface/transformers", "dist/transformers.web.js")).toBe(false);
    expect(keepFile("sqlite-vec", "index.mjs.map")).toBe(false);
    expect(keepFile("sqlite-vec", "README.md")).toBe(false);
  });

  it("collects the externals and their installed dependencies, without install-time ones", () => {
    const all = dependencyClosure(join(ROOT, "node_modules"), EXTERNALS);
    for (const e of ["sqlite-vec", "onnxruntime-node", "onnxruntime-common", "sharp"]) expect(all).toContain(e);
    const os = process.platform === "win32" ? "windows" : process.platform;
    expect(all).toContain(`sqlite-vec-${os}-${process.arch}`);
    expect(all).not.toContain("onnxruntime-web");
    expect(all).not.toContain("global-agent");
  });
});

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "testimus-release-test-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function fakeFetch(body: Uint8Array<ArrayBuffer>, calls: string[] = [], status = 200): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(status === 200 ? body : null, { status });
  }) as typeof fetch;
}

describe("release: Electron runtime", () => {
  it("is the version pinned in package.json, the same as node_modules/electron", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const installed = JSON.parse(readFileSync(join(ROOT, "node_modules", "electron", "package.json"), "utf8"));
    expect(pinnedElectron()).toBe(pkg.devDependencies.electron);
    expect(pinnedElectron()).toBe(installed.version);
    expect(pinnedElectron()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("refuses a range or an installed Electron that differs from the pin", () => {
    const root = temp();
    const write = (pin: string, installed: string | null) => {
      writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { electron: pin } }));
      rmSync(join(root, "node_modules"), { recursive: true, force: true });
      if (installed === null) return;
      mkdirSync(join(root, "node_modules", "electron"), { recursive: true });
      writeFileSync(join(root, "node_modules", "electron", "package.json"), JSON.stringify({ version: installed }));
    };
    write("45.2.1", "45.2.1");
    expect(pinnedElectron(root)).toBe("45.2.1");
    write("^45.2.1", "45.2.1");
    expect(() => pinnedElectron(root)).toThrow(/exact version/);
    write("45.2.1", "45.3.0");
    expect(() => pinnedElectron(root)).toThrow(/node_modules\/electron is 45\.3\.0 but package\.json pins 45\.2\.1/);
    write("45.2.1", null);
    expect(() => pinnedElectron(root)).toThrow(/missing/);
  });

  it("finds the win32-x64 zip of that version in Electron's SHASUMS256.txt", () => {
    const text = [
      `${"a".repeat(64)} *chromedriver-v45.2.1-win32-x64.zip`,
      `${"b".repeat(64)} *electron-v45.2.1-win32-x64.zip`,
      `${"c".repeat(64)} *electron-v45.2.1-win32-x64-pdb.zip`,
      `${"d".repeat(64)} *electron-v45.2.1-win32-arm64.zip`,
      `${"e".repeat(64)} *electron-v45.2.10-win32-x64.zip`,
    ].join("\r\n");
    expect(electronZip("45.2.1")).toBe("electron-v45.2.1-win32-x64.zip");
    expect(parseElectronShasums(text, "45.2.1")).toBe("b".repeat(64));
    expect(parseElectronShasums(text, "45.2.10")).toBe("e".repeat(64));
    expect(parseElectronShasums(text, "45.2.2")).toBeNull();
    expect(parseElectronShasums(`${"f".repeat(64)}  electron-v45.2.1-win32-x64.zip`, "45.2.1")).toBe("f".repeat(64));
  });

  it("agrees with the checksum npm's electron package pins", () => {
    const sums = JSON.parse(readFileSync(join(ROOT, "node_modules", "electron", "checksums.json"), "utf8"));
    expect(sums[electronZip(pinnedElectron())]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps two locales and drops the default app", () => {
    expect(LOCALES).toEqual(["en-US.pak", "fr.pak"]);
    expect(keepElectronFile("locales/en-US.pak")).toBe(true);
    expect(keepElectronFile("locales/fr.pak")).toBe(true);
    expect(keepElectronFile("locales/de.pak")).toBe(false);
    expect(keepElectronFile("locales/fr-CA.pak")).toBe(false);
    expect(keepElectronFile("locales")).toBe(true);
    expect(keepElectronFile("resources/default_app.asar")).toBe(false);
    expect(keepElectronFile("resources")).toBe(true);
    expect(keepElectronFile("ffmpeg.dll")).toBe(true);
  });

  it("packs the shell with a package.json whose main is main.mjs", () => {
    expect(JSON.parse(shellPackageJson("0.1.0"))).toEqual({
      name: "testimus",
      productName: "Testimus",
      version: "0.1.0",
      private: true,
      main: "main.mjs",
    });
  });
});

describe("release: downloads are checked against SHA-256", () => {
  const body = new TextEncoder().encode("the real zip");

  it("downloads once, then reuses the cached file while it matches", async () => {
    const file = join(temp(), "cache", "electron.zip");
    const calls: string[] = [];
    await download("https://example.test/electron.zip", file, sha(body), fakeFetch(body, calls));
    expect(readFileSync(file, "utf8")).toBe("the real zip");
    await download("https://example.test/electron.zip", file, sha(body), fakeFetch(body, calls));
    expect(calls).toEqual(["https://example.test/electron.zip"]);
  });

  it("downloads again over a cached file that does not match", async () => {
    const file = join(temp(), "electron.zip");
    writeFileSync(file, "a truncated download");
    const calls: string[] = [];
    await download("https://example.test/electron.zip", file, sha(body), fakeFetch(body, calls));
    expect(calls).toHaveLength(1);
    expect(readFileSync(file, "utf8")).toBe("the real zip");
  });

  it("fails on a file whose SHA-256 differs and leaves nothing behind", async () => {
    const file = join(temp(), "electron.zip");
    const fake = new TextEncoder().encode("a fake zip");
    await expect(download("https://example.test/electron.zip", file, sha(body), fakeFetch(fake))).rejects.toThrow(
      /SHA-256 does not match SHASUMS256\.txt/,
    );
    expect(existsSync(file)).toBe(false);
  });

  it("fails on an HTTP error", async () => {
    const file = join(temp(), "electron.zip");
    await expect(
      download("https://example.test/electron.zip", file, sha(body), fakeFetch(body, [], 404)),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("release: layout", () => {
  function fakeRelease(): string {
    const out = temp();
    for (const f of LAYOUT) {
      const p = join(out, f);
      mkdirSync(dirname(p), { recursive: true });
      if (/\.[a-z]+$/i.test(f) || f === "LICENSE") writeFileSync(p, "");
      else mkdirSync(p, { recursive: true });
    }
    return out;
  }

  it("lists the desktop shell beside the core", () => {
    for (const f of [
      "Testimus.exe",
      "resources/app.asar",
      "locales/en-US.pak",
      "locales/fr.pak",
      "node/node.exe",
      "app/testimus.mjs",
      "app/embed-worker.mjs",
      "models",
      "testimus.cmd",
      "install.ps1",
      "README.txt",
    ])
      expect(LAYOUT).toContain(f);
  });

  it("reports what is missing or should not be there", () => {
    const out = fakeRelease();
    expect(layoutProblems(out)).toEqual([]);
    rmSync(join(out, "resources", "app.asar"));
    writeFileSync(join(out, "electron.exe"), "");
    writeFileSync(join(out, "locales", "de.pak"), "");
    mkdirSync(join(out, "resources"), { recursive: true });
    writeFileSync(join(out, "resources", "default_app.asar"), "");
    expect(layoutProblems(out)).toEqual([
      "missing resources/app.asar",
      "unexpected electron.exe",
      "unexpected resources/default_app.asar",
      "unexpected locales/de.pak",
    ]);
  });
});

describe("install.ps1", () => {
  const ps = readFileSync(join(ROOT, "scripts", "install.ps1"), "utf8");

  it("has the desktop switches and stays ASCII for Windows PowerShell 5.1", () => {
    for (const p of ["$NoDesktop", "[string]$ShortcutDir", "$NoShortcut", "$NoPath", "$NoSetup", "$NoPrompt", "$Root"])
      expect(ps).toContain(p);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(ps)).toBe(true);
  });

  it("unblocks the copied release and writes both shortcuts", () => {
    expect(ps).toMatch(/Get-ChildItem -LiteralPath \$dest -Recurse -File \| Unblock-File/);
    expect(ps).toContain('"Testimus (browser).lnk"');
    expect(ps).toContain('Join-Path $dest "Testimus.exe"');
    expect(ps).toContain('$lnk.Arguments = "serve"');
  });
});
