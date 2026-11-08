// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/runs.ts";
import { runImage } from "../../../../src/shared/run-image.ts";
import { lossOf } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { RunScreen } from "../../../../src/ui/screens/run/RunScreen.tsx";
import { callsOf, Fail, fakeNet, net, withApp } from "../../helpers/ui-data.tsx";

const RUN = "recette-j5-sectionneurs";
let project = "";

// ponytail: the page talks to the real runs commands over a copy of the fixture project
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "testimus-run-ui-"));
  cpSync(resolve(import.meta.dirname, "../../../fixtures/project"), project, { recursive: true });
  fakeNet();
  for (const c of commands)
    net.routes[c.name] = async (input) => {
      try {
        return await c.run(quietCtx(project), c.input.parse(input) as never);
      } catch (e) {
        throw new Fail((e as Error).message);
      }
    };
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  rmSync(project, { recursive: true, force: true });
});

const at = (arg?: string) => ({ route: { screen: "run" as const, ...(arg ? { arg } : {}) } });

describe("the Run screen", () => {
  it("lists the runs in progress and finished, and shows the first one in progress with its tests", async () => {
    withApp(<RunScreen />, at());
    const runs = screen.getByRole("navigation", { name: "Runs" });
    expect(await within(runs).findByRole("option", { name: /Recette J5 — Sectionneurs/ })).toBeInTheDocument();
    expect(within(runs).getByRole("group", { name: "In progress" })).toBeInTheDocument();
    expect(within(runs).getByRole("group", { name: "Finished" })).toHaveTextContent("Recette J4 — Traction");
    const run = await screen.findByRole("region", { name: "Run Recette J5 — Sectionneurs" });
    expect(within(run).getByRole("progressbar", { name: "Run progress" })).toHaveAttribute("aria-valuenow", "67");
    const table = within(run).getByRole("table", { name: "Tests of the run" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["Passed", "Problem", "Not run"]);
    expect(rows[1]).toHaveTextContent("1 OK · 1 NOK");
    expect(rows[1]).toHaveTextContent("1 comment · 1 question");
    fireEvent.click(within(run).getByRole("tab", { name: /^Problems/ }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("counts the open questions as the core does: every question not answered, not the tests that have one", async () => {
    const file = join(project, "test-runs", RUN, "results", "local-3f9a12c0.json");
    const r = JSON.parse(readFileSync(file, "utf8"));
    r.comments.push({ id: "q2", kind: "question", text: "Et le poste 4 ?", by: "tester", at: "2026-11-06T11:00:00Z" });
    writeFileSync(file, JSON.stringify(r));
    withApp(<RunScreen />, at(RUN));
    const run = await screen.findByRole("region", { name: /^Run Recette J5/ });
    expect(within(run).getAllByText("2 open questions")[0]).toBeInTheDocument();
    expect(within(run).getByRole("tab", { name: /^Questions/ })).toHaveTextContent("1");
  });

  it("shows a step's picture from the run's copy, where the run was made to keep it", async () => {
    const file = join(project, "test-runs", RUN, "run.json");
    const run = JSON.parse(readFileSync(file, "utf8"));
    const step = run.tests[0].steps[0];
    step.fields["Expected Result"] = step.fields["Expected Result"].replace(
      "images/fig-40.png",
      "images/sub/fig-40.png",
    );
    step.images = ["images/sub/fig-40.png"];
    writeFileSync(file, JSON.stringify(run));
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1420`));
    await screen.findByRole("region", { name: /^Test Sectionneur sans TK/ });
    const srcs = [...document.querySelectorAll("img")].map((i) => decodeURIComponent(i.getAttribute("src") ?? ""));
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs)
      expect(s).toContain(`/files/test-runs/${RUN}/${runImage("LFRPS12-1420", "images/sub/fig-40.png")}`);
  });

  it("opens a test from its row, and Continue opens the next one not run", async () => {
    const { state } = withApp(<RunScreen />, at(RUN));
    const run = await screen.findByRole("region", { name: /^Run Recette J5/ });
    fireEvent.click(within(run).getByRole("button", { name: /Sectionneur avec TK/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("run", `${RUN}/local-3f9a12c0`);
    fireEvent.click(within(run).getByRole("button", { name: "Continue · test 3" }));
    expect(state.navigate).toHaveBeenLastCalledWith("run", `${RUN}/LFRPS12-1398`);
  });

  it("makes a new run from a folder after saying which tests it holds", async () => {
    const { state } = withApp(<RunScreen />, at());
    fireEvent.click(await screen.findByRole("button", { name: "New run…" }));
    const dialog = screen.getByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Recette J6" } });
    expect(await within(dialog).findByText(/^3 tests: LFRPS12-1398, LFRPS12-1420/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the run (3 tests)" }));
    await waitFor(() => expect(state.navigate).toHaveBeenLastCalledWith("run", "recette-j6"));
    expect(callsOf("runs.create").at(-1)?.input).toEqual({ name: "Recette J6", folder: "/" });
  });

  it("does not read the tests again while the name is typed", async () => {
    withApp(<RunScreen />, at());
    fireEvent.click(await screen.findByRole("button", { name: "New run…" }));
    const dialog = screen.getByRole("dialog", { name: "New run" });
    expect(await within(dialog).findByText(/^3 tests:/)).toBeInTheDocument();
    const before = callsOf("runs.create").length;
    for (const name of ["R", "Re", "Rec", "Recette"])
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: name } });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(callsOf("runs.create")).toHaveLength(before);
  });
});

describe("running a test", () => {
  it("marks a step with the keys, proposes Problem on a NOK of a test not run, and saves", async () => {
    const { state } = withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    const test = await screen.findByRole("region", { name: /^Test / });
    const verdict = screen.getByRole("radiogroup", { name: "Result of the test" });
    expect(within(verdict).getByRole("radio", { name: /Not run/ })).toBeChecked();
    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({ steps: [{ step: 1, ok: false }] }),
    );
    await waitFor(() => expect(within(verdict).getByRole("radio", { name: /Problem/ })).toBeChecked());
    const step1 = within(test).getByRole("group", { name: "Step 1" });
    expect(within(step1).getByRole("button", { name: "NOK" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(within(test).getByRole("textbox", { name: "What happened" }), {
      target: { value: "Le disjoncteur reste fermé." },
    });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(state.navigate).toHaveBeenLastCalledWith("run", RUN));
    expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({
      status: "problem",
      steps: [{ step: 1, ok: false, note: "Le disjoncteur reste fermé." }],
    });
  });

  it("never replaces a recorded result by the one the marks propose", async () => {
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1420`));
    const verdict = await screen.findByRole("radiogroup", { name: "Result of the test" });
    expect(within(verdict).getByRole("radio", { name: /Passed/ })).toBeChecked();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({ steps: [{ step: 2, ok: false }] }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Step 2" })).getByRole("button", { name: "NOK" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(verdict).getByRole("radio", { name: /Passed/ })).toBeChecked();
  });

  it("asks why before saving a blocked test", async () => {
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    const verdict = await screen.findByRole("radiogroup", { name: "Result of the test" });
    fireEvent.click(within(verdict).getByRole("radio", { name: /Blocked/ }));
    const save = screen.getByRole("button", { name: /Save the result/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Why is it blocked?" }), {
      target: { value: "TK non câblée" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save the result/ }));
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({
        status: "blocked",
        blockedReason: "TK non câblée",
      }),
    );
  });

  it("adds a question about a step, and answers the open one", async () => {
    withApp(<RunScreen />, at(`${RUN}/local-3f9a12c0`));
    const side = await screen.findByRole("region", { name: "Comments and questions" });
    expect(within(side).getByText("Open")).toBeInTheDocument();
    fireEvent.change(within(side).getByRole("textbox", { name: "Add a comment or a question" }), {
      target: { value: "Faut-il tester sur le poste 4 ?" },
    });
    fireEvent.click(within(side).getByRole("radio", { name: "Question" }));
    fireEvent.click(within(side).getByRole("button", { name: "Add" }));
    expect(await within(side).findByText("Faut-il tester sur le poste 4 ?", { selector: "p" })).toBeInTheDocument();
    expect(within(side).getAllByText("Open")).toHaveLength(2);
    fireEvent.click(within(side).getAllByRole("button", { name: "Answer" })[0]);
    fireEvent.change(within(side).getByRole("textbox", { name: "Answer" }), { target: { value: "Oui." } });
    fireEvent.click(within(side).getByRole("button", { name: "Send the answer" }));
    expect(await within(side).findByText("Answered")).toBeInTheDocument();
    expect(callsOf("runs.comment").at(-1)?.input).toMatchObject({ answers: "q0a1b2c3", text: "Oui." });
  });
});

describe("running a test like a test of the editor", () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "capture.png", { type: "image/png" });

  it("drops a screenshot on a step not marked yet: it is that step's, the step becomes NOK, and × takes it off", async () => {
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    const test = await screen.findByRole("region", { name: /^Test / });
    const step = within(test).getByRole("article", { name: "Step 1" });
    fireEvent.dragOver(step, { dataTransfer: { types: ["Files"], files: [] } });
    expect(step).toHaveAttribute("data-dropping");
    fireEvent.drop(step, { dataTransfer: { types: ["Files"], files: [png()] } });
    await waitFor(() => expect(callsOf("runs.attach").at(-1)?.input).toMatchObject({ test: "LFRPS12-1398", step: 1 }));
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({ steps: [{ step: 1, ok: false }] }),
    );
    const file = callsOf("runs.attach").length && (await screen.findAllByRole("figure"))[0].getAttribute("aria-label");
    expect(file).toMatch(/^Screenshot capture-[0-9a-f]{8}\.png$/);
    const name = String(file).replace("Screenshot ", "");
    fireEvent.click(within(test).getByRole("button", { name: `Remove ${name}` }));
    await waitFor(() => expect(callsOf("runs.detach").at(-1)?.input).toMatchObject({ file: name }));
  });

  it("pastes a screenshot to the step being played", async () => {
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    await screen.findByRole("region", { name: /^Test / });
    const e = new Event("paste", { cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { files: [png()] } });
    window.dispatchEvent(e);
    await waitFor(() => expect(callsOf("runs.attach").at(-1)?.input).toMatchObject({ step: 1, name: "capture.png" }));
  });

  it("marks every step left OK at once, and folds the OK steps to one line", async () => {
    withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    const test = await screen.findByRole("region", { name: /^Test / });
    fireEvent.click(within(test).getByRole("button", { name: "Mark the 1 left OK" }));
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({ steps: [{ step: 1, ok: true }] }),
    );
    await waitFor(() =>
      expect(within(test).getByRole("article", { name: "Step 1" })).toHaveAttribute("data-played", "ok"),
    );
    fireEvent.click(within(test).getByRole("switch", { name: "Fold OK steps" }));
    expect(within(test).getByRole("article", { name: "Step 1" })).toHaveAttribute("data-folded");
  });

  it("lists the run's tests beside it, filters them, and shows the same test in the other runs", async () => {
    const { state } = withApp(<RunScreen />, at(`${RUN}/LFRPS12-1398`));
    const list = await screen.findByRole("navigation", { name: "Tests of the run" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "Problems 1" }));
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("option", { name: /Sectionneur avec TK/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("run", `${RUN}/local-3f9a12c0`);
    fireEvent.click(within(list).getByRole("button", { name: "All 3" }));
    fireEvent.click(within(list).getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /Only tests I ran/ }));
    expect(within(list).queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const others = await screen.findByRole("list", { name: "This test in other runs" });
    expect(others).toHaveTextContent("Recette J4 — Traction");
    expect(within(others).getByText("Passed")).toBeInTheDocument();
    expect(state.setFocus).toHaveBeenLastCalledWith(
      expect.objectContaining({ testId: "LFRPS12-1398", run: RUN, step: 1 }),
    );
  });

  it("tells the dock the run open on the runs page, and lists what the run found", async () => {
    const { state } = withApp(<RunScreen />, at(RUN));
    const found = await screen.findByRole("complementary", { name: "What the run found" });
    expect(within(found).getByRole("region", { name: "Problems to look at" })).toHaveTextContent("Step 2 · NOK");
    expect(within(found).getByRole("region", { name: "Open questions" })).toHaveTextContent("1");
    await waitFor(() =>
      expect(state.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ testId: "", run: RUN })),
    );
    fireEvent.click(within(found).getByRole("button", { name: "Summarize this run for a report" }));
    expect(state.askClaude).toHaveBeenLastCalledWith("run", expect.stringMatching(/^Summarize this test run/));
  });
});

