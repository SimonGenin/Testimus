import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelsDeps } from "../../src/core/commands/models.ts";
import { SHIPPED } from "../../src/core/lib/models-catalog.ts";
import { downloadDeps, hfUrl } from "../../src/core/lib/models-download.ts";
import { readPerf } from "../../src/core/lib/models-perf.ts";
import { readRegistry } from "../../src/core/lib/models-registry.ts";
import {
  fakeCatalog,
  fakeFetch,
  fakeSize,
  type MockModelsOptions,
  mockModelsOptions,
  setupModelsMock,
} from "../../src/core/mock/models.ts";
import { activeChoice, setActiveChoice } from "../../src/core/rag/activation.ts";
import { llamaIo } from "../../src/core/rag/runtimes/llamacpp.ts";
import type { CatalogEntry } from "../../src/core/types.ts";

const DEFAULTS: MockModelsOptions = {
  machine: "gpu16",
  llamacpp: "found",
  modelsDir: "set",
  advice: "upgrade",
  index: "vectors",
  downloadMs: 0,
};
const saved = {
  env: { ...process.env },
  fetch: downloadDeps.fetch,
  download: llamaIo.download,
  llama: modelsDeps.llama,
};
let project = "";

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "testimus-cov-mockm-p-"));
  writeFileSync(join(project, "project.json"), JSON.stringify({ name: "p" }));
  delete process.env.TESTIMUS_MACHINE;
});
afterEach(() => {
  process.env = { ...saved.env };
  downloadDeps.fetch = saved.fetch;
  llamaIo.download = saved.download;
  modelsDeps.llama = saved.llama;
});

const setup = (o: Partial<MockModelsOptions> = {}) =>
  setupModelsMock(mkdtempSync(join(tmpdir(), "testimus-cov-mockm-")), project, { ...DEFAULTS, ...o });

describe("mock options and catalog", () => {
  it("reads the TESTIMUS_MOCK_* variables, else the defaults", () => {
    expect(
      mockModelsOptions({
        TESTIMUS_MOCK_LLAMACPP: "absent",
        TESTIMUS_MOCK_MODELS_DIR: "unset",
        TESTIMUS_MOCK_ADVICE: "none",
        TESTIMUS_MOCK_INDEX: "bm25",
        TESTIMUS_MOCK_DOWNLOAD_MS: "-5",
      }),
    ).toMatchObject({ llamacpp: "absent", modelsDir: "unset", advice: "none", index: "bm25", downloadMs: 0 });
    expect(mockModelsOptions({})).toMatchObject({ llamacpp: "found", advice: "upgrade", downloadMs: 2500 });
  });

  it("keeps an entry without a hub source, and fakes the file list of one with files", () => {
    const base = SHIPPED.entries.find((e) => e.source.hf?.files?.length) as CatalogEntry;
    const bare = { ...base, id: "bare", source: {} } as CatalogEntry;
    const [kept, faked] = fakeCatalog([bare, base]);
    expect(kept).toBe(bare);
    expect(faked.source.hf?.files?.every((f) => f.size === fakeSize(f.size) || f.size <= 4 * 1024 * 1024)).toBe(true);
  });
});

describe("setupModelsMock", () => {
  it("no models folder with llama.cpp found: the build sits in a path folder; advice none seeds nothing", async () => {
    const m = await setup({ modelsDir: "unset", advice: "none" });
    expect(m.dir).toBeNull();
    const reg = readRegistry();
    expect(reg.llamacpp?.via).toBe("path");
    expect(reg.installs.find((i) => i.model === "bge-reranker-v2-m3-q8")?.via).toBe("path");
    expect(readPerf()).toEqual([]);
    expect(activeChoice(project)).toBeNull();
  });

  it("keeps a machine file already given and a choice already made", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "testimus-cov-mockm-m-")), "machine.json");
    writeFileSync(file, "{}");
    process.env.TESTIMUS_MACHINE = file;
    setActiveChoice(project, { pack: "quality" });
    await setup({ advice: "downgrade", llamacpp: "absent" });
    expect(process.env.TESTIMUS_MACHINE).toBe(file);
    expect(activeChoice(project)).toMatchObject({ pack: "quality" });
    expect(readRegistry().llamacpp).toBeUndefined();
  });

  it("serves the fake files: 404 for anything else, a range, a cancelled stream; no real llama.cpp download", async () => {
    await setup();
    expect((await fakeFetch("https://nowhere/x", {})).status).toBe(404);
    const e = fakeCatalog().find((x) => x.source.hf?.path && x.source.file) as CatalogEntry;
    const hf = e.source.hf as NonNullable<CatalogEntry["source"]["hf"]>;
    const url = hfUrl(hf.repo, hf.revision, hf.path as string);
    const part = await fakeFetch(url, { headers: { Range: "bytes=10-" } });
    expect(part.status).toBe(206);
    const ctl = new AbortController();
    ctl.abort();
    const cut = await fakeFetch(url, { signal: ctl.signal });
    await expect(cut.arrayBuffer()).rejects.toThrow(/aborted/);
    await expect(llamaIo.download("https://example/x", "y", () => {}, new AbortController().signal)).rejects.toThrow(
      /mock: no network/,
    );
  });

  it("the fake llama.cpp pull stops when cancelled", async () => {
    await setup();
    const llama = await modelsDeps.llama();
    const ctl = new AbortController();
    ctl.abort();
    const dir = mkdtempSync(join(tmpdir(), "testimus-cov-mockm-l-"));
    await expect(llama.pullLlamaBuild("cuda", dir, () => {}, ctl.signal)).rejects.toThrow(/cancelled/);
    expect(existsSync(join(dir, "llama-server.exe"))).toBe(false);
  });
});
