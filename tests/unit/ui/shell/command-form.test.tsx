// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo, JsonSchema } from "../../../../src/ui/api.ts";
import { CommandForm, formValue, hasInput } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { choose, openList } from "../../helpers/select.ts";
import { callsOf, deferred, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/tests/PushDialog.tsx", () => ({
  PushDialog: ({ testId, onDone, onClose }: { testId: string; onDone: (id: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Push plan">
      <span>push {testId}</span>
      <button type="button" onClick={() => onDone(testId)}>
        Pushed
      </button>
      <button type="button" onClick={onClose}>
        Back
      </button>
    </div>
  ),
}));

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
});

const cmd = (name: string, properties: Record<string, JsonSchema>, o: Partial<CommandInfo> = {}): CommandInfo => ({
  name,
  summary: `${name} summary`,
  mutates: false,
  job: false,
  input: { type: "object", properties, required: ["id"] },
  ...o,
});

const schema: JsonSchema = {
  properties: {
    flag: { type: "boolean" },
    count: { type: ["integer", "null"] },
    ratio: { type: "number" },
    ids: { type: "array", items: { type: "string" } },
    tags: { type: "array" },
    rows: { type: "array", items: { type: "object" } },
    mode: { enum: ["a", "b"] },
    pick: { anyOf: [{ type: "null" }, { type: "string" }] },
    nothing: { anyOf: [{ type: "null" }] },
    obj: { type: "object" },
    bare: {},
    name: { type: "string" },
  },
};

describe("formValue and hasInput", () => {
  it("converts every kind of field and skips the empty ones", () => {
    expect(
      formValue(schema, {
        flag: true,
        count: "3",
        ratio: "0.5",
        ids: "A, B\nC,",
        tags: "x",
        rows: '[{"a":1}]',
        mode: "b",
        pick: "p",
        nothing: "1",
        obj: '{"k":2}',
        bare: "true",
        name: "",
      }),
    ).toEqual({
      flag: true,
      count: 3,
      ratio: 0.5,
      ids: ["A", "B", "C"],
      tags: ["x"],
      rows: [{ a: 1 }],
      mode: "b",
      pick: "p",
      nothing: 1,
      obj: { k: 2 },
      bare: true,
    });
    expect(formValue({}, { x: "1" })).toEqual({});
    expect(hasInput(cmd("a.b", {}))).toBe(false);
    expect(hasInput({ ...cmd("a.b", {}), input: undefined as unknown as JsonSchema })).toBe(false);
  });
});

