// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AskClaude } from "../../../../src/ui/components/claude/AskClaude.tsx";
import { ContextPicker } from "../../../../src/ui/components/claude/ContextPicker.tsx";
import { ContextsDialog } from "../../../../src/ui/components/claude/ContextsDialog.tsx";
import { DockFolded } from "../../../../src/ui/components/claude/DockFolded.tsx";
import { runBadges } from "../../../../src/ui/components/claude/turns.ts";
import { AppContext } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { dataWrapper, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

beforeEach(() => {
  fakeNet();
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  setProject(null);
});

const iconOf = (el: Element | null | undefined) => el?.querySelector("[data-icon]")?.getAttribute("data-icon");
const ctx = { id: "gloss", name: "Glossaire RATP", paths: [], files: [], hasNotes: true, shared: true };

describe("the dock's and the contexts' icons, as the design draws them", () => {
  it("folded dock: the spinner takes the spark's place while Claude works, and the strip has no pin", () => {
    const strip = (running: boolean) => (
      <DockFolded onOpen={() => {}} actions={0} running={running} seconds={3} offline={false} last={null} />
    );
    const r = render(strip(false));
    expect(iconOf(screen.getByRole("button", { name: "Open Claude" }))).toBe("claude");
    r.rerender(strip(true));
    const open = screen.getByRole("button", { name: "Open Claude" });
    expect(open.querySelector("svg")).toBeNull();
    expect(open.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Always on top" })).toBeNull();
  });

  it("a run card's « n steps changed » is Claude's: its tone and its spark", () => {
    const run = { runId: "r", testId: "t", steps: 1, tests: 1 };
    expect(runBadges(run, false)[0]).toEqual({ label: "1 step changed", tone: "claude", icon: "claude" });
    expect(runBadges({ ...run, steps: 2 }, true)[0]).toEqual({
      label: "2 steps changed",
      tone: "claude",
      icon: "claude",
    });
    expect(runBadges({ ...run, steps: 0 }, true)[0]).toMatchObject({ label: "Nothing changed", tone: "neutral" });
  });

  it("the saved contexts of a run each lead with context", () => {
    render(<ContextPicker all={[ctx]} isOn={() => true} onToggle={() => {}} foot="" />);
    expect(iconOf(screen.getByText("Glossaire RATP"))).toBe("context");
  });

  it("Ask Claude's foot leads with info", () => {
    render(
      <AppContext.Provider value={app()}>
        <AskClaude testId="local-1" step={2} />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(iconOf(screen.getByText("Runs in the dock with this test's contexts"))).toBe("info");
  });

  it("the Contexts dialog: each context is a context; the copy names its project with folder and copies with copy", async () => {
    net.routes["contexts.list"] = () => [ctx];
    net.routes["contexts.show"] = () => ({ ...ctx, notes: "" });
    net.routes["project.list"] = () => ({
      last: "",
      projects: [{ dir: "D:\\Other", name: "Other", jiraProject: "BHPTCC", exists: true }],
    });
    render(<ContextsDialog onClose={() => {}} />, { wrapper: dataWrapper() });
    expect(iconOf(await screen.findByRole("option", { name: /Glossaire RATP/ }))).toBe("context");
    fireEvent.click(screen.getByRole("button", { name: "Copy from another project…" }));
    const pick = await screen.findByRole("combobox", { name: "Project to copy from" });
    expect(pick.parentElement?.parentElement?.querySelector('[data-icon="folder"]')).not.toBeNull();
    expect(iconOf(screen.getByRole("button", { name: "Copy into this project" }))).toBe("copy");
  });
});
