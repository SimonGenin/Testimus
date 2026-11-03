// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../../src/ui/app/App.tsx";
import { CONTEXTS_EVENT } from "../../../../src/ui/components/claude/ContextsDialog.tsx";
import { ACTIONS_EVENT } from "../../../../src/ui/lib/actions.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { callsOf, FakeES, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { app as appState } from "../../ui-desktop-helpers.tsx";
import { clearAllToasts } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => {
  const { useApp } = await import("../../../../src/ui/lib/app.ts");
  return {
    TestsScreen: () => <output aria-label="tests nonce">{useApp().testsNonce}</output>,
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
  net.routes["system.setup"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => [];
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
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
    expect(await screen.findByLabelText("tests nonce")).toHaveTextContent("0");
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(1));
  };

  it("reads the project again when its counts can change, and the tests when one of them changed", async () => {
    await boot();
    changed(["docs/D1/doc.md"]);
    changed(["docs/D1/doc.json"]);
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(2));
    expect(screen.getByLabelText("tests nonce")).toHaveTextContent("0");
    changed(["tests/local-1/test.md"]);
    await waitFor(() => expect(callsOf("project.info")).toHaveLength(3));
    expect(screen.getByLabelText("tests nonce")).toHaveTextContent("1");
  });

  it("tells the action lists and the context lists to read again when theirs changed", async () => {
    await boot();
    const acts = vi.fn();
    const ctxs = vi.fn();
    window.addEventListener(ACTIONS_EVENT, acts);
    window.addEventListener(CONTEXTS_EVENT, ctxs);
    try {
      changed(["docs/D1/doc.md"]);
      expect(acts).not.toHaveBeenCalled();
      expect(ctxs).not.toHaveBeenCalled();
      changed([".testimus/actions/act-1.json"]);
      expect(acts).toHaveBeenCalledTimes(1);
      changed(["contexts/glossary/context.md"]);
      changed(["project.json"]);
      changed(["tests/local-1/local.json"]);
      expect(ctxs).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener(ACTIONS_EVENT, acts);
      window.removeEventListener(CONTEXTS_EVENT, ctxs);
    }
  });
});
