// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, setProject } from "../../src/ui/api.ts";
import { CommandForm } from "../../src/ui/components/shell/CommandForm.tsx";
import { useJob } from "../../src/ui/components/shell/JobLog.tsx";
import { ProjectButton } from "../../src/ui/components/shell/ProjectButton.tsx";
import { baseName } from "../../src/ui/lib/desktop.ts";
import { useDoctor } from "../../src/ui/lib/doctor.ts";
import { useToasts } from "../../src/ui/lib/toast.ts";
import { JobsScreen } from "../../src/ui/screens/jobs/JobsScreen.tsx";
import { callsOf, deferred, FakeES, fakeEvents, fakeNet, job, net, withApp } from "./cov-uishell-helpers.tsx";

function Stores() {
  const d = useDoctor();
  const t = useToasts();
  return (
    <p>
      {d.checks.length}/{t.length}
    </p>
  );
}

function P() {
  const r = useJob("j1");
  return <span data-testid="n">{r.events.length}</span>;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("small remaining paths", () => {
  it("sends {} for a null input", async () => {
    net.routes["a.b"] = (i) => i;
    expect(await call("a.b", null)).toEqual({});
  });

  it("keeps a path with no name part as it is", () => {
    expect(baseName("\\\\")).toBe("\\\\");
    expect(baseName("")).toBe("");
  });

  it("serves the stores' snapshots on the server too", () => {
    expect(renderToString(<Stores />)).toBe("<p>0<!-- -->/<!-- -->0</p>");
  });
});

describe("shell remaining paths", () => {
  it("shows an error instead of failing on a command without an input schema", async () => {
    render(
      <CommandForm
        command={{ name: "a.b", summary: "s", mutates: false, job: false, input: undefined as never }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callsOf("a.b")).toHaveLength(0);
  });

  it("reads a job back that has no log yet", async () => {
    net.routes["jobs.show"] = () => null;
    render(<P />);
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    expect(screen.getByTestId("n")).toHaveTextContent("0");
  });

  it("accepts a project list it does not understand", async () => {
    net.routes["project.list"] = () => null;
    withApp(<ProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: /change project/ }));
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(1));
    expect(screen.getByRole("menuitem", { name: "No other project known yet" })).toBeInTheDocument();
  });

  it("shows a count without a message, and keeps progress that lands before the list", async () => {
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return [job({ id: "g1", progress: { done: 1, total: 3 } })];
    };
    net.routes["jobs.show"] = () => null;
    withApp(<JobsScreen />, { route: { screen: "jobs" } });
    act(() => FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "early", done: 1, total: 3 }));
    await act(async () => gate.resolve(null));
    const list = await screen.findByRole("region", { name: "Job list" });
    expect(within(list).getByText("1 of 3")).toBeInTheDocument();
  });
});
