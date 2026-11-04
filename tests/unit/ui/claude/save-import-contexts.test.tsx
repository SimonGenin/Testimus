// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { AdditionalContext } from "../../../../src/ui/components/claude/AdditionalContext.tsx";
import { ImportContexts } from "../../../../src/ui/components/claude/ImportContexts.tsx";
import { SaveContext } from "../../../../src/ui/components/claude/SaveContext.tsx";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, Fail, fakeNet, net } from "../../helpers/ui-data.tsx";

let titles: string[] = [];
let ids: number[] = [];
function Probe() {
  const t = useToasts();
  titles = t.map((x) => x.title);
  ids = t.map((x) => x.id);
  return null;
}

const CTX = [
  { id: "c-ops", name: "Operator positions", paths: [], files: ["ops.md"], hasNotes: true },
  { id: "c-sig", name: "Signalling glossary", paths: ["D:/g"], files: [], hasNotes: false, shared: true },
];

beforeEach(() => {
  fakeNet();
  setProject("D:/p");
  net.routes["contexts.list"] = () => CTX;
  net.routes["contexts.create"] = (i) => ({ id: "c-new", name: i.name, notes: i.notes, paths: [], files: [] });
});
afterEach(() => {
  cleanup();
  for (const id of ids) closeToast(id);
  vi.unstubAllGlobals();
});

describe("Save as context", () => {
  it("names the context after the note's first line, saves it shared when ticked, and says so", async () => {
    const saved = vi.fn();
    const closed = vi.fn();
    render(
      <>
        <Probe />
        <SaveContext note={"  Positions of the operator\nmore lines"} onSaved={saved} onClose={closed} />
      </>,
      { wrapper: dataWrapper() },
    );
    const dialog = screen.getByRole("dialog", { name: "Save as context" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Positions of the operator");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Shared with every project/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("c-new"));
    expect(closed).toHaveBeenCalled();
    expect(callsOf("contexts.create")[0].input).toEqual({
      name: "Positions of the operator",
      shared: true,
      notes: "Positions of the operator\nmore lines",
    });
    expect(titles).toContain("Context « Positions of the operator » saved");
  });

  it("cannot save without a name, and shows why a save failed while staying open", async () => {
    net.routes["contexts.create"] = () => {
      throw new Fail("A context named « x » already exists");
    };
    const saved = vi.fn();
    render(<SaveContext note="x" onSaved={saved} onClose={() => {}} />, { wrapper: dataWrapper() });
    const dialog = screen.getByRole("dialog", { name: "Save as context" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText(/Could not save the context: A context named « x » already exists/),
    ).toBeVisible();
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Save as context" })).toBeVisible();
  });
});

describe("Import saved contexts for a whole list", () => {
  it("starts from what is picked, ticks and unticks, and uses the ticked ones at once", async () => {
    const used = vi.fn();
    const closed = vi.fn();
    render(<ImportContexts all={CTX} picked={["c-ops"]} onUse={used} onManage={() => {}} onClose={closed} />);
    const dialog = screen.getByRole("dialog", { name: "Saved contexts" });
    expect(within(dialog).getByRole("checkbox", { name: /Operator positions/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Signalling glossary/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use 2" }));
    expect(used).toHaveBeenCalledWith(["c-ops", "c-sig"]);
    expect(closed).toHaveBeenCalled();
  });

  it("uses none when everything is unticked, and hands Manage to the caller", () => {
    const used = vi.fn();
    const manage = vi.fn();
    render(<ImportContexts all={CTX} picked={["c-ops"]} onUse={used} onManage={manage} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Operator positions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    expect(manage).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use none" }));
    expect(used).toHaveBeenCalledWith([]);
  });
});

function Holder({ start, compact, disabled }: { start: string[]; compact?: boolean; disabled?: boolean }) {
  const [ids, setIds] = useState(start);
  const [note, setNote] = useState("");
  return (
    <>
      <output aria-label="ids">{ids.join(",")}</output>
      <AdditionalContext
        id="extra"
        of="the columns"
        ids={ids}
        note={note}
        compact={compact}
        disabled={disabled}
        onIds={setIds}
        onNote={setNote}
      />
    </>
  );
}

describe("The extra context of a run", () => {
  it("shows the picked contexts as chips by name, and leaves one out with its chip", async () => {
    render(<Holder start={["c-ops", "c-sig", "c-gone"]} />, { wrapper: dataWrapper() });
    await screen.findByText("Operator positions");
    expect(screen.queryByText("c-gone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave Operator positions out of the columns" }));
    expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent(/^c-sig$/);
  });

  it("while disabled, a chip cannot be removed", async () => {
    render(<Holder start={["c-ops"]} disabled />, { wrapper: dataWrapper() });
    await screen.findByText("Operator positions");
    expect(screen.queryByRole("button", { name: /Leave Operator positions out/ })).toBeNull();
  });

  it("compact: the note opens on « Add a note », and a note saved as a context becomes a picked context", async () => {
    render(<Holder start={[]} compact />, { wrapper: dataWrapper() });
    expect(screen.queryByRole("textbox", { name: "Note for the columns" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    const note = screen.getByRole("textbox", { name: "Note for the columns" });
    fireEvent.change(note, { target: { value: "Each step names its operator position" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent("c-new"));
    expect(screen.queryByRole("dialog", { name: "Save as context" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Note for the columns" })).toBeNull();
  });

  it("imports a saved context with a tick, and closes the picker with Done", async () => {
    render(<Holder start={[]} />, { wrapper: dataWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "Import saved context" }));
    const dialog = screen.getByRole("dialog", { name: "Saved contexts" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Signalling glossary/ }));
    expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent("c-sig");
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Saved contexts" })).toBeNull();
  });
});
