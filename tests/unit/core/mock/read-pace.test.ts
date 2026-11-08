import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { readPace } from "../../../../src/core/mock/index.ts";
import { call, fixtureCopy } from "../registry.ts";

const plain = env.readMs;
afterEach(() => {
  env.readMs = plain;
});

describe("TESTIMUS_MOCK_READ_MS: a read that answers late on purpose", () => {
  it("names reads and their delay, comma-separated; anything else is ignored", () => {
    expect([...readPace(" tests.list=120 , docs.show=0,bad,docs.list=x,jobs.list=40")]).toEqual([
      ["tests.list", 120],
      ["jobs.list", 40],
    ]);
    expect(readPace("").size).toBe(0);
  });

  it("holds the read that long, and lets a cancelled request go at once", async () => {
    const P = fixtureCopy("read-pace");
    env.readMs = (name) => (name === "project.info" ? 300 : 0);
    const t = Date.now();
    await call("project.info", {}, P);
    expect(Date.now() - t).toBeGreaterThanOrEqual(290);
    const gone = new AbortController();
    const asked = call("project.info", {}, P, { signal: gone.signal });
    gone.abort();
    await expect(asked).rejects.toThrow();
  });
});
