import { describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async () => () => new Promise(() => {}),
}));

vi.mock("../../../../src/core/lib/models-registry.ts", async (original) => ({
  ...(await original<typeof import("../../../../src/core/lib/models-registry.ts")>()),
  installsOf: () => [{ path: "/models/onnx-community/whisper-small" }],
}));

const { videoIo } = await import("../../../../src/core/lib/video-io.ts");

describe("Whisper", () => {
  it("is let go at once when the conversion is cancelled while it listens", async () => {
    const stop = new AbortController();
    const heard = videoIo.transcribe(new Float32Array(16_000), "fr-FR", stop.signal);
    await new Promise((ok) => setImmediate(ok));
    stop.abort();
    await expect(heard).rejects.toThrow();
  });
});
