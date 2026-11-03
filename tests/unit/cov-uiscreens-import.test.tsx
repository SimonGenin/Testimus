// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XrayJson } from "../../src/core/types.ts";
import { firstValues, ImportScreen, stillImporting } from "../../src/ui/screens/import/ImportScreen.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, app, fakeDesktop, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const xray = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf", name: "Exigence", type: "text", builtin: false },
  ],
  prefs: { order: [], collapsed: [], hidden: [] },
} as XrayJson;

type P = Parameters<typeof firstValues>[0];

const preview = (over: Partial<P> = {}): P => ({
  headers: ["Action", "Expected Result"],
  mapping: { Action: "Action", "Expected Result": "Expected Result" },
  tests: [{ summary: "Sectionneur", folder: "/F", row: 2, steps: [{ fields: { Action: "Ouvrir" } }] }],
  warnings: [],
  written: [],
  ...over,
});

const info = (project: Record<string, unknown>) => {
  const a = app();
  return { ...a.info, project: { ...a.info?.project, ...project } } as NonNullable<ReturnType<typeof app>["info"]>;
};

const pick = (text: string, name = "tests.csv") =>
  fireEvent.change(screen.getByLabelText("Choose a CSV file"), {
    target: { files: [new File([text], name, { type: "text/csv" })] },
  });

describe("Import CSV helpers", () => {
  it("firstValues reads the first test through the mapping", () => {
    const p = preview({
      headers: ["S", "F", "D", "A", "R", "X"],
      mapping: { S: "#summary", F: "#folder", D: "#description", A: "Action", R: "Expected Result" },
    });
    expect(firstValues(p)).toEqual(["Sectionneur", "/F", "", "Ouvrir", "", ""]);
    expect(firstValues(preview({ tests: [] }))).toEqual(["", ""]);
    expect(firstValues(preview({ tests: [{ summary: "s", folder: "", row: 1, steps: [] }] }))).toEqual(["", ""]);
  });

  it("stillImporting finds the warning among the others, or says it", () => {
    expect(stillImporting(preview({ jobId: "J", warnings: ["other", "Still importing J"] }))).toEqual({
      jobId: "J",
      warning: "Still importing J",
    });
    expect(stillImporting(preview({ jobId: "J" }))).toEqual({
      jobId: "J",
      warning: "Xray is still importing (job J).",
    });
  });
});

