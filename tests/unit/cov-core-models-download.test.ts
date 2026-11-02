import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFile,
  checkSpace,
  downloadDeps,
  downloadFile,
  filesFor,
  freeMB,
  installPath,
  pullFiles,
} from "../../src/core/lib/models-download.ts";
import type { CatalogEntry } from "../../src/core/types.ts";

const saved = { ...downloadDeps };
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BODY = Buffer.from("y".repeat(5000));
const F = { path: "m.gguf", sha256: sha256(BODY), size: BODY.length };
const REV = "0123456789abcdef0123456789abcdef01234567";

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({
    id: "tiny",
    kind: "embedding",
    label: "Tiny",
    runtimes: ["llamacpp"],
    source: { hf: { repo: "acme/Tiny-GGUF", revision: REV, path: "m.gguf" }, file: { sha256: F.sha256, size: F.size } },
    dims: 8,
    size: { downloadMB: 1, ramMB: 1, vramMB: 1 },
    ...over,
  }) as CatalogEntry;

let dir = "";
const opts = (signal = new AbortController().signal) => ({ signal, onBytes: () => {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-dl-"));
  downloadDeps.freeMB = () => 1e9;
});
afterEach(() => {
  Object.assign(downloadDeps, saved);
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("freeMB and the default fetch", () => {
  it("climbs to an existing folder, and gives null when even the root is missing", () => {
    expect(freeMB(join(dir, "a", "b"))).toBeGreaterThan(0);
    const missing = [..."ZYXWVUTSRQPONMLKJIHGFE"].find((c) => !existsSync(`${c}:\\`));
    if (missing) expect(freeMB(`${missing}:\\nope\\nothing`)).toBeNull();
  });

  it("the default fetch is the global one", async () => {
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await downloadDeps.fetch("https://example.invalid/x", {});
    expect(f).toHaveBeenCalledWith("https://example.invalid/x", {});
  });
});

describe("entries without a Hugging Face source", () => {
  it("have no files, no install path and cannot be pulled", async () => {
    const e = entry({ source: {} as CatalogEntry["source"] });
    expect(filesFor(e)).toEqual([]);
    expect(() => installPath(dir, e)).toThrow(/no Hugging Face source/);
    await expect(pullFiles(e, dir, { signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow(
      /no Hugging Face source/,
    );
  });

  it("a repo without a files list has no files", () => {
    expect(filesFor(entry({ source: { hf: { repo: "a/b", revision: REV } } as CatalogEntry["source"] }))).toEqual([]);
  });
});

describe("checkFile", () => {
  it("is false for a missing file or another size", async () => {
    expect(await checkFile(join(dir, "none"), F)).toBe(false);
    writeFileSync(join(dir, "short"), "abc");
    expect(await checkFile(join(dir, "short"), F)).toBe(false);
  });
});

describe("downloadFile — failures and leftovers", () => {
  const dest = () => join(dir, "out", "m.gguf");

  it("a .part larger than the file is dropped and fetched again", async () => {
    mkdirSync(join(dir, "out"));
    writeFileSync(`${dest()}.part`, Buffer.alloc(F.size + 10));
    let range: string | undefined;
    downloadDeps.fetch = async (_u, init) => {
      range = (init.headers as Record<string, string>).Range;
      return new Response(BODY, { status: 200 });
    };
    expect(await downloadFile("u", dest(), F, opts())).toBe("downloaded");
    expect(range).toBeUndefined();
  });

  it("a complete .part is checked and renamed without fetching", async () => {
    mkdirSync(join(dir, "out"));
    writeFileSync(`${dest()}.part`, BODY);
    downloadDeps.fetch = async () => {
      throw new Error("must not fetch");
    };
    let bytes = 0;
    expect(
      await downloadFile(
        "u",
        dest(),
        F,
        { signal: new AbortController().signal, onBytes: (n) => (bytes += n) },
        downloadDeps,
      ),
    ).toBe("downloaded");
    expect(bytes).toBe(F.size);
  });

  it("a cancelled signal stops before the request", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(downloadFile("u", dest(), F, opts(ctl.signal))).rejects.toThrow(/Download cancelled/);
  });

  it("a network error is a download failure, or a cancel when the signal fired", async () => {
    downloadDeps.fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(downloadFile("u", dest(), F, opts())).rejects.toThrow(/m.gguf failed: ECONNRESET/);
    const ctl = new AbortController();
    downloadDeps.fetch = async () => {
      ctl.abort();
      throw new Error("aborted");
    };
    await expect(downloadFile("u", dest(), F, opts(ctl.signal))).rejects.toThrow(/Download cancelled/);
  });

  it("an HTTP error status and a body-less answer are refused", async () => {
    downloadDeps.fetch = async () => new Response("no", { status: 403 });
    await expect(downloadFile("u", dest(), F, opts())).rejects.toThrow(/HTTP 403/);
    downloadDeps.fetch = async () => new Response(null, { status: 200 });
    await expect(downloadFile("u", dest(), F, opts())).rejects.toThrow(/returned no data/);
  });

  it("a stream that breaks is a stopped download", async () => {
    downloadDeps.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.error(new Error("socket hang up"));
          },
        }),
        { status: 200 },
      );
    await expect(downloadFile("u", dest(), F, opts())).rejects.toThrow(/stopped: socket hang up/);
  });

  it("a short download names the sizes", async () => {
    downloadDeps.fetch = async () => new Response(BODY.subarray(0, 10), { status: 200 });
    await expect(downloadFile("u", dest(), F, opts())).rejects.toThrow(/10 bytes instead of 5000/);
    expect(existsSync(`${dest()}.part`)).toBe(false);
  });
});

describe("checkSpace and pullFiles", () => {
  it("unknown free space never refuses, and the message names the root", () => {
    expect(() => checkSpace(dir, 1e12, { ...downloadDeps, freeMB: () => null })).not.toThrow();
    expect(() => checkSpace("relative", 1e12, { ...downloadDeps, freeMB: () => 1 })).toThrow(
      /Not enough space on relative/,
    );
  });

  it("counts a file already in place as present", async () => {
    const root = join(dir, "acme", "Tiny-GGUF");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "m.gguf"), BODY);
    const r = await pullFiles(entry(), dir, { signal: new AbortController().signal, onProgress: () => {} });
    expect(r).toMatchObject({ downloaded: 0, present: 1, path: join(root, "m.gguf") });
  });
});