describe("the run as pages", () => {
  it("exports the run to a new folder, with the results entered so far", async () => {
    const dir = join(project, "..", `${project.split(/[\\/]/).pop()}-pages`);
    withApp(<RunScreen />, at(RUN));
    const run = await screen.findByRole("region", { name: /^Run Recette J5/ });
    fireEvent.click(within(run).getByRole("button", { name: "Export as pages…" }));
    const dialog = screen.getByRole("dialog", { name: "Export « Recette J5 — Sectionneurs » as pages" });
    expect(
      within(dialog).getByRole("checkbox", { name: "Include the results already entered (2 tests)" }),
    ).toBeChecked();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder" }), { target: { value: dir } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    expect(await within(dialog).findByText(/The run is in/)).toBeInTheDocument();
    expect(callsOf("runs.export")[0].input).toEqual({ run: RUN, dir, results: true });
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports the results of the pages: the plan first, then the writing", async () => {
    const dir = join(project, "..", `${project.split(/[\\/]/).pop()}-back`);
    await net.routes["runs.export"]({ run: RUN, dir });
    const file = join(dir, "results", "LFRPS12-1398.json");
    writeFileSync(file, JSON.stringify({ status: "passed", steps: [{ ok: true }], updatedAt: "2099-01-01T00:00:00Z" }));
    const { state } = withApp(<RunScreen />, at(RUN));
    fireEvent.click(await screen.findByRole("button", { name: "Import results…" }));
    const dialog = screen.getByRole("dialog", { name: "Import the results" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder or run.json" }), { target: { value: dir } });
    expect(
      await within(dialog).findByText(/Into « Recette J5 — Sectionneurs »: 1 test with a new result/),
    ).toBeInTheDocument();
    expect(callsOf("runs.import").every((c) => c.input.dryRun === true)).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Import 1 result" }));
    await waitFor(() => expect(state.navigate).toHaveBeenLastCalledWith("run", RUN));
    expect(callsOf("runs.import").at(-1)?.input).toEqual({ dir });
    rmSync(dir, { recursive: true, force: true });
  });

  it("says when the pages hold nothing new", async () => {
    const dir = join(project, "..", `${project.split(/[\\/]/).pop()}-same`);
    await net.routes["runs.export"]({ run: RUN, dir });
    withApp(<RunScreen />, at(RUN));
    fireEvent.click(await screen.findByRole("button", { name: "Import results…" }));
    const dialog = screen.getByRole("dialog", { name: "Import the results" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder or run.json" }), { target: { value: dir } });
    expect(await within(dialog).findByText(/^Nothing new to import/, { selector: "p" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Import" })).toBeDisabled();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the palette", () => {
  it("asks before deleting a run, naming what goes", () => {
    expect(lossOf("runs.remove", { run: RUN })).toMatchObject({ verb: "Delete the run" });
    expect(lossOf("runs.remove", { run: RUN })?.what).toMatch(/result, comment, question and screenshot/);
  });
});
