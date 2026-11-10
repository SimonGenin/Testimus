// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { FixNote } from "../../../../src/ui/screens/review/FixNote.tsx";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { dataWrapper } from "../../helpers/ui-data.tsx";
import { api, fakeFetch, named } from "../../helpers/ui-desktop.tsx";

// ponytail: the note is a Claude block — its Context reads what the fix is given, so it is drawn inside the data layer
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: dataWrapper() });

beforeEach(() => {
  fakeFetch();
  setProject("D:/p1");
});

afterEach(() => {
  cleanup();
  clearDrafts();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FixNote draft", () => {
  it("keeps the note of a test the user left, and forgets it on Cancel", () => {
    const props = { claudeReady: true, onCancel: vi.fn(), onSubmit: vi.fn() };
    const r = render(<FixNote id="T-1" initial="" {...props} />);
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "step 2 is wrong" } });
    r.unmount();
    const again = render(<FixNote id="T-1" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("step 2 is wrong");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    again.unmount();
    render(<FixNote id="T-1" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("");
  });
});

describe("FixNote context", () => {
  const note = () => screen.getByRole("dialog", { name: "What needs fixing?" });

  it("the note's Context is what Claude's fix of this test is given; nothing ticked, nothing is handed over", async () => {
    api.routes["claude.preview"] = (i) =>
      previewOf([piece("instruction", "Fix a test"), piece("context:glossary", "Glossary")], i);
    const onSubmit = vi.fn();
    render(<FixNote id="T-1" initial="" claudeReady onCancel={() => {}} onSubmit={onSubmit} />);
    const context = within(note()).getByRole("button", { name: /^Context/ });
    await waitFor(() => expect(context).toHaveTextContent(/^Context2$/));
    expect(named("claude.preview")[0].input).toEqual({ use: "fix", scope: { kind: "test", testId: "T-1" } });
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "step 2 is wrong" } });
    expect(context).toHaveTextContent(/^Context3$/);
    fireEvent.click(within(note()).getByRole("button", { name: "Mark To fix" }));
    expect(onSubmit).toHaveBeenCalledWith("step 2 is wrong", false, {});
  });

  it("what is ticked there is handed over with the note when Claude is asked, and Escape in the graph keeps the note open", async () => {
    api.routes["claude.preview"] = (i) =>
      previewOf([piece("instruction", "Fix a test"), piece("context:glossary", "Glossary")], i);
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<FixNote id="T-1" initial="" claudeReady onCancel={onCancel} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "step 2 is wrong" } });
    fireEvent.click(within(note()).getByRole("button", { name: /^Context/ }));
    const graph = await screen.findByRole("dialog", { name: "Context" });
    fireEvent.click(await within(graph).findByRole("checkbox", { name: "Glossary" }));
    await waitFor(() => expect(within(graph).getByRole("checkbox", { name: "Glossary" })).not.toBeChecked());
    fireEvent.keyDown(graph, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("step 2 is wrong");
    fireEvent.click(within(note()).getByRole("button", { name: "Ask Claude to fix it" }));
    expect(onSubmit).toHaveBeenCalledWith("step 2 is wrong", true, { without: ["context:glossary"] });
  });
});
