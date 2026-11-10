// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextDialog } from "../../../../src/ui/components/claude/ContextDialog.tsx";
import { ContextEdit } from "../../../../src/ui/components/claude/ContextEdit.tsx";
import { runBadges } from "../../../../src/ui/components/claude/turns.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { iconOf, iconsIn } from "../../helpers/icons.ts";
import { dataWrapper, fakeNet, net } from "../../helpers/ui-data.tsx";

beforeEach(() => {
  fakeNet();
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  setProject(null);
});

const ctx = { id: "gloss", name: "Glossaire RATP", paths: [], files: [], hasNotes: true, shared: true };

const GIVEN = [
  piece("instruction", "Ask Claude on a test"),
  piece("skill:edit-test", "Edit test"),
  piece("rules", "Project rules"),
  piece("tools", "14 tools of the app"),
  piece("overview", "How the documents fit together", { on: false }),
  piece("context:gloss", "Glossaire RATP", { on: false, how: "pointer" }),
  piece("doc:D401", "Spécifications J5", { on: false }),
  piece("docnote:D401", "What the team knows about D401", { on: false, parent: "doc:D401" }),
];

describe("the dock's and the contexts' icons, as the design draws them", () => {
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

  it("in the graph of what a run is given, each piece leads with what it is — a saved context with context — then how it is given", async () => {
    net.routes["claude.preview"] = (i) => previewOf(GIVEN, { ...i, note: "a note", conversation: "User: hello" });
    render(<ContextDialog asked={{ use: "ask-test" }} onClose={() => {}} />, { wrapper: dataWrapper() });
    const dialog = screen.getByRole("dialog", { name: "Context" });
    expect(iconOf(dialog)).toBe("context");
    const saved = await within(dialog).findByRole("checkbox", { name: "Glossaire RATP" });
    expect(iconsIn(saved.closest("label"))).toEqual(["context"]);
    expect(iconsIn(saved.closest("li"))).toEqual(["context", "link"]);
    const lead = (name: string) => iconsIn(within(dialog).getByText(name).closest("li")).slice(0, 3);
    expect(lead("Ask Claude on a test")).toEqual(["lock", "send", "text"]);
    expect(lead("Edit test")).toEqual(["lock", "layers", "download"]);
    expect(lead("Project rules")).toEqual(["lock", "file", "download"]);
    expect(lead("14 tools of the app")).toEqual(["lock", "terminal", "download"]);
    expect(lead("How the documents fit together")).toEqual(["tree", "link"]);
    expect(lead("Spécifications J5")).toEqual(["documents", "search"]);
    expect(lead("What the team knows about D401")).toEqual(["quote", "text"]);
    expect(lead("Your note for this run")).toEqual(["lock", "keyboard", "text"]);
    expect(lead("The conversation so far")).toEqual(["lock", "history", "text"]);
    const target = within(dialog).getByRole("heading", { name: "Request to Claude" }).parentElement;
    expect(iconOf(target)).toBe("claude");
    expect(iconOf(within(dialog).getByRole("button", { name: "New context" }))).toBe("plus");
  });

  it("the saved contexts' library: a copy names its project with folder and copies with copy; an editor says where the context is kept with folder", async () => {
    net.routes["claude.preview"] = (i) => previewOf(GIVEN, i);
    net.routes["contexts.show"] = () => ({ ...ctx, notes: "" });
    net.routes["project.list"] = () => ({
      last: "",
      projects: [{ dir: "D:\\Other", name: "Other", jiraProject: "BHPTCC", exists: true }],
    });
    const r = render(<ContextDialog asked={{ use: "ask-test" }} onClose={() => {}} />, { wrapper: dataWrapper() });
    const open = await screen.findByRole("button", { name: "Copy from another project…" });
    expect(iconOf(open)).toBe("copy");
    fireEvent.click(open);
    const pick = await screen.findByRole("combobox", { name: "Project to copy from" });
    expect(pick.parentElement?.parentElement?.querySelector('[data-icon="folder"]')).not.toBeNull();
    expect(iconOf(screen.getByRole("button", { name: "Copy into this project" }))).toBe("copy");
    r.unmount();
    render(<ContextEdit id="gloss" onClose={() => {}} />, { wrapper: dataWrapper() });
    const editor = screen.getByRole("dialog", { name: "Edit the context" });
    expect(iconOf(editor)).toBe("context");
    const kept = await within(editor).findByText(/In the shared library/);
    expect(iconOf(kept)).toBe("folder");
    expect(iconOf(within(editor).getByRole("button", { name: "Delete context…" }))).toBe("trash");
  });
});
