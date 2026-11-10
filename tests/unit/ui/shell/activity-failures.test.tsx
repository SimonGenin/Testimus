// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity } from "../../../../src/ui/components/shell/Activity.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { FakeES, fakeEvents, fakeNet, job, net, status } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const end = "2026-11-02T10:01:00.000Z";
const failed = (id: string, more = {}) =>
  job({ id, kind: "pull", subject: "LFRPS12", status: "failed", endedAt: end, error: "ETIMEDOUT", ...more });

describe("Activity › the job panel and the failures", () => {
  it("a running job's title opens it in the job panel and closes the list", async () => {
    net.routes["jobs.list"] = () => [job({ id: "a", kind: "pull", subject: "LFRPS12" })];
    const { state } = withData(<Activity />);
    fireEvent.click(await screen.findByRole("button", { name: "1 job running" }));
    const pop = screen.getByRole("dialog", { name: /^Running 1/ });
    expect(within(pop).queryByRole("button", { name: "Open Jobs" })).toBeNull();
    fireEvent.click(within(pop).getByRole("button", { name: /LFRPS12/ }));
    expect(state.openJob).toHaveBeenCalledWith("a");
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a job that failed in the top bar until it is opened or dismissed", async () => {
    net.routes["jobs.list"] = () => [];
    const { state } = withData(<Activity />);
    expect(screen.queryByRole("button", { name: /failed/ })).toBeNull();
    act(() => FakeES.emit(status(failed("f1"))));
    act(() => FakeES.emit(status(failed("f2", { kind: "push" }))));
    act(() => FakeES.emit(status(failed("t1", { kind: "actions.triage" }))));
    act(() => FakeES.emit(status(job({ id: "c1", status: "cancelled", endedAt: end }))));
    fireEvent.click(await screen.findByRole("button", { name: "2 failed" }));
    const pop = screen.getByRole("dialog", { name: /^Failed 2/ });
    expect(within(pop).getAllByText(/^Failed · A server did not answer$/)).toHaveLength(2);
    expect(within(pop).getByText(/Push to Jira/)).toBeInTheDocument();
    fireEvent.click(within(pop).getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.getByRole("dialog", { name: /^Failed 1/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Pull from Jira/ }));
    expect(state.openJob).toHaveBeenCalledWith("f1");
    expect(screen.queryByRole("button", { name: /failed/ })).toBeNull();
  });

  it("says the running and the failed together, a parent's failure standing for its children's", async () => {
    net.routes["jobs.list"] = () => [job({ id: "r1", kind: "check" })];
    withData(<Activity />);
    await screen.findByRole("button", { name: "1 job running" });
    act(() => FakeES.emit(status(failed("child", { parentId: "parent" }))));
    act(() => FakeES.emit(status(failed("other"))));
    act(() => FakeES.emit(status(failed("parent", { kind: "docs.convert" }))));
    fireEvent.click(await screen.findByRole("button", { name: "1 job running · 2 failed" }));
    const pop = screen.getByRole("dialog", { name: /^Running 1/ });
    expect(within(pop).getByText(/Convert document/)).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Dismiss the failures" }));
    expect(screen.getByRole("button", { name: "1 job running" })).toBeInTheDocument();
  });
});
