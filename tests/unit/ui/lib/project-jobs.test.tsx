// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { useProjectJobs } from "../../../../src/ui/lib/projectJobs.ts";
import { callsOf, dataWrapper, fakeEvents, fakeNet, job, net } from "../../helpers/ui-data.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["jobs.list"] = () => [job({ id: "a" })];
});

afterEach(() => {
  cleanup();
  setProject(null);
});

describe("useProjectJobs", () => {
  it("asks for no job while no project is open (the first run), and for the project's once one is", async () => {
    setProject(null);
    const none = renderHook(() => useProjectJobs([]), { wrapper: dataWrapper() });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(none.result.current).toEqual([]);
    expect(callsOf("jobs.list")).toHaveLength(0);
    none.unmount();
    setProject("C:\\p");
    const open = renderHook(() => useProjectJobs([]), { wrapper: dataWrapper() });
    await waitFor(() => expect(open.result.current.map((j) => j.id)).toEqual(["a"]));
  });
});
