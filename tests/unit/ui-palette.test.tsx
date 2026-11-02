// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo } from "../../src/ui/api.ts";
import { formValue, hasInput } from "../../src/ui/components/shell/CommandForm.tsx";
import { Palette } from "../../src/ui/components/shell/Palette.tsx";

afterEach(cleanup);

const cmd = (name: string, summary: string, properties: Record<string, object> = {}): CommandInfo => ({
  name,
  summary,
  mutates: false,
  job: false,
  input: { type: "object", properties, required: [] },
});

const commands = [
  cmd("xray.push", "Push a local test to Jira", { id: { type: "string" } }),
  cmd("xray.pull", "Pull tests from Jira", { key: { type: "string" } }),
  cmd("tests.list", "List the local tests"),
  cmd("system.version", "Testimus and Node versions"),
];

const options = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");

describe("command palette", () => {
  it("lists every command and the app actions when empty", () => {
    render(
      <Palette
        commands={commands}
        actions={[{ id: "go-tests", label: "Go to Tests", run: () => {} }]}
        onCommand={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  it("filters by name and summary words", () => {
    render(<Palette commands={commands} actions={[]} onCommand={() => {}} onAsk={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pu" } });
    const shown = options();
    expect(shown.filter((o) => o.includes("xray"))).toHaveLength(2);
    expect(shown.some((o) => o.includes("tests list"))).toBe(false);
    expect(shown[shown.length - 1]).toContain("Ask the documents");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jira push" } });
    expect(options().filter((o) => o.includes("xray"))).toEqual([expect.stringContaining("xray push")]);
  });

  it("runs the highlighted entry with Enter", () => {
    const onCommand = vi.fn();
    const onClose = vi.fn();
    render(<Palette commands={commands} actions={[]} onCommand={onCommand} onClose={onClose} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "version" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(onCommand).toHaveBeenCalledWith(commands[3]);
  });

  it("knows which commands need a form and builds their input", () => {
    expect(hasInput(commands[0])).toBe(true);
    expect(hasInput(commands[2])).toBe(false);
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        from: { type: "number" },
        dryRun: { type: "boolean" },
        keys: { type: "array", items: { type: "string" } },
      },
    };
    expect(formValue(schema, { id: "LFRPS12-1420", from: "3", dryRun: true, keys: "A-1, A-2" })).toEqual({
      id: "LFRPS12-1420",
      from: 3,
      dryRun: true,
      keys: ["A-1", "A-2"],
    });
  });
});
