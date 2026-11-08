// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/runs.ts";
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
    fireEvent.click(within(run).getByRole("radio", { name: /^Problems/ }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("opens a test from its row, and Continue opens the next one not run", async () => {
    const { state } = withApp(<RunScreen />, at(RUN));
    const run = await screen.findByRole("region", { name: /^Run Recette J5/ });
    fireEvent.click(within(run).getByRole("button", { name: /Sectionneur avec TK/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("run", `${RUN}/local-3f9a12c0`);
    fireEvent.click(within(run).getByRole("button", { name: "Continue — next test not run" }));
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
});

describe("running a test", () => {
  it("marks steps with the keys, proposes Problem on a NOK, and saves then opens the next test not run", async () => {
    const { state } = withApp(<RunScreen />, at(`${RUN}/LFRPS12-1420`));
    const test = await screen.findByRole("region", { name: /^Test Sectionneur sans TK/ });
    const verdict = screen.getByRole("radiogroup", { name: "Result of the test" });
    expect(within(verdict).getByRole("radio", { name: /Passed/ })).toBeChecked();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() =>
      expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({ steps: [{ step: 2, ok: false }] }),
    );
    await waitFor(() => expect(within(verdict).getByRole("radio", { name: /Problem/ })).toBeChecked());
    const step2 = within(test).getByRole("group", { name: "Step 2" });
    expect(within(step2).getByRole("button", { name: "NOK" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(within(test).getByRole("textbox", { name: "What happened" }), {
      target: { value: "Le menu ne propose que Propriétés." },
    });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(state.navigate).toHaveBeenLastCalledWith("run", `${RUN}/LFRPS12-1398`));
    expect(callsOf("runs.setResult").at(-1)?.input).toMatchObject({
      status: "problem",
      steps: [{ step: 2, ok: false, note: "Le menu ne propose que Propriétés." }],
    });
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
    const side = await screen.findByRole("complementary", { name: "Comments and questions" });
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

describe("the palette", () => {
  it("asks before deleting a run, naming what goes", () => {
    expect(lossOf("runs.remove", { run: RUN })).toMatchObject({ verb: "Delete the run" });
    expect(lossOf("runs.remove", { run: RUN })?.what).toMatch(/result, comment, question and screenshot/);
  });
});
