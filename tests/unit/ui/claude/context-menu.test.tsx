// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ContextMenu } from "../../../../src/ui/components/claude/ContextMenu.tsx";
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

function Holder({ start, text = "", disabled }: { start: string[]; text?: string; disabled?: boolean }) {
  const [ids, setIds] = useState(start);
  const [box, setBox] = useState(text);
  return (
    <>
      <output aria-label="ids">{ids.join(",")}</output>
      <output aria-label="box">{box}</output>
      <ContextMenu
        isOn={(id) => ids.includes(id)}
        onToggle={(id, on) => setIds(on ? [...ids, id] : ids.filter((x) => x !== id))}
        text={box}
        onSaved={(id) => {
          setIds([...ids, id]);
          setBox("");
        }}
        disabled={disabled}
        foot="Ticked contexts go with the columns."
      />
    </>
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Add context" }));

describe("The « + » of a Claude block", () => {
  it("ticks the saved contexts that are on, and switches one on or off in place", async () => {
    render(<Holder start={["c-ops"]} />, { wrapper: dataWrapper() });
    open();
    const ops = await screen.findByRole("menuitemcheckbox", { name: /Operator positions/ });
    expect(ops).toHaveAttribute("aria-checked", "true");
    expect(ops).toHaveTextContent("this project");
    expect(screen.getByRole("menuitemcheckbox", { name: /Signalling glossary/ })).toHaveTextContent("shared");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Signalling glossary/ }));
    expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent(/^c-ops,c-sig$/);
    fireEvent.click(ops);
    expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent(/^c-sig$/);
    expect(screen.getByText("Ticked contexts go with the columns.")).toBeInTheDocument();
  });

  it("says how to make one when there is none yet, and cannot save an empty box", async () => {
    net.routes["contexts.list"] = () => [];
    render(<Holder start={[]} />, { wrapper: dataWrapper() });
    open();
    expect(await screen.findByText(/No saved context yet/)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Save the text as a context…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("saves the box's text as a context, ticks it and empties the box", async () => {
    render(<Holder start={[]} text="Each step names its operator position" />, { wrapper: dataWrapper() });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save the text as a context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(screen.getByRole("status", { name: "ids" })).toHaveTextContent("c-new"));
    expect(callsOf("contexts.create")[0].input).toMatchObject({ notes: "Each step names its operator position" });
    expect(screen.getByRole("status", { name: "box" })).toHaveTextContent(/^$/);
    expect(screen.queryByRole("dialog", { name: "Save as context" })).toBeNull();
  });

  it("opens the contexts manager, and is off while disabled", async () => {
    const r = render(<Holder start={[]} />, { wrapper: dataWrapper() });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Manage contexts…" }));
    expect(await screen.findByRole("dialog", { name: /Contexts/ })).toBeInTheDocument();
    r.unmount();
    render(<Holder start={[]} disabled />, { wrapper: dataWrapper() });
    expect(screen.getByRole("button", { name: "Add context" })).toBeDisabled();
  });
});
