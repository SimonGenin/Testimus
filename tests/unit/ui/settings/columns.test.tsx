// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnsSection } from "../../../../src/ui/screens/settings/ColumnsSection.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { calls, column, Fail, fakeNet, hold, info, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/settings/ColumnsClaude.tsx", () => ({
  ColumnsClaude: () => <div>Ask Claude stub</div>,
}));

let project = info();

beforeEach(() => {
  fakeNet();
  net.routes["project.info"] = () => project;
  net.routes["columns.setModes"] = (i) => {
    const modes = i.modes as Record<string, string>;
    project = {
      ...project,
      columns: project.columns.map((c) => {
        const n = (c as { name: string }).name;
        return modes[n] ? { ...(c as object), mode: modes[n] } : c;
      }),
    };
    return [];
  };
  net.routes["columns.order"] = () => [];
});

afterEach(reset);

const card = (name: string) =>
  within(screen.getByRole("list", { name: "Smart columns" }))
    .getAllByRole("listitem")
    .find(
      (li) => li.querySelector("[id^='settings-column-']")?.id === `settings-column-${name.replace(/\W+/g, "-")}`,
    ) as HTMLElement;

const fold = (name: string) => screen.getByRole("radiogroup", { name: `${name} folding` });
const shown = (name: string) => within(fold(name)).getByRole("radio", { checked: true });

const FIELDS = [
  { id: "action", name: "Action", type: "text", builtin: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true, required: true },
  { id: "cf1", name: "Exigence", type: "text-single", builtin: false, required: true },
  { id: "cf2", name: "Ancienne", type: "text-single", builtin: false, disabled: true },
];

describe("Settings › Smart columns: a field Xray requires or has switched off (audit M-T5)", () => {
  const withOff = (opened = false) =>
    info(
      {},
      {
        fields: FIELDS,
        columns: [
          column("Action", { id: "action" }),
          column("Expected Result", { id: "result" }),
          column("Exigence", { id: "cf1", builtin: false }),
          column("Ancienne", { id: "cf2", builtin: false, mode: opened ? "open" : "filled" }),
        ],
      },
    );

  it("lists a required field and an off field as columns read from Xray, and says so", async () => {
    project = withOff();
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    expect(card("Exigence")).toHaveTextContent("Xray");
    expect(card("Exigence")).toHaveTextContent("Required");
    expect(card("Expected Result")).toHaveTextContent("Xray · standard");
    expect(card("Expected Result")).toHaveTextContent("Required");
    expect(card("Ancienne")).toHaveTextContent("Off in Xray");
    expect(card("Ancienne")).not.toHaveTextContent("Required");
    expect(card("Action")).not.toHaveTextContent("Required");
    expect(card("Action")).not.toHaveTextContent("Off in Xray");
    expect(iconsIn(within(card("Exigence")).getByText("Required")), "audit icons 104").toEqual(["alert-circle"]);
    expect(iconsIn(within(card("Ancienne")).getByText("Off in Xray"))).toEqual(["eye-off"]);
    expect(iconsIn(within(card("Expected Result")).getByText("Xray · standard")), "the kit COLUMN word").toEqual([]);
    const off = within(card("Ancienne")).getByText(/^Switched off in Xray/);
    expect(iconsIn(off), "audit icons 106").toEqual(["info"]);
    expect(within(card("Exigence")).queryByText(/^Switched off in Xray/)).toBeNull();
  });

  it("folds a field switched off in Xray as « when filled » until it is set open", async () => {
    project = withOff();
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    expect(shown("Ancienne")).toHaveAccessibleName("When filled");
    expect(shown("Exigence")).toHaveAccessibleName("Open");
    fireEvent.click(within(fold("Ancienne")).getByRole("radio", { name: "Open" }));
    await waitFor(() => expect(inputs("columns.setModes")[0]).toEqual({ modes: { Ancienne: "open" } }));
  });

  it("shows an off field set open as open", async () => {
    project = withOff(true);
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    expect(shown("Ancienne")).toHaveAccessibleName("Open");
  });
});

