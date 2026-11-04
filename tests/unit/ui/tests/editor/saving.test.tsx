// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, Test } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { AppContext } from "../../../../../src/ui/lib/app.ts";
import { TestEditor } from "../../../../../src/ui/screens/tests/TestEditor.tsx";
import { app } from "../../../helpers/ui-desktop.tsx";
import { server, stubServer } from "../../../helpers/ui-server.ts";
import { testClient, WithData } from "../data-helpers.tsx";

vi.mock("../../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/toast.ts")>();
  return { ...real, toast: vi.fn(), errorToast: vi.fn() };
});

const step = (action: string, id: string): Step => ({
  id,
  fields: { Action: action, "Expected Result": `${action} done` },
  sources: [],
  images: [],
});

const makeTest = (o: Partial<Test> = {}): Test => ({
  key: "LFRPS12-7",
  project: "LFRPS12",
  summary: "Sectionneur",
  folder: "/",
  labels: [],
  description: "Checks the switch",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [step("One", "1"), step("Two", "2")],
  extra: {},
  ...o,
});

let onDisk: Test;
let seq = 0;

beforeEach(() => {
  stubServer();
  setProject(`/p/saving-${++seq}`);
  localStorage.clear();
  onDisk = makeTest();
  server.routes["tests.show"] = (input) => ({ id: input.id, test: onDisk, remote: makeTest(), mtime: 1 });
  server.routes["tests.save"] = (input) => {
    onDisk = input.test as Test;
    return { id: input.id, summary: onDisk.summary, sync: "modified", mtime: 2 };
  };
  server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-7"], failed: [] });
  server.routes["contexts.ofTest"] = () => ({ effective: [], own: null });
  server.routes["contexts.list"] = () => [];
  server.routes["tests.folds"] = () => ({ own: null });
  server.routes["xray.preconditions"] = () => [];
  server.routes["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  server.routes["xray.status"] = (input) => ({ tests: [{ id: input.id, sync: "synced", remote: "unchanged" }] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const editor = () =>
  render(
    <WithData client={testClient()}>
      <AppContext.Provider value={app({ route: { screen: "tests", arg: "t1" } })}>
        <TestEditor testId="t1" onSaved={vi.fn()} onOpen={vi.fn()} />
      </AppContext.Provider>
    </WithData>,
  );

const order = () =>
  server.calls.map((c) => c.name).filter((n) => ["tests.save", "tests.show", "xray.pull"].includes(n));

describe("TestEditor autosave: flushed before Download from Jira (audit M-T3)", () => {
  it("an edit typed just before ⋯ › Download is saved first, then counted as a local change to lose", async () => {
    editor();
    await screen.findByLabelText("Action of step 1");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Typed just now" } });
    fireEvent.click(screen.getByRole("button", { name: "More actions for this test" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Download from Jira/ }));
    const dlg = await screen.findByRole("alertdialog", { name: "Replace LFRPS12-7 with Jira's version?" });
    expect(within(dlg).getByText(/everything you edited since the last sync/)).toBeInTheDocument();
    expect(order()).toEqual(["tests.show", "tests.save", "tests.show"]);
    const saved = server.calls.find((c) => c.name === "tests.save")?.input.test as Test | undefined;
    expect(saved?.description).toBe("Typed just now");
    fireEvent.click(within(dlg).getByRole("button", { name: "Replace with Jira's version" }));
    await waitFor(() => expect(order()).toContain("xray.pull"));
    const o = order();
    expect(o.indexOf("tests.save")).toBeLessThan(o.indexOf("xray.pull"));
    expect(o.filter((n) => n === "tests.save")).toHaveLength(1);
  });

  it("with nothing typed and nothing changed since the sync, it downloads at once without saving", async () => {
    editor();
    await screen.findByLabelText("Action of step 1");
    fireEvent.click(screen.getByRole("button", { name: "More actions for this test" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Download from Jira/ }));
    await waitFor(() => expect(order()).toContain("xray.pull"));
    expect(screen.queryByRole("alertdialog", { name: "Replace LFRPS12-7 with Jira's version?" })).toBeNull();
    expect(order()).not.toContain("tests.save");
  });

  it("an edit still waiting when the window moves to another project is saved to the project it was typed in", async () => {
    const here = `/p/saving-${seq}`;
    const r = editor();
    await screen.findByLabelText("Action of step 1");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Typed in A" } });
    setProject("/p/elsewhere");
    r.unmount();
    await waitFor(() => expect(order()).toContain("tests.save"));
    const save = server.calls.find((c) => c.name === "tests.save");
    expect(save?.project).toBe(here);
    expect((save?.input.test as Test | undefined)?.description).toBe("Typed in A");
  });

  it("an edit typed then left alone for 400 ms is saved once, before any Download is asked", async () => {
    editor();
    await screen.findByLabelText("Action of step 1");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Paused" } });
    expect(order()).toEqual(["tests.show"]);
    await waitFor(() => expect(order()).toEqual(["tests.show", "tests.save"]), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 450));
    expect(order()).toEqual(["tests.show", "tests.save"]);
  });
});
