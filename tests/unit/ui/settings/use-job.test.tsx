// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import { useJob } from "../../../../src/ui/screens/settings/jobs.ts";

const heard: Record<string, (e: JobEvent) => void> = {};

vi.mock("../../../../src/ui/lib/data/events.ts", () => ({
  useJobEvents: (jobId: string | null | undefined, fn: (e: JobEvent) => void) => {
    if (jobId) heard[jobId] = fn;
  },
}));
vi.mock("../../../../src/ui/lib/data/query.ts", () => ({
  execute: vi.fn(),
  useRead: () => ({ data: undefined }),
}));

afterEach(cleanup);

describe("useJob", () => {
  it("forgets the last job's progress when it follows another job", () => {
    const { result, rerender } = renderHook(({ id }) => useJob(id), { initialProps: { id: "a" } });
    act(() => heard.a({ type: "progress", jobId: "a", message: "Downloading bge-m3", done: 1, total: 2 } as JobEvent));
    expect(result.current.live).toEqual({ message: "Downloading bge-m3", pct: 50 });
    rerender({ id: "b" });
    expect(result.current.live).toEqual({ message: "Starting", pct: null });
  });
});
