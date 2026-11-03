import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPerf } from "../../../../src/core/lib/models-perf.ts";
import { readRegistry } from "../../../../src/core/lib/models-registry.ts";
import { mockModelsOptions, setupModelsMock } from "../../../../src/core/mock/models.ts";
import { call } from "../registry.ts";

const MODEL = "qwen3-embedding-0.6b-onnx-q8";

async function sandbox(probe: string | undefined) {
  delete process.env.TESTIMUS_MACHINE;
  const env = { TESTIMUS_MOCK_DOWNLOAD_MS: "30", ...(probe ? { TESTIMUS_MOCK_PROBE: probe } : {}) };
  const root = mkdtempSync(join(tmpdir(), "testimus-mock-probe-"));
  return setupModelsMock(root, null, mockModelsOptions(env));
}

const loads = () => readPerf().filter((l) => l.op === "model.load" && l.model === MODEL);
const statusOf = () => readRegistry().installs.find((i) => i.model === MODEL)?.status;

type Verified = { model: string; ok: boolean; dims: number; message: string };

describe("serve --mock: TESTIMUS_MOCK_PROBE", () => {
  it("reads ok by default and fail when asked; anything else is ok", () => {
    expect(mockModelsOptions({}).probe).toBe("ok");
    expect(mockModelsOptions({ TESTIMUS_MOCK_PROBE: "fail" }).probe).toBe("fail");
    expect(mockModelsOptions({ TESTIMUS_MOCK_PROBE: "maybe" }).probe).toBe("ok");
  });

  it("ok: a probe answers like a load on this machine, journalled as a model.load line", async () => {
    await sandbox(undefined);
    expect(statusOf()).toBe("installed");
    const before = loads().length;
    const out = await call<Verified>("models.verify", { model: MODEL }, null);
    expect(out).toMatchObject({ model: MODEL, ok: true });
    expect(out.dims).toBeGreaterThan(0);
    expect(statusOf()).toBe("verified");
    expect(loads().length).toBe(before + 1);
  });

  it("fail: the model does not run here — the probe says so, it stays unverified and nothing is journalled", async () => {
    await sandbox("fail");
    const before = loads().length;
    const out = await call<Verified>("models.verify", { model: MODEL }, null);
    expect(out).toMatchObject({ model: MODEL, ok: false });
    expect(out.message).toMatch(/cannot load this model here \(TESTIMUS_MOCK_PROBE=fail\)/);
    expect(statusOf()).toBe("installed");
    expect(loads().length).toBe(before);
  });
});