describe("Import CSV screen", () => {
  it("drops a file, previews it with a semicolon separator, warnings, custom fields and remembered columns", async () => {
    api.routes["xray.importCsv"] = () =>
      preview({
        tests: [
          { summary: "Sectionneur", folder: "/F", row: 2, steps: [{ fields: { Action: "Ouvrir" } }] },
          { summary: "Empty", folder: "", row: 3, steps: [] },
          { summary: "Disj", folder: "", row: 4, steps: [{ fields: {} }, { fields: {} }] },
        ],
        warnings: ['"Disj" step 2 has no action', "Source Reference column ignored", "Something else"],
      });
    const { container } = mount(<ImportScreen />, {
      xray,
      info: info({ csvMapping: { Action: "Action" }, folders: ["/A", "/B"] }),
    });
    const drop = container.querySelector(".imp-drop") as HTMLElement;
    fireEvent.dragOver(drop);
    fireEvent.drop(drop, { dataTransfer: { files: [new File(["Action;Expected Result\nOuvrir;Vu\n"], "x.csv")] } });
    expect(await screen.findByText("Remembered from your last import")).toBeInTheDocument();
    expect(screen.getByText(/1 row · 2 tests · separator « ; »/)).toBeInTheDocument();
    expect(screen.getByText("Source Reference ignored")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Step 2 has no action")).toBeInTheDocument();
    expect(screen.getByText("1 step")).toBeInTheDocument();
    expect(screen.getByText("2 tests · 3 steps")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Exigence (custom field)" }).length).toBe(2);
    expect(container.querySelectorAll("#imp-folders option")).toHaveLength(2);
    expect(screen.getByText("/F")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Xray folder (when the CSV has none)"), { target: { value: " /G " } });
    expect(screen.getByText("/G")).toBeInTheDocument();
    await waitFor(() => expect(named("xray.importCsv").at(-1)?.input).toMatchObject({ folder: "/G" }));
  });

  it("an empty drop does nothing; a file that cannot be read is reported", async () => {
    const { container } = mount(<ImportScreen />, { xray });
    const drop = container.querySelector(".imp-drop") as HTMLElement;
    fireEvent.drop(drop, { dataTransfer: { files: [] } });
    expect(container.querySelector(".imp-drop")).not.toBeNull();
    const bad = new File(["x"], "bad.csv");
    bad.text = () => Promise.reject(new Error("locked"));
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [bad] } });
    expect(await screen.findByText("Could not read the file")).toBeInTheDocument();
  });

  it("remaps a column, sends the mapping, and shows the comma separator", async () => {
    api.routes["xray.importCsv"] = (i) =>
      preview({ mapping: (i.mapping as Record<string, string>) ?? { Action: "Action" } });
    mount(<ImportScreen />, { xray });
    pick("\uFEFFAction,Expected Result\nOuvrir,Vu\n");
    const sel = await screen.findByLabelText("Expected Result becomes");
    expect(sel).toHaveValue("#ignore");
    expect(screen.getByText(/separator « , »/)).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: "#summary" } });
    await waitFor(() =>
      expect(named("xray.importCsv").at(-1)?.input).toEqual({
        mode: "preview",
        text: "Action,Expected Result\nOuvrir,Vu\n",
        name: "tests",
        mapping: { Action: "Action", "Expected Result": "#summary" },
      }),
    );
  });

  it("reads a preview without a mapping and a header row longer than the data", async () => {
    api.routes["xray.importCsv"] = () => ({
      ...preview({ headers: ["Action", "Expected Result", "Extra"] }),
      mapping: undefined,
    });
    mount(<ImportScreen />, { xray });
    pick("Action,Expected Result,Extra\nOuvrir\n");
    expect(await screen.findByLabelText("Extra becomes")).toHaveValue("#ignore");
  });

  it("shows a failed preview and retries it", async () => {
    mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    expect(await screen.findByText(/Reading the CSV stopped/)).toBeInTheDocument();
    api.routes["xray.importCsv"] = () => preview();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Action becomes")).toBeInTheDocument();
    expect(screen.queryByText(/Reading the CSV stopped/)).toBeNull();
  });

  it("picks a file by its path on the desktop, a cancelled pick changes nothing", async () => {
    const d = fakeDesktop({ files: [] });
    api.routes["xray.importCsv"] = () => preview({ tests: [{ summary: "T", folder: "", row: 1, steps: [] }] });
    mount(<ImportScreen />, { xray });
    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    await waitFor(() => expect(d.pickFiles).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
    d.pickFiles.mockResolvedValue(["C:\\data\\steps.CSV"]);
    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    expect(await screen.findByText("steps.CSV")).toHaveAttribute("title", "C:\\data\\steps.CSV");
    expect(screen.getByText("C:\\data\\steps.CSV", { selector: ".muted" })).toBeInTheDocument();
    await waitFor(() =>
      expect(named("xray.importCsv")[0]?.input).toEqual({
        mode: "preview",
        file: "C:\\data\\steps.CSV",
        name: "steps",
      }),
    );
    expect(await screen.findByText("0 tests · 0 steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 tests locally" })).toBeDisabled();
    expect(screen.getByText("/", { selector: ".mono" })).toBeInTheDocument();
  });

  it("imports locally, checks the tests and opens the first in Tests", async () => {
    api.routes["xray.importCsv"] = (i) => (i.mode === "local" ? preview({ written: ["T1", "T2"] }) : preview());
    api.routes["check.run"] = () => ({});
    const { app: a } = mount(<ImportScreen />, { xray, info: info({ folders: undefined }) });
    pick("Action");
    fireEvent.change(await screen.findByLabelText("Xray folder (when the CSV has none)"), { target: { value: "/Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 test locally" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("tests", "T1"));
    expect(named("xray.importCsv").at(-1)?.input).toMatchObject({ mode: "local", folder: "/Z" });
    expect(named("check.run")[0].input).toEqual({ ids: ["T1", "T2"], semantic: false });
    expect(await screen.findByText("2 tests imported")).toBeInTheDocument();
    expect(a.testsChanged).toHaveBeenCalled();
    expect(a.refreshInfo).toHaveBeenCalled();
  });

  it("a local import that writes nothing stays here; a failed one is shown and retried", async () => {
    let n = 0;
    api.routes["xray.importCsv"] = (i) => {
      if (i.mode !== "local") return preview();
      if (n++ === 0) return preview({ written: [] });
      throw new Error("disk full");
    };
    const { app: a } = mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 test locally" }));
    expect(await screen.findByText("0 tests imported")).toBeInTheDocument();
    expect(a.navigate).not.toHaveBeenCalled();
    expect(named("check.run")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 test locally" }));
    expect(await screen.findByText(/^Importing stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(named("xray.importCsv").filter((c) => c.input.mode === "local")).toHaveLength(3));
  });

  it("plans a direct import, cancels it, closes it, then imports and opens the test", async () => {
    api.routes["xray.importCsv"] = (i) => {
      if (i.mode === "preview") return preview({ warnings: ["w1"] });
      if (i.dryRun) return preview({ plan: [{ kind: "create", label: "Create 1 test" }] as P["plan"] });
      return preview({ written: ["LFRPS12-9"] });
    };
    const { app: a } = mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    await screen.findByLabelText("Action becomes");
    fireEvent.click(screen.getByRole("radio", { name: /Import directly into Xray/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Import locally/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Import directly into Xray/ }));
    fireEvent.click(screen.getByRole("button", { name: "Plan the import of 1 test" }));
    const dlg = await screen.findByRole("dialog", { name: "Import plan" });
    expect(within(dlg).getByText("Create 1 test")).toBeInTheDocument();
    expect(within(dlg).getByText(/1 warning in the preview/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan the import of 1 test" }));
    const planDlg = await screen.findByRole("dialog", { name: "Import plan" });
    await waitFor(() => expect(planDlg).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Plan the import of 1 test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import into Xray" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("tests", "LFRPS12-9"));
    expect(await screen.findByText("1 test created in Jira")).toBeInTheDocument();
  });

  it("an empty plan and a direct import with nothing written", async () => {
    api.routes["xray.importCsv"] = (i) => {
      if (i.mode === "preview") return preview();
      if (i.dryRun) return preview();
      return preview({ written: [] });
    };
    const { app: a } = mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    await screen.findByLabelText("Action becomes");
    fireEvent.click(screen.getByRole("radio", { name: /Import directly into Xray/ }));
    fireEvent.click(screen.getByRole("button", { name: "Plan the import of 1 test" }));
    const dlg = await screen.findByRole("dialog", { name: "Import plan" });
    expect(within(dlg).queryByText(/warning/)).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "Import into Xray" }));
    expect(await screen.findByText("0 tests created in Jira")).toBeInTheDocument();
    expect(a.navigate).not.toHaveBeenCalled();
  });

  it("a failed plan and a failed import are shown; retry plans again", async () => {
    let plans = 0;
    api.routes["xray.importCsv"] = (i) => {
      if (i.mode === "preview") return preview();
      if (i.dryRun) {
        plans++;
        if (plans === 1) throw new Error("Xray 500");
        return preview({ plan: [{ kind: "create", label: "Create" }] as P["plan"] });
      }
      throw new Error("Xray refused");
    };
    mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    await screen.findByLabelText("Action becomes");
    fireEvent.click(screen.getByRole("radio", { name: /Import directly into Xray/ }));
    fireEvent.click(screen.getByRole("button", { name: "Plan the import of 1 test" }));
    expect(await screen.findByText(/Importing into Xray stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import into Xray" }));
    expect(await screen.findByText(/Importing into Xray stopped: Xray refused/)).toBeInTheDocument();
  });

  it("Back returns to the file choice; another file can be chosen", async () => {
    api.routes["xray.importCsv"] = () => preview();
    mount(<ImportScreen />, { xray });
    pick("Action\nx\n");
    await screen.findByLabelText("Action becomes");
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [] } });
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
  });
});