describe("CommandForm", () => {
  it("draws one control per field kind and shows the plain result", async () => {
    net.routes["tests.list"] = (i) => ({ got: i });
    const close = vi.fn();
    withData(
      <CommandForm
        command={cmd("tests.list", {
          id: { type: "string", description: "The test id" },
          flag: { type: "boolean" },
          mode: { enum: ["a", "b"] },
          obj: { type: "object" },
          n: { type: "number" },
          ids: { type: "array" },
        })}
        onClose={close}
      />,
    );
    expect(screen.getByText("The test id")).toBeInTheDocument();
    expect(screen.getByLabelText("flag (optional)")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("n (optional)")).toHaveAttribute("placeholder", "a number");
    expect(screen.getByLabelText("ids (optional)")).toHaveAttribute("placeholder", "comma-separated");
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "local-1" } });
    fireEvent.click(screen.getByLabelText("flag (optional)"));
    choose(screen.getByLabelText("mode (optional)"), "b");
    fireEvent.change(screen.getByLabelText("obj (optional)"), { target: { value: '{"a":1}' } });
    fireEvent.change(screen.getByLabelText("n (optional)"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("ids (optional)"), { target: { value: "x,y" } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    const out = await screen.findByTestId("command-result");
    expect(JSON.parse(out.textContent ?? "")).toEqual({
      got: { id: "local-1", flag: true, mode: "b", obj: { a: 1 }, n: 4, ids: ["x", "y"] },
    });
    expect(screen.getByText(/^testimus tests list --id local-1 --flag --mode b --obj/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });

  it("refuses bad JSON and shows a command error", async () => {
    net.routes["x.run"] = () => {
      throw new Fail("Unknown test");
    };
    withData(<CommandForm command={cmd("x.run", { obj: { type: "object" } })} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("obj (optional)"), { target: { value: "{bad" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callsOf("x.run")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("obj (optional)"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("Unknown test")).toBeInTheDocument();
  });

  it("says a started job with « Open in Jobs » to that job and closes, and shows Running meanwhile", async () => {
    const gate = deferred();
    net.routes["gen.tests"] = async () => {
      await gate.promise;
      return { jobId: "j5" };
    };
    const close = vi.fn();
    const navigate = vi.fn();
    withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={close} />, { navigate });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByRole("button", { name: /^Running…/ })).toBeDisabled();
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.getByText("gen.tests summary — started")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open in Jobs" }));
    expect(navigate).toHaveBeenCalledWith("jobs", "j5");
  });

  it("shows the result of a job command that did not start a job", async () => {
    net.routes["gen.tests"] = () => null;
    const { unmount } = withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByTestId("command-result")).toHaveTextContent("null");
    unmount();
    net.routes["gen.tests"] = () => ({ jobId: "j6" });
    const close = vi.fn();
    withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("opens the push plan instead of pushing, and needs the test id", async () => {
    const close = vi.fn();
    withData(<CommandForm command={cmd("xray.push", { id: { type: "string" } })} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("Give the id of the test to push.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "LFRPS12-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("push LFRPS12-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("id")).toHaveValue("LFRPS12-1");
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pushed" }));
    expect(close).toHaveBeenCalled();
    expect(callsOf("xray.push")).toHaveLength(0);
  });

  it("is titled by what it does with its name beside, picks a document id among the documents, runs on Ctrl+Enter and goes back to the results", async () => {
    net.routes["docs.list"] = () => [
      { id: "SOSIE_3", title: "Traction" },
      { id: "SOSIE_4", title: "Signalisation" },
    ];
    net.routes["docs.show"] = (i) => ({ id: i.id });
    const back = vi.fn();
    const show = cmd(
      "docs.show",
      { id: { type: "string", description: "Document id (the folder name under docs/)" } },
      { summary: "Show a document: metadata, context, contents, figures and text." },
    );
    withData(<CommandForm command={show} onClose={() => {}} onBack={back} />);
    const dlg = screen.getByRole("dialog", { name: "Show a document" });
    expect(dlg).toHaveTextContent("docs.show · metadata, context, contents, figures and text.");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
    expect(back).toHaveBeenCalled();
    const pick = await screen.findByRole("combobox", { name: "id" });
    expect(within(openList(pick)).getByRole("option", { name: "SOSIE_4 · Signalisation" })).toBeInTheDocument();
    choose(pick, "SOSIE_4 · Signalisation");
    expect(screen.getByRole("button", { name: /^Run/ })).toHaveTextContent("Ctrl+Enter");
    fireEvent.keyDown(pick, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsOf("docs.show")[0]?.input).toEqual({ id: "SOSIE_4" }));
  });

  it("asks before a command that loses something, naming it; Cancel goes back to the form", async () => {
    net.routes["tests.remove"] = () => ({ id: "local-1", removed: true });
    withData(
      <CommandForm command={cmd("tests.remove", { id: { type: "string" } }, { mutates: true })} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "local-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    const ask = await screen.findByRole("alertdialog", { name: "tests.remove summary?" });
    expect(ask).toHaveTextContent("The test folder is deleted");
    expect(callsOf("tests.remove")).toHaveLength(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("id")).toHaveValue("local-1");
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete the test" }));
    expect(await screen.findByTestId("command-result")).toHaveTextContent('"removed": true');
    expect(callsOf("tests.remove")[0].input).toEqual({ id: "local-1" });
  });

  it("asks at once for a command without input that changes how the project works", async () => {
    net.routes["xray.disconnect"] = () => ({ jiraProject: "LFRPS12" });
    const close = vi.fn();
    withData(<CommandForm command={cmd("xray.disconnect", {}, { mutates: true })} onClose={close} />);
    const ask = screen.getByRole("alertdialog", { name: "xray.disconnect summary?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalled();
    expect(callsOf("xray.disconnect")).toHaveLength(0);
  });

  it("shows a dry run's plan first, then its button does it, in red when something is lost", async () => {
    net.routes["docs.remove"] = (i) => ({ removed: "SOSIE_3", dryRun: i.dryRun === true });
    withData(
      <CommandForm
        command={cmd("docs.remove", { id: { type: "string" }, dryRun: { type: "boolean" } }, { mutates: true })}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "SOSIE_3" } });
    fireEvent.click(screen.getByRole("button", { name: /^Show the plan/ }));
    expect(await screen.findByTestId("command-plan")).toHaveTextContent('"dryRun": true');
    expect(callsOf("docs.remove")[0].input).toEqual({ id: "SOSIE_3", dryRun: true });
    expect(screen.getByRole("alert")).toHaveTextContent("the tests that cite it report it missing");
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "SOSIE_4" } });
    expect(screen.queryByTestId("command-plan")).toBeNull();
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "SOSIE_3" } });
    fireEvent.click(screen.getByRole("button", { name: /^Show the plan/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Remove the document/ }));
    expect(await screen.findByTestId("command-result")).toHaveTextContent('"dryRun": false');
    expect(callsOf("docs.remove")[2].input).toEqual({ id: "SOSIE_3" });
  });

  it("hands a Claude fix to the dock instead of running it as a bare job", () => {
    const runInDock = vi.fn();
    const close = vi.fn();
    withData(<CommandForm command={cmd("review.fix", { id: { type: "string" } })} onClose={close} />, { runInDock });
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "local-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(runInDock).toHaveBeenCalledWith({
      name: "review.fix",
      input: { id: "local-1" },
      label: "Fix the test",
      testId: "local-1",
    });
    expect(close).toHaveBeenCalled();
    expect(callsOf("review.fix")).toHaveLength(0);
  });
});
