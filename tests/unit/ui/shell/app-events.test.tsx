// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../../src/ui/app/App.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { keysOfPaths } from "../../../../src/ui/lib/data/refresh.ts";
import { callsOf, FakeES, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app as appState } from "../../helpers/ui-desktop.tsx";
import { clearAllToasts } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => {
  const { useRead } = await import("../../../../src/ui/lib/data/query.ts");
  return {
    TestsScreen: () => <output aria-label="tests read">{String(useRead("tests.list", {}).data ?? "")}</output>,
  };
});
vi.mock("../../../../src/ui/components/claude/ClaudeDock.tsx", () => ({ ClaudeDock: () => null }));

const changed = (paths: string[]) =>
  act(() => FakeES.emit({ jobId: "j", at: "2026-11-03T10:00:00.000Z", type: "changed", paths }));

beforeEach(() => {
  fakeNet();
  fakeEvents();
  window.location.hash = "";
  net.api = () => ({ project: "C:\\p", mock: true, commands: [] });
  net.routes["project.info"] = () => appState().info;
  net.routes["system.credentials"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => [];
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
  net.routes["tests.list"] = () => callsOf("tests.list").length;
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("App, when a job changed project files", () => {
  const boot = async () => {
    render(
      <DataProvider>
        <App />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("tests read")).toHaveTextContent("1"));
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(1));
  };

  it("reads the project again when its counts can change, and the tests when one of them changed", async () => {
    await boot();
    changed(["docs/D1/doc.md"]);
    changed(["docs/D1/doc.json"]);
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(2));
    expect(callsOf("tests.list")).toHaveLength(1);
    changed(["tests/local-1/test.md"]);
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(3));
    await waitFor(() => expect(screen.getByLabelText("tests read")).toHaveTextContent("2"));
    expect(callsOf("tests.list")).toHaveLength(2);
  });

  it("reads a run again when a file of its folder changed (a result, a screenshot), and the list of runs", () => {
    expect(keysOfPaths(["test-runs/recette-j5/results/LFRPS12-1.json"])).toEqual([
      ["runs.list"],
      ["runs.show", { run: "recette-j5" }],
      ["runs.history"],
    ]);
    expect(keysOfPaths(["tests/LFRPS12-1/test.md"]).map((k) => k[0])).not.toContain("runs.show");
  });

  it("tells the action lists and the context lists to read again when theirs changed", () => {
    const contexts = (paths: string[]) =>
      keysOfPaths(paths)
        .map((k) => k[0])
        .filter((n) => n.startsWith("contexts."));
    expect(keysOfPaths(["docs/D1/doc.md"])).not.toContainEqual(["actions.list"]);
    expect(contexts(["docs/D1/doc.md"])).toEqual([]);
    expect(keysOfPaths([".testimus/actions/act-1.json"])).toEqual([["actions.list"], ["actions.show"]]);
    expect(contexts(["contexts/glossary/context.md"])).toEqual([
      "contexts.list",
      "contexts.show",
      "contexts.ofTest",
      "contexts.ofProject",
    ]);
    expect(contexts(["project.json"])).toEqual(["contexts.ofProject", "contexts.ofTest"]);
    expect(contexts(["tests/local-1/local.json"])).toEqual(["contexts.ofTest", "contexts.ofProject"]);
  });
});
