import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import {
  downloadDeps,
  downloadFile,
  filesFor,
  hashFile,
  hfUrl,
  pullFiles,
} from "../../../../src/core/lib/models-download.ts";
import { NO_DIR } from "../../../../src/core/lib/models-install.ts";
import { pull } from "../../../../src/core/lib/models-install-pull.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { readSettings, writeSettings } from "../../../../src/core/lib/project.ts";
import type { CatalogEntry, MachineProfile } from "../../../../src/core/types.ts";

const saved = { ...downloadDeps };
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b: Buffer) =>
  `git:${createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]))
    .digest("hex")}`;

const BODY = Buffer.from("x".repeat(70000) + "end");
const SMALL = Buffer.from('{"model_type":"tiny"}');
const REV = "0123456789abcdef0123456789abcdef01234567";

type Served = Record<string, Buffer>;
let requests: { url: string; range?: string }[] = [];

function serve(files: Served, opts: { failAfter?: number; ignoreRange?: boolean; abort?: AbortController } = {}) {
  requests = [];
  downloadDeps.fetch = async (url, init) => {
    const range = (init.headers as Record<string, string> | undefined)?.Range;
    requests.push({ url, range });
    const path = decodeURIComponent(url.split(`/resolve/${REV}/`)[1] ?? "");
    const body = files[path];
    if (!body) return new Response("missing", { status: 404 });
    const from = range && !opts.ignoreRange ? Number(range.replace(/^bytes=(\d+)-$/, "$1")) : 0;
    const slice = body.subarray(from);
    const chunks = [slice.subarray(0, 32768), slice.subarray(32768)];
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (step++ === 0) {
          c.enqueue(new Uint8Array(chunks[0]));
          return;
        }
        if (opts.abort) {
          await new Promise((r) => setTimeout(r, 50));
          opts.abort.abort();
          c.error(new Error("aborted"));
          return;
        }
        if (chunks[1].length) c.enqueue(new Uint8Array(chunks[1]));
        c.close();
      },
    });
    return new Response(stream, { status: from ? 206 : 200 });
  };
}

function ggufEntry(id: string, body: Buffer, sha = sha256(body)): CatalogEntry {
  return {
    id,
    kind: "embedding",
    label: `Tiny ${id}`,
    family: "tiny",
    licence: "MIT",
    commercialUse: true,
    runtimes: ["llamacpp"],
    source: {
      hf: { repo: "acme/Tiny-GGUF", revision: REV, path: `${id}.gguf` },
      file: { sha256: sha, size: body.length },
    },
    quantization: "Q8_0",
    dims: 8,
    maxInputTokens: 512,
    queryInstruction: "",
    docInstruction: "",
    size: { downloadMB: 1, ramMB: 1, vramMB: 1 },
    devices: ["gpu", "cpu"],
    tier: "light",
  };
}

function onnxEntry(): CatalogEntry {
  return {
    ...ggufEntry("tiny-onnx", BODY),
    runtimes: ["transformers"],
    source: {
      hf: {
        repo: "acme/tiny-onnx",
        revision: REV,
        files: [
          { path: "config.json", sha256: gitBlob(SMALL), size: SMALL.length },
          { path: "tokenizer.json", sha256: sha256(SMALL), size: SMALL.length },
          { path: "onnx/model_quantized.onnx", sha256: sha256(BODY), size: BODY.length },
          { path: "onnx/model_fp16.onnx", sha256: sha256(BODY), size: BODY.length },
        ],
      },
    },
    dtypeByDevice: { cpu: "q8" },
  };
}

const CPU_ONLY: MachineProfile = {
  at: new Date().toISOString(),
  ramTotalMB: 16000,
  ramFreeMB: 8000,
  cpu: { model: "test", threads: 8 },
  gpus: [],
  drives: [],
  loaded: [],
};

