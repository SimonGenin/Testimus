// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { JobHistory } from "../../../../src/ui/components/jobs/JobHistory.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { whenLabel } from "../../../../src/ui/lib/jobs.ts";
import { HistoryCard } from "../../../../src/ui/screens/tests/editor/HistoryCard.tsx";
import { callsOf, FakeES, fakeEvents, fakeNet, job, net, status, withApp } from "../../helpers/ui-data.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  setProject(null);
});

const done = (o: Partial<Job>) => job({ status: "done", endedAt: "2026-11-02T10:01:00.000Z", ...o });

describe("the history of a test or a document", () => {
  it("lists the jobs about it, newest first, a parent standing back for its own job inside, each opening the panel", async () => {
    let list: Job[] = [
      done({ id: "chk", kind: "check", parentId: "conv", result: { tests: [{ id: "local-1", errors: 1 }] } }),
      done({ id: "conv", kind: "docs.convert", subject: "SPEC" }),
      done({ id: "gen", kind: "generate", result: { tests: ["local-1"] } }),
    ];
    net.routes["jobs.list"] = () => list;
    const { state } = withApp(<JobHistory about="tests/local-1" label="History" />);
    const box = await screen.findByRole("listbox", { name: "History" });
    await waitFor(() => expect(within(box).getAllByRole("option")).toHaveLength(2));
    expect(callsOf("jobs.list").map((c) => c.input)).toContainEqual({ about: "tests/local-1" });
    const [check, gen] = within(box).getAllByRole("option");
    expect(check).toHaveTextContent("Check tests");
    expect(check).toHaveTextContent("1 with findings");
    expect(gen).toHaveTextContent("Generate tests");
    expect(gen).toHaveTextContent("1 test written");
    expect(within(box).queryByText("Convert document")).toBeNull();
    fireEvent.click(gen);
    expect(state.openJob).toHaveBeenCalledWith("gen");

    act(() => FakeES.emit(status(job({ id: "elsewhere", kind: "pull" }))));
    expect(within(box).queryByText("Pull from Jira")).toBeNull();
    list = [job({ id: "fix", kind: "fix", subject: "local-1" }), ...list];
    act(() => FakeES.emit(status(job({ id: "fix", kind: "fix", subject: "local-1" }))));
    expect(await within(box).findByText("Claude fix")).toBeInTheDocument();
  });

  it("shows five, then the rest on demand, and says when there is nothing yet", async () => {
    net.routes["jobs.list"] = () => Array.from({ length: 7 }, (_, i) => done({ id: `c${i}`, kind: "check" }));
    withApp(<JobHistory about="docs/SPEC" label="History" />);
    const box = await screen.findByRole("listbox", { name: "History" });
    await waitFor(() => expect(within(box).getAllByRole("option")).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(within(box).getAllByRole("option")).toHaveLength(7);
    cleanup();
    net.routes["jobs.list"] = () => [];
    withApp(<JobHistory about="docs/SPEC" label="History" />);
    expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
  });

  it("a test's history is folded under its steps and read only once opened", async () => {
    net.routes["jobs.list"] = () => [done({ id: "gen", kind: "generate" })];
    withApp(<HistoryCard testId="local-1" />);
    const card = screen.getByRole("region", { name: "History of the test" });
    expect(callsOf("jobs.list")).toHaveLength(0);
    fireEvent.click(within(card).getByRole("button", { name: /History/ }));
    expect(await within(card).findByText("Generate tests")).toBeInTheDocument();
    expect(callsOf("jobs.list")[0]?.input).toEqual({ about: "tests/local-1" });
  });

  it("says when a job started in words", () => {
    const now = new Date(2026, 10, 10, 15, 0).getTime();
    expect(whenLabel(new Date(2026, 10, 10, 9, 5).toISOString(), now)).toBe("Today 09:05");
    expect(whenLabel(new Date(2026, 10, 9, 23, 30).toISOString(), now)).toBe("Yesterday 23:30");
    expect(whenLabel(new Date(2026, 9, 2, 8, 0).toISOString(), now)).toBe("2 Oct 08:00");
    expect(whenLabel("not a date", now)).toBe("");
  });
});
