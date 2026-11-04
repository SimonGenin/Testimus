// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";

const runs: string[] = [];
const releases: (() => void)[] = [];

vi.mock("../../../../src/ui/api.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/ui/api.ts")>();
  return {
    ...real,
    run: vi.fn(async (name: string, _input: Record<string, unknown>, onEvent?: (e: JobEvent) => void) => {
      runs.push(name);
      return await new Promise((r) => {
        releases.push(() => r({ chunks: 1 }));
        onEvent?.({ jobId: "j", at: "", type: "progress", message: "Embedding", done: 1, total: 2 });
      });
    }),
  };
});

const { reindexAll, useUploads } = await import("../../../../src/ui/lib/uploads.ts");

describe("reindex requests made while an index run is going", () => {
  it("all wait for it, then share the one run that follows", async () => {
    const h = renderHook(() => useUploads());
    const first = reindexAll(() => {});
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = reindexAll(() => {});
    const third = reindexAll(() => {});
    await vi.waitFor(() =>
      expect(h.result.current.filter((u) => u.message === "Waiting for the index run")).toHaveLength(2),
    );
    await act(async () => {
      releases[0]();
      await first;
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => {
      releases[1]();
      await Promise.all([second, third]);
    });
    expect(runs).toEqual(["rag.index", "rag.index"]);
    expect(h.result.current.filter((u) => u.name === "All documents").map((u) => u.phase)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });
});