let dir: string;
beforeEach(() => {
  rmSync(registryFile(), { force: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-dl-"));
  downloadDeps.freeMB = () => 1e9;
  pinMachineProfile(CPU_ONLY);
});
afterEach(() => {
  Object.assign(downloadDeps, saved);
  pinMachineProfile(null);
});

describe("downloadFile", () => {
  const f = { path: "m.gguf", sha256: sha256(BODY), size: BODY.length };

  it("writes <name>.part, checks the SHA-256, then renames", async () => {
    serve({ "m.gguf": BODY });
    let seen = 0;
    const dest = join(dir, "m.gguf");
    const r = await downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
      signal: new AbortController().signal,
      onBytes: (n) => {
        seen += n;
      },
    });
    expect(r).toBe("downloaded");
    expect(readFileSync(dest).equals(BODY)).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(seen).toBe(BODY.length);
    expect(requests[0].url).toBe(`https://huggingface.co/acme/x/resolve/${REV}/m.gguf`);
    const again = await downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect(again).toBe("present");
    expect(requests).toHaveLength(1);
  });

  it("deletes the file and fails on a checksum mismatch", async () => {
    serve({ "m.gguf": Buffer.from(`${BODY.toString()}!`.slice(1)) });
    const dest = join(dir, "m.gguf");
    await expect(
      downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
        signal: new AbortController().signal,
        onBytes: () => {},
      }),
    ).rejects.toThrow(/does not match its published checksum.*deleted/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("resumes a .part with a Range request", async () => {
    serve({ "m.gguf": BODY });
    const dest = join(dir, "m.gguf");
    writeFileSync(`${dest}.part`, BODY.subarray(0, 40000));
    await downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect(requests[0].range).toBe("bytes=40000-");
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("restarts from zero when the server ignores the Range", async () => {
    serve({ "m.gguf": BODY }, { ignoreRange: true });
    const dest = join(dir, "m.gguf");
    writeFileSync(`${dest}.part`, BODY.subarray(0, 1000));
    await downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("keeps the .part on cancel, so the next run resumes", async () => {
    const ctrl = new AbortController();
    serve({ "m.gguf": BODY }, { abort: ctrl });
    const dest = join(dir, "m.gguf");
    await expect(
      downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, { signal: ctrl.signal, onBytes: () => {} }),
    ).rejects.toThrow(/cancelled/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(true);
    serve({ "m.gguf": BODY });
    await downloadFile(hfUrl("acme/x", REV, "m.gguf"), dest, f, {
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect(requests[0].range).toMatch(/^bytes=\d+-$/);
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("checks a small non-LFS file by its git blob id (D-07)", async () => {
    serve({ "config.json": SMALL });
    const dest = join(dir, "config.json");
    const g = { path: "config.json", sha256: gitBlob(SMALL), size: SMALL.length };
    await downloadFile(hfUrl("acme/x", REV, "config.json"), dest, g, {
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect((await hashFile(dest)).git).toBe(g.sha256);
    serve({ "config.json": Buffer.from('{"model_type":"tinz"}') });
    await expect(
      downloadFile(hfUrl("acme/x", REV, "config.json"), join(dir, "c2.json"), g, {
        signal: new AbortController().signal,
        onBytes: () => {},
      }),
    ).rejects.toThrow(/git:/);
  });
});

describe("pullFiles", () => {
  it("fetches only the files of the chosen dtype, in the transformers layout", async () => {
    const e = onnxEntry();
    expect(filesFor(e, "q8").map((f) => f.path)).toEqual([
      "config.json",
      "tokenizer.json",
      "onnx/model_quantized.onnx",
    ]);
    serve({ "config.json": SMALL, "tokenizer.json": SMALL, "onnx/model_quantized.onnx": BODY });
    let last = 0;
    const r = await pullFiles(e, dir, {
      dtype: "q8",
      signal: new AbortController().signal,
      onProgress: (d, t) => {
        last = d / t;
      },
    });
    expect(r.path).toBe(join(dir, "acme", "tiny-onnx"));
    expect(existsSync(join(r.path, "onnx", "model_quantized.onnx"))).toBe(true);
    expect(existsSync(join(r.path, "onnx", "model_fp16.onnx"))).toBe(false);
    expect(last).toBe(1);
  });

  it("refuses when the drive has less than 1.2 × the size, with the numbers", async () => {
    downloadDeps.freeMB = () => 0.05;
    await expect(
      pullFiles(ggufEntry("big", BODY), dir, { signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow(/Not enough space .*GB free, .*GB needed \(1\.2 ×/);
  });
});

describe("models.pull", () => {
  function withEntries(...entries: CatalogEntry[]) {
    writeRegistry({ ...readRegistry(), catalog: entries });
  }

  it("stops before any download when the models folder is not chosen (P6)", async () => {
    withEntries(ggufEntry("tiny", BODY));
    serve({ "tiny.gguf": BODY });
    await expect(pull(quietCtx(null), { model: "tiny" })).rejects.toThrow(NO_DIR);
    expect(requests).toEqual([]);
    await expect(invoke("models.pull", { model: "tiny" }, { project: null, wait: true })).rejects.toThrow(
      /Choose where models are stored: `testimus models setDir <folder>`/,
    );
  });

  it("with --dir: sets the folder, downloads, registers the installation", async () => {
    withEntries(ggufEntry("tiny", BODY));
    serve({ "tiny.gguf": BODY });
    const models = join(dir, "models");
    const r = (await invoke("models.pull", { model: "tiny", dir: models }, { project: null, wait: true })) as {
      where: string;
      via: string;
    };
    expect(r.via).toBe("download");
    expect(r.where).toBe(join(models, "acme", "Tiny-GGUF", "tiny.gguf"));
    const reg = readRegistry();
    expect(reg.dir).toBe(models);
    expect(reg.installs).toEqual([
      expect.objectContaining({
        model: "tiny",
        via: "download",
        runtime: "llamacpp",
        path: r.where,
        status: "installed",
      }),
    ]);
    const again = (await invoke("models.pull", { model: "tiny" }, { project: null, wait: true })) as { where: string };
    expect(again.where).toBe(r.where);
    expect(requests).toHaveLength(1);
  });

  it("a second pull of the same model waits for the first; cancelling a wait stops only that one", async () => {
    withEntries(ggufEntry("tiny", BODY));
    writeRegistry({ ...readRegistry(), dir });
    serve({ "tiny.gguf": BODY });
    const first = pull(quietCtx(null), { model: "tiny" });
    const ctrl = new AbortController();
    const gone = pull(quietCtx(null, ctrl.signal), { model: "tiny" });
    ctrl.abort(new Error("cancelled"));
    await expect(gone).rejects.toThrow("cancelled");
    await expect(pull(quietCtx(null, ctrl.signal), { model: "tiny" })).rejects.toThrow("cancelled");
    const second = pull(quietCtx(null), { model: "tiny" });
    const r = await first;
    expect(r.via).toBe("download");
    expect((await second).where).toBe(r.where);
    expect(requests).toHaveLength(1);
  });

  it("refuses when downloads are off", async () => {
    withEntries(ggufEntry("tiny", BODY));
    writeRegistry({ ...readRegistry(), dir });
    writeSettings({ ...readSettings(), models: { allowRemote: false } });
    onTestFinished(() => writeSettings({ ...readSettings(), models: { allowRemote: true } }));
    await expect(pull(quietCtx(null), { model: "tiny" })).rejects.toThrow(/downloads are off/);
  });

  it("a failed checksum fails the job and registers nothing", async () => {
    withEntries(ggufEntry("tiny", BODY, sha256(Buffer.from("other"))));
    writeRegistry({ ...readRegistry(), dir });
    serve({ "tiny.gguf": BODY });
    await expect(invoke("models.pull", { model: "tiny" }, { project: null, wait: true })).rejects.toThrow(/checksum/);
    expect(readRegistry().installs).toEqual([]);
    expect(existsSync(join(dir, "acme", "Tiny-GGUF", "tiny.gguf"))).toBe(false);
  });
});
