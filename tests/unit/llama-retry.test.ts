import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/core/env.ts";
import { type LlamaServer, serverPost } from "../../src/core/rag/runtimes/llama-server.ts";

const realHttp = env.http;
afterEach(() => {
  env.http = realHttp;
});

const server = () =>
  ({ model: "m.gguf", url: "http://127.0.0.1:1", apiKey: "k", busy: 0, lastUsed: 0 }) as unknown as LlamaServer;

describe("llama-server requests", () => {
  it("retry a local connection reset twice, then succeed", async () => {
    let calls = 0;
    env.http = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("fetch failed"), { cause: new Error("read ECONNRESET") });
      return { status: 200, headers: {}, text: '{"ok":1}' };
    };
    await expect(serverPost(server(), "/v1/rerank", {})).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(3);
  });

  it("give up after the third reset, and never retry another error", async () => {
    let calls = 0;
    env.http = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    await expect(serverPost(server(), "/v1/rerank", {})).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3);
    calls = 0;
    env.http = async () => {
      calls++;
      throw new Error("The operation was aborted due to timeout");
    };
    await expect(serverPost(server(), "/v1/rerank", {})).rejects.toThrow(/timeout/);
    expect(calls).toBe(1);
  });
});
