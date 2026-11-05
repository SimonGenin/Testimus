// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { useRunningJobs } from "../../../../src/ui/components/shell/Activity.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { apply } from "../../../../src/ui/lib/data/events.ts";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";

const running = (id: string): Job =>
  ({ id, kind: "generate", subject: "s", status: "running", startedAt: "2026-11-05T10:00:00Z" }) as Job;

let answer: Job[] = [];

beforeEach(() => {
  setProject("/p");
  answer = [running("j1")];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("the quiet running jobs stay the same list while a job only moves, and change when one starts", async () => {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let quietRenders = 0;
  const quiet = renderHook(
    () => {
      quietRenders++;
      return useRunningJobs({ quiet: true });
    },
    { wrapper },
  );
  const loud = renderHook(() => useRunningJobs(), { wrapper });
  await waitFor(() => expect(quiet.result.current.map((j) => j.id)).toEqual(["j1"]));
  const first = quiet.result.current;
  const seen = quietRenders;

  act(() => {
    for (let n = 1; n <= 20; n++)
      apply(client, {
        jobId: "j1",
        at: "x",
        type: "progress",
        message: `Writing test ${n}`,
        done: n,
        total: 20,
        project: "/p",
      });
    apply(client, {
      jobId: "j1",
      at: "x",
      type: "claude",
      event: { type: "text", text: "I read the section" },
      project: "/p",
    });
  });
  await waitFor(() => expect(loud.result.current[0].message).toBe("Writing test 20"));
  expect(quiet.result.current).toBe(first);
  expect(quiet.result.current[0].message).toBeUndefined();
  expect(quietRenders).toBe(seen);

  answer = [running("j1"), running("j2")];
  act(() => apply(client, { jobId: "j2", at: "x", type: "status", job: running("j2"), project: "/p" }));
  await waitFor(() => expect(quiet.result.current.map((j) => j.id).sort()).toEqual(["j1", "j2"]));
});
