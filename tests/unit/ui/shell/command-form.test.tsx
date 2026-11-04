// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo, JsonSchema } from "../../../../src/ui/api.ts";
import { CommandForm, formValue, hasInput } from "../../../../src/ui/components/shell/CommandForm.tsx";
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
    fireEvent.change(screen.getByLabelText("mode (optional)"), { target: { value: "b" } });
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
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callsOf("x.run")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("obj (optional)"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Unknown test")).toBeInTheDocument();
  });

  it("hands a started job over and closes, and shows Running meanwhile", async () => {
    const gate = deferred();
    net.routes["gen.tests"] = async () => {
      await gate.promise;
      return { jobId: "j5" };
    };
    const close = vi.fn();
    const onJob = vi.fn();
    withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={close} onJob={onJob} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("button", { name: "Running…" })).toBeDisabled();
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(onJob).toHaveBeenCalledWith("j5"));
    expect(close).toHaveBeenCalled();
    expect(screen.getByText("gen.tests started")).toBeInTheDocument();
  });

  it("shows the result of a job command that did not start a job, and runs without onJob", async () => {
    net.routes["gen.tests"] = () => null;
    const { unmount } = withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByTestId("command-result")).toHaveTextContent("null");
    unmount();
    net.routes["gen.tests"] = () => ({ jobId: "j6" });
    const close = vi.fn();
    withData(<CommandForm command={cmd("gen.tests", {}, { job: true })} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("opens the push plan instead of pushing, and needs the test id", async () => {
    const close = vi.fn();
    withData(<CommandForm command={cmd("xray.push", { id: { type: "string" } })} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Give the id of the test to push.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "LFRPS12-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("push LFRPS12-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("id")).toHaveValue("LFRPS12-1");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pushed" }));
    expect(close).toHaveBeenCalled();
    expect(callsOf("xray.push")).toHaveLength(0);
  });
});
