// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AskClaude } from "../../../../src/ui/components/claude/AskClaude.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { app } from "../../helpers/ui-desktop.tsx";

afterEach(cleanup);

const withPresets = (): AppState => {
  const base = app();
  const info = base.info as NonNullable<AppState["info"]>;
  return {
    ...base,
    info: {
      ...info,
      project: {
        ...info.project,
        claude: { ...info.project.claude, presets: [{ label: "Negative path", prompt: "Add the negative path." }] },
      },
    },
  };
};

describe("Ask Claude on a step or the test", () => {
  it("asks in a popover with the quick asks, model and effort, and hands the run to the dock", () => {
    const state = withPresets();
    render(
      <AppContext.Provider value={state}>
        <AskClaude testId="local-1" step={2} />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    const pop = screen.getByRole("dialog", { name: "Ask Claude · Step 2" });
    expect(pop).toHaveTextContent("Runs in the dock with this test's contexts");
    fireEvent.click(screen.getByRole("button", { name: "Negative path" }));
    expect(screen.getByRole("textbox", { name: "Ask Claude about step 2" })).toHaveValue("Add the negative path.");
    fireEvent.change(screen.getByRole("combobox", { name: "Effort" }), { target: { value: "max" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(state.runInDock).toHaveBeenCalledWith({
      name: "claude.run",
      input: {
        scope: { kind: "step", testId: "local-1", step: 2 },
        prompt: "Add the negative path.",
        model: "sonnet",
        effort: "max",
      },
      label: "Step 2 · Negative path",
      text: "Add the negative path.",
      testId: "local-1",
    });
    expect(screen.queryByRole("dialog", { name: "Ask Claude · Step 2" })).toBeNull();
  });

  it("on the whole test, an empty box still runs; it can be off while Claude works", () => {
    const state = app();
    const { rerender } = render(
      <AppContext.Provider value={state}>
        <AskClaude testId="local-1" />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(state.runInDock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ scope: { kind: "test", testId: "local-1" }, prompt: "" }),
      }),
    );
    rerender(
      <AppContext.Provider value={state}>
        <AskClaude testId="local-1" disabled="Claude is working — wait for it to finish" />
      </AppContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Ask Claude" })).toBeDisabled();
  });
});