describe("Settings › Smart columns", () => {
  const columns = [
    column("Expected Result"),
    column("Action", { mode: "hidden" }),
    column("Exigence", { status: "new", description: "", mode: "filled", builtin: false }),
    column("Note", { mode: "collapsed", builtin: false }),
    column("Remarque", { origin: "local", status: "gone", description: "", builtin: false }),
  ];
  const fields = [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf1", name: "Exigence", type: "text-single", builtin: false },
    { id: "cf2", name: "Note", type: "", builtin: false },
  ];

  it("marks a local column with a file and says it is never pushed (audit icons 104, 106)", async () => {
    project = info(
      {},
      { columns: [column("Action"), column("Poste", { origin: "local", builtin: false })], fields, fetchedAt: "" },
    );
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    expect(iconsIn(within(card("Poste")).getByText("Local only")), "the kit COLUMN word").toEqual(["drive"]);
    expect(iconsIn(within(card("Poste")).getByText(/^Kept in test\.md and never pushed/))).toEqual(["info"]);
    expect(within(card("Action")).queryByText(/^Kept in test\.md/)).toBeNull();
  });

  it("shows each column with its origin, folding, hidden flag, and moves them", async () => {
    project = info({}, { columns, fields, fetchedAt: "2026-11-01T10:00:00Z" });
    mountSettings(<ColumnsSection />);
    const rows = within(await screen.findByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Xray · standard");
    expect(rows[2]).toHaveTextContent("Xray · to describe");
    expect(rows[4]).toHaveTextContent("No longer in Xray");
    expect(iconsIn(within(rows[2]).getByText("Xray · to describe")), "audit icons 104").toEqual(["alert-triangle"]);
    expect(iconsIn(within(rows[4]).getByText("No longer in Xray"))).toEqual(["alert-triangle"]);
    const fresh = within(rows[2])
      .getByText(/^Xray has this step field\. Write above what Claude puts in it/)
      .closest('[role="alert"]') as HTMLElement;
    expect(fresh).toHaveTextContent("Found in Xray, not described yet");
    expect(iconsIn(fresh).slice(0, 1), "audit icons 105: a compact warning banner").toEqual(["alert-triangle"]);
    expect(screen.getByText("Found in Xray, not described yet: Exigence")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Describe it" }));
    expect(screen.getByRole("textbox", { name: /^What Claude writes in Exigence/ })).toHaveFocus();
    expect(screen.getByText(/No longer in Xray, kept as local columns: Remarque\./)).toBeInTheDocument();
    expect(screen.getByText(/Read from Xray/)).toBeInTheDocument();
    const always = within(fold("Action")).getByRole("radio", { name: "When filled" });
    expect(always).toBeDisabled();
    expect(shown("Exigence")).toHaveAccessibleName("When filled");
    expect(shown("Note")).toHaveAccessibleName("Collapsed");
    fireEvent.click(within(fold("Note")).getByRole("radio", { name: "Open" }));
    await waitFor(() => expect(inputs("columns.setModes")[0]).toEqual({ modes: { Note: "open" } }));
    await waitFor(() => expect(shown("Note")).toHaveAccessibleName("Open"));
    fireEvent.click(within(fold("Exigence")).getByRole("radio", { name: "Collapsed" }));
    await waitFor(() => expect(inputs("columns.setModes")[1]).toEqual({ modes: { Exigence: "collapsed" } }));
    const hidden = within(card("Action")).getByRole("switch", { name: "Hidden" });
    expect(hidden).toBeChecked();
    fireEvent.click(hidden);
    await waitFor(() => expect(inputs("columns.setModes")[2]).toEqual({ modes: { Action: "open" } }));
    fireEvent.click(within(card("Note")).getByRole("switch", { name: "Hidden" }));
    await waitFor(() => expect(inputs("columns.setModes")[3]).toEqual({ modes: { Note: "hidden" } }));
    expect(screen.getByRole("button", { name: "Move Expected Result up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Remarque down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Action up" }));
    await waitFor(() =>
      expect(inputs("columns.order")[0]).toEqual({
        names: ["Action", "Expected Result", "Exigence", "Note", "Remarque"],
      }),
    );
  });

  it("leaves a column found in Xray empty: saved with no description, nothing left to describe", async () => {
    project = info({}, { columns, fields });
    net.routes["columns.save"] = () => {
      project = {
        ...project,
        columns: project.columns.map((c) =>
          (c as { name: string }).name === "Exigence" ? { ...(c as object), status: "ok" } : c,
        ),
      };
      return [];
    };
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    fireEvent.click(within(card("Exigence")).getByRole("button", { name: "Leave it empty" }));
    await waitFor(() => expect(inputs("columns.save")[0]).toEqual({ name: "Exigence", description: "" }));
    await waitFor(() => expect(card("Exigence")).not.toHaveTextContent("to describe"));
    expect(screen.queryByText(/^Found in Xray, not described yet/)).toBeNull();
    expect(card("Exigence")).toHaveTextContent("Xray");
  });

  it("moves a column down and puts the order back when it is refused", async () => {
    project = info({}, { columns, fields });
    net.routes["columns.order"] = () => {
      throw new Fail("Refused.");
    };
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    fireEvent.click(screen.getByRole("button", { name: "Move Action down" }));
    await waitFor(() =>
      expect(inputs("columns.order")[0]).toEqual({
        names: ["Expected Result", "Exigence", "Action", "Note", "Remarque"],
      }),
    );
    expect(await screen.findByText("Could not save the smart columns")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("Action");
  });

  it("drags a column onto another, ignores a drop on itself", async () => {
    project = info({}, { columns, fields });
    mountSettings(<ColumnsSection />);
    const rows = within(await screen.findByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragOver(rows[1]);
    fireEvent.dragStart(rows[3], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "Note");
    expect(rows[3]).toHaveAttribute("data-dragging", "true");
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[3]);
    expect(calls("columns.order")).toHaveLength(0);
    fireEvent.dragStart(rows[3], { dataTransfer });
    fireEvent.drop(rows[0]);
    await waitFor(() =>
      expect(inputs("columns.order")[0]).toEqual({
        names: ["Note", "Expected Result", "Action", "Exigence", "Remarque"],
      }),
    );
    const now = within(screen.getByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    fireEvent.dragStart(now[1], { dataTransfer });
    fireEvent.dragEnd(now[1]);
    expect(now[1]).not.toHaveAttribute("data-dragging");
    fireEvent.drop(now[2]);
    expect(calls("columns.order")).toHaveLength(1);
  });

  it("saves a description by itself when changed, adds and removes a local column, and reports failures", async () => {
    project = info({}, { columns, fields });
    net.routes["columns.save"] = () => {
      throw new Fail("Disk full.");
    };
    mountSettings(<ColumnsSection />);
    const box = await screen.findByRole("textbox", { name: label("What Claude writes in Action") });
    expect(box).toHaveValue("Action text");
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("columns.save")).toHaveLength(0);
    fireEvent.change(box, { target: { value: " Un geste " } });
    fireEvent.blur(box);
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    net.routes["columns.save"] = () => [];
    fireEvent.change(box, { target: { value: "Un geste" } });
    fireEvent.blur(box);
    await waitFor(() => expect(inputs("columns.save").at(-1)).toEqual({ name: "Action", description: "Un geste" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    expect(screen.getByRole("button", { name: "Add the column" })).toBeDisabled();
    expect(
      screen
        .getByRole("button", { name: "Cancel" })
        .compareDocumentPosition(screen.getByRole("button", { name: "Add the column" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    fireEvent.change(screen.getByRole("textbox", { name: label("Name of the local column") }), {
      target: { value: " Remarque testeur " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: label("What Claude writes in it") }), {
      target: { value: "Rien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add the column" }));
    expect(await screen.findByText("Column Remarque testeur added")).toBeInTheDocument();
    expect(inputs("columns.save").at(-1)).toEqual({ name: "Remarque testeur", description: "Rien" });
    expect(screen.queryByRole("textbox", { name: label("Name of the local column") })).toBeNull();
    net.routes["columns.save"] = () => {
      throw new Fail("Refused.");
    };
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    fireEvent.change(screen.getByRole("textbox", { name: label("Name of the local column") }), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add the column" }));
    expect(await screen.findByText("Could not add the column")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Remove the column Action" })).toBeNull();
    const trash = screen.getByRole("button", { name: "Remove the column Remarque" });
    expect(iconsIn(trash)).toEqual(["trash"]);
    fireEvent.click(trash);
    let sure = await screen.findByRole("alertdialog", { name: "Remove the column Remarque?" });
    expect(sure).toHaveTextContent("stays in test.md");
    fireEvent.click(within(sure).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("columns.remove")).toHaveLength(0);
    fireEvent.click(trash);
    sure = await screen.findByRole("alertdialog", { name: "Remove the column Remarque?" });
    fireEvent.click(within(sure).getByRole("button", { name: "Remove" }));
    expect(await within(sure).findByText("Unknown command columns.remove")).toBeInTheDocument();
    net.routes["columns.remove"] = () => [];
    fireEvent.click(within(sure).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Column Remarque removed")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(inputs("columns.remove").at(-1)).toEqual({ name: "Remarque" });
  });

  it("reads Xray again and reports failures", async () => {
    project = info({}, { columns: [], fields });
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    expect(screen.queryByText(/Read from Xray/)).toBeNull();
    expect(screen.queryByText(/not described yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Read again from Xray" }));
    expect(await screen.findByText("Could not read the step fields from Jira")).toBeInTheDocument();
    net.routes["xray.refreshFields"] = () => ({ fields: [] });
    const release = hold();
    fireEvent.click(screen.getByRole("button", { name: "Read again from Xray" }));
    expect(await screen.findByRole("button", { name: "Reading…" })).toHaveAttribute("aria-busy", "true");
    release();
    expect(await screen.findByText("Smart columns read again from Xray")).toBeInTheDocument();
  });

  it("a column is a name and what Claude writes in it — no kind of content, no pattern", async () => {
    project = info({}, { columns: [column("Action", { description: "" }), column("Exigence", { builtin: false })] });
    mountSettings(<ColumnsSection />);
    const rows = within(await screen.findByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: label("What Claude writes in Exigence") })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Exigence: kind of content" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Coverage" })).toBeNull();
  });

  it("saves the step column preferences through columns.setModes and columns.order", async () => {
    project = info(
      {},
      {
        columns: ["Action", "Data", "Expected Result", "Exigence"].map((n) =>
          column(n, { description: "", builtin: n !== "Exigence" }),
        ),
      },
    );
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    fireEvent.click(within(card("Exigence")).getByRole("switch", { name: "Hidden" }));
    await waitFor(() => expect(inputs("columns.setModes")).toEqual([{ modes: { Exigence: "hidden" } }]));
    fireEvent.click(within(fold("Data")).getByRole("radio", { name: "When filled" }));
    await waitFor(() => expect(inputs("columns.setModes")[1]).toEqual({ modes: { Data: "filled" } }));
    expect(within(fold("Action")).getByRole("radio", { name: "Collapsed" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Exigence up" }));
    await waitFor(() =>
      expect(inputs("columns.order")).toEqual([{ names: ["Action", "Data", "Exigence", "Expected Result"] }]),
    );
  });
});

describe("Settings › Smart columns › the Reference source option", () => {
  it("saves the option alone at once, as the switches beside it; turns it off; reports a failure", async () => {
    project = info({}, { columns: [column("Action"), column("Exigence", { builtin: false, referenceSource: false })] });
    net.routes["columns.save"] = (i) => {
      project = {
        ...project,
        columns: project.columns.map((c) =>
          (c as { name: string }).name === i.name ? { ...(c as object), referenceSource: i.referenceSource } : c,
        ),
      };
      return [];
    };
    mountSettings(<ColumnsSection />);
    await screen.findByRole("list", { name: "Smart columns" });
    const sw = () => within(card("Exigence")).getByRole("switch", { name: "Reference source" });
    expect(sw()).not.toBeChecked();
    fireEvent.click(sw());
    await waitFor(() => expect(sw()).toBeChecked());
    await waitFor(() => expect(inputs("columns.save").at(-1)).toEqual({ name: "Exigence", referenceSource: true }));
    expect(screen.queryByText("Exigence links its items to their sources")).toBeNull();
    fireEvent.click(sw());
    await waitFor(() => expect(inputs("columns.save").at(-1)).toEqual({ name: "Exigence", referenceSource: false }));
    net.routes["columns.save"] = () => {
      throw new Fail("Refused.");
    };
    await waitFor(() => expect(sw()).not.toBeChecked());
    fireEvent.click(sw());
    expect(await screen.findByText("Could not save the column")).toBeInTheDocument();
    await waitFor(() => expect(sw()).not.toBeChecked());
  });
});

describe("Settings › Smart columns › without a Jira key", () => {
  it("the banner leads to the Jira key field of Project", async () => {
    project = info({ jiraProject: "" });
    const { app } = mountSettings(<ColumnsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Set the Jira key" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "project-jira");
  });
});
