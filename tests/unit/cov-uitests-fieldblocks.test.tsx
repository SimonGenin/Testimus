// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepImage } from "../../src/core/types.ts";
import { NEW_TABLE } from "../../src/ui/lib/table.ts";
import { FieldBlocks, MOVE } from "../../src/ui/screens/tests/FieldBlocks.tsx";
import { RequirementField } from "../../src/ui/screens/tests/RequirementField.tsx";

afterEach(cleanup);

const images: StepImage[] = [{ file: "images/a.png" }];

const leave = (el: HTMLElement, related: Node | null) => {
  const ev = createEvent.dragLeave(el);
  Object.defineProperty(ev, "relatedTarget", { value: related });
  fireEvent(el, ev);
};

const fb = (text: string, over: { readOnly?: boolean; nested?: boolean } = {}) => {
  const h = {
    onText: vi.fn(),
    onAddFiles: vi.fn(),
    onFieldText: vi.fn(),
    onDropBlock: vi.fn(),
    onRemove: vi.fn(),
    onOpen: vi.fn(),
  };
  const r = render(
    <FieldBlocks
      idBase="s0-Action"
      name="Action"
      label="Action"
      text={text}
      images={images}
      url={(f) => `/u/${f}`}
      stepNumber={1}
      {...over}
      {...h}
    />,
  );
  return { ...r, ...h };
};

const dt = (o: { types?: string[]; move?: string; files?: File[] } = {}) => ({
  dataTransfer: {
    types: o.types ?? [],
    getData: (t: string) => (t === MOVE ? (o.move ?? "") : ""),
    setData: vi.fn(),
    files: o.files ?? [],
    effectAllowed: "",
  },
});

describe("FieldBlocks", () => {
  it("shows an empty field as its insert strip alone, and types into a draft opened there", () => {
    const { container, onText } = fb("");
    expect(screen.queryByLabelText("Action of step 1")).toBeNull();
    expect(container.querySelector(".blocks.is-empty")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ text" }));
    const box = screen.getByLabelText("Action of step 1");
    expect(box).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Delete this text/ })).toBeNull();
    fireEvent.change(box, { target: { value: "typed" } });
    expect(onText).toHaveBeenCalledWith(0, 0, "typed");
    cleanup();
    const nested = fb("", { nested: true });
    expect(nested.container.querySelector(".blocks.is-empty")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "+ table" })).toBeNull();
    cleanup();
    const ro = fb("", { readOnly: true });
    expect(ro.container.querySelector(".blocks.is-empty")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "+ text" })).toBeNull();
    expect(screen.queryByLabelText("Add Action screenshots to step 1")).toBeNull();
  });

  it("edits, deletes and pastes images into a text block", () => {
    const { onText, onRemove, onAddFiles } = fb("Hello");
    const box = screen.getByLabelText("Action of step 1") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Hello you" } });
    expect(onText).toHaveBeenCalledWith(0, 5, "Hello you");
    fireEvent.click(screen.getByRole("button", { name: "Delete this text of Action of step 1" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ kind: "text", text: "Hello" }));
    fireEvent.paste(box, { clipboardData: { files: [new File(["x"], "n.txt", { type: "text/plain" })] } });
    expect(onAddFiles).not.toHaveBeenCalled();
    const shot = new File(["x"], "s.png", { type: "image/png" });
    box.setSelectionRange(2, 2);
    fireEvent.paste(box, { clipboardData: { files: [shot] } });
    expect(onAddFiles).toHaveBeenCalledWith(2, [shot]);
    fireEvent.blur(box);
  });

  it("opens a draft box between blocks, focuses it and drops it on blur", () => {
    fb("One\n\n![](images/a.png)\n\nTwo");
    const plus = screen.getAllByRole("button", { name: "+ text" });
    fireEvent.mouseDown(plus[1]);
    fireEvent.click(plus[1]);
    const boxes = screen.getAllByLabelText("Action of step 1") as HTMLTextAreaElement[];
    expect(boxes.map((b) => b.value)).toEqual(["One", "", "Two"]);
    expect(document.activeElement).toBe(boxes[1]);
    fireEvent.blur(boxes[1]);
    expect(screen.getAllByLabelText("Action of step 1")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "+ text" })[3]);
    expect((screen.getAllByLabelText("Action of step 1") as HTMLTextAreaElement[]).map((b) => b.value)).toEqual([
      "One",
      "Two",
      "",
    ]);
  });

  it("adds an image or a table at an insert point", () => {
    const { onAddFiles, onText } = fb("One");
    const picker = screen.getByLabelText("Add Action screenshots to step 1") as HTMLInputElement;
    const click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getAllByRole("button", { name: "+ image" })[1]);
    expect(click).toHaveBeenCalled();
    const shot = new File(["x"], "s.png", { type: "image/png" });
    fireEvent.change(picker, { target: { files: [shot] } });
    expect(onAddFiles).toHaveBeenCalledWith(3, [shot]);
    fireEvent.change(picker, { target: { files: null } });
    expect(onAddFiles).toHaveBeenLastCalledWith(3, []);
    fireEvent.click(screen.getAllByRole("button", { name: "+ table" })[0]);
    expect(onText).toHaveBeenCalledWith(0, 0, NEW_TABLE);
  });

  it("shows images, external images, dead blob links and raw markup", () => {
    const text = [
      "![](images/a.png)",
      '!https://x.example/p.png|alt="Plan"!',
      "!https://x.example/q.png!",
      '!blob:https://jira/788f|alt="old.png"!',
      "!xray-attachment://9!",
    ].join("\n\n");
    const { onOpen, onRemove } = fb(text);
    fireEvent.click(screen.getByRole("img", { name: "a.png" }));
    expect(onOpen).toHaveBeenCalledWith("images/a.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Action of step 1" }));
    expect(onRemove).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "image" }));
    expect(screen.getByRole("img", { name: "Plan" })).toHaveAttribute("src", "https://x.example/p.png");
    expect(screen.getByRole("img", { name: "https://x.example/q.png" })).toBeInTheDocument();
    expect(screen.getByText("old.png — Jira no longer holds this image")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "old.png" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Plan from Action of step 1" }));
    expect(onRemove).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "extern" }));
    expect(screen.getByText("Xray markup this editor cannot read")).toBeInTheDocument();
    expect(screen.getByText("!xray-attachment://9!")).toBeInTheDocument();
  });

  it("captions an image block with its file name, not its path", () => {
    const { container } = fb("![](images/a.png)");
    const figure = container.querySelector("figure.imgblock") as HTMLElement;
    expect(within(figure).getByText("a.png")).toHaveClass("imgblock-name");
    expect(figure.querySelector("figcaption")).toHaveTextContent("a.png");
    expect(figure).not.toHaveTextContent("images/a.png");
  });

  it("opens an image with Enter but not with Ctrl+Enter, editable or read-only", async () => {
    for (const readOnly of [false, true]) {
      const user = userEvent.setup();
      const { onOpen } = fb("![](images/a.png)", { readOnly });
      const open = screen.getByRole("button", { name: "a.png" });
      open.focus();
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onOpen).not.toHaveBeenCalled();
      await user.keyboard("{Enter}");
      expect(onOpen).toHaveBeenCalledWith("images/a.png");
      cleanup();
    }
  });

  it("still names an image whose file is missing", () => {
    const { container } = fb("![](images/a.png)", {});
    const img = screen.getByRole("img", { name: "a.png" });
    fireEvent.error(img);
    const figure = container.querySelector("figure.imgblock") as HTMLElement;
    expect(within(figure).getByText("a.png")).toBeVisible();
    expect(img).toHaveAttribute("alt", "a.png");
    expect(img).toHaveAttribute("src", "/u/images/a.png");
  });

  it("shows blocks read-only without tools", () => {
    fb('![](images/a.png)\n\n!https://x.example/p.png|alt="Plan"!\n\n!xray-attachment://9!\n\n|a|', {
      readOnly: true,
    });
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(document.querySelector(".blk-handle")).toBeNull();
  });

  it("drops a moved block or files on an insert point and highlights it while dragging", () => {
    const { container, onDropBlock, onAddFiles } = fb("One\n\nTwo");
    const zones = container.querySelectorAll(".blk-insert");
    const zone = zones[1] as HTMLElement;
    fireEvent.dragOver(zone, dt());
    expect(zone).not.toHaveClass("is-over");
    fireEvent.dragOver(zone, dt({ types: ["Files"] }));
    expect(zone).toHaveClass("is-over");
    leave(zone, zone.firstChild);
    expect(zone).toHaveClass("is-over");
    leave(zones[0] as HTMLElement, null);
    expect(zone).toHaveClass("is-over");
    leave(zone, null);
    expect(zone).not.toHaveClass("is-over");
    fireEvent.drop(zone, dt());
    expect(onAddFiles).not.toHaveBeenCalled();
    const shot = new File(["x"], "s.png", { type: "image/png" });
    fireEvent.drop(zone, dt({ types: ["Files"], files: [shot] }));
    expect(onAddFiles).toHaveBeenCalledWith(8, [shot]);
    const moved = { step: 1, field: "Data", at: 0, end: 2 };
    fireEvent.drop(zone, dt({ types: [MOVE], move: JSON.stringify(moved) }));
    expect(onDropBlock).toHaveBeenCalledWith(8, moved);
  });

  it("drops onto the field itself at its end, but not when read-only", () => {
    const { container, onDropBlock, onAddFiles } = fb("One");
    const field = container.querySelector(".blocks") as HTMLElement;
    const over = dt({ types: ["Files"] });
    fireEvent.dragOver(field, over);
    fireEvent.dragOver(field, dt());
    fireEvent.drop(field, dt());
    fireEvent.drop(field, dt({ types: ["Files"], files: [] }));
    expect(onAddFiles).toHaveBeenCalledWith(3, []);
    fireEvent.drop(field, dt({ types: [MOVE], move: JSON.stringify({ step: 1, file: "images/a.png" }) }));
    expect(onDropBlock).toHaveBeenCalledWith(3, { step: 1, file: "images/a.png" });
    cleanup();
    const ro = fb("One", { readOnly: true });
    const f2 = ro.container.querySelector(".blocks") as HTMLElement;
    fireEvent.dragOver(f2, dt({ types: ["Files"] }));
    fireEvent.drop(f2, dt({ types: ["Files"] }));
    expect(ro.onAddFiles).not.toHaveBeenCalled();
  });

  it("starts a block drag with its slice of the field, never for a draft or read-only", () => {
    const { container } = fb("One");
    const row = container.querySelector(".blk-row") as HTMLElement;
    const ev = dt();
    fireEvent.dragStart(row, ev);
    expect(ev.dataTransfer.setData).toHaveBeenCalledWith(
      MOVE,
      JSON.stringify({ step: 1, field: "Action", at: 0, end: 3 }),
    );
    expect(ev.dataTransfer.effectAllowed).toBe("move");
    cleanup();
    const empty = fb("");
    fireEvent.click(screen.getByRole("button", { name: "+ text" }));
    const ev2 = dt();
    fireEvent.dragStart(empty.container.querySelector(".blk-row") as HTMLElement, ev2);
    expect(ev2.dataTransfer.setData).not.toHaveBeenCalled();
    cleanup();
    const ro = fb("One", { readOnly: true });
    const ev3 = dt();
    fireEvent.dragStart(ro.container.querySelector(".blk-row") as HTMLElement, ev3);
    expect(ev3.dataTransfer.setData).not.toHaveBeenCalled();
  });
});

describe("TableBlock", () => {
  const TABLE = "Intro\n\n||H1||H2||\n|a|b|\n|c|";

  it("edits a cell and forwards every cell action at field offsets", () => {
    const { onText, onAddFiles, onDropBlock, onRemove, onFieldText } = fb(TABLE);
    const cell = screen.getByLabelText("Action, row 2 column 2 of step 1");
    expect(cell).toHaveValue("b");
    fireEvent.change(cell, { target: { value: "B!" } });
    const at = TABLE.indexOf("|b|") + 1;
    expect(onText).toHaveBeenCalledWith(at, at + 1, "B!");
    fireEvent.click(screen.getByRole("button", { name: "Delete this text of Action, row 2 column 2 of step 1" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ at, end: at + 1 }));
    const zone = cell.closest(".blocks")?.querySelector(".blk-insert") as HTMLElement;
    const shot = new File(["x"], "s.png", { type: "image/png" });
    fireEvent.drop(zone, dt({ types: ["Files"], files: [shot] }));
    expect(onAddFiles).toHaveBeenCalledWith(at, [shot]);
    fireEvent.drop(zone, dt({ types: [MOVE], move: JSON.stringify({ step: 1, file: "f" }) }));
    expect(onDropBlock).toHaveBeenCalledWith(at, { step: 1, file: "f" });
    expect(screen.getByRole("columnheader", { name: /H1/ })).toHaveAttribute("scope", "col");
    expect(screen.getAllByRole("textbox", { name: /row 3 column \d of step 1/ })).toHaveLength(1);
    expect(onFieldText).not.toHaveBeenCalled();
  });

  it("adds and deletes rows and columns, and deletes the table", () => {
    const { onFieldText, onRemove } = fb(TABLE);
    fireEvent.click(screen.getByRole("button", { name: "Delete column 2" }));
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||\n|a|\n|c|");
    fireEvent.click(screen.getByRole("button", { name: "Delete row 3" }));
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2||\n|a|b|");
    fireEvent.click(screen.getByRole("button", { name: /Row/ }));
    expect(onFieldText).toHaveBeenLastCalledWith(`${TABLE}\n| | |`);
    fireEvent.click(screen.getByRole("button", { name: /Column/ }));
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2|| ||\n|a|b| |\n|c| |");
    fireEvent.click(screen.getByRole("button", { name: "Delete this table of Action of step 1" }));
    expect(onRemove).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "table" }));
  });

  it("is read-only without grips or operations", () => {
    fb(TABLE, { readOnly: true });
    expect(screen.queryByRole("button", { name: /Delete column/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Row/ })).toBeNull();
    expect(screen.getByLabelText("Action, row 1 column 1 of step 1")).toHaveAttribute("readonly");
  });

  it("passes a nested table rewrite through at the cell offsets, with no table button in a cell", () => {
    const h = fb("||a|||b||");
    const cell = screen.getByLabelText("Action, row 1 column 1 of step 1");
    expect(within(cell.closest(".blocks") as HTMLElement).queryByRole("button", { name: "+ table" })).toBeNull();
    const rows = screen.getAllByRole("button", { name: "Delete row 1" });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);
    expect(h.onFieldText).toHaveBeenLastCalledWith("||a||||");
  });
});

describe("RequirementField", () => {
  const rf = (value: string, readOnly = false) => {
    const onChange = vi.fn();
    render(<RequirementField label="Exigence" value={value} stepNumber={2} readOnly={readOnly} onChange={onChange} />);
    return onChange;
  };

  it("adds ids on Enter, skipping known ones, and removes one", () => {
    const onChange = rf("R1, R2");
    fireEvent.click(screen.getByRole("button", { name: "Remove requirement R1" }));
    expect(onChange).toHaveBeenLastCalledWith("R2");
    fireEvent.click(screen.getByRole("button", { name: "Add Exigence to step 2" }));
    const input = screen.getByRole("textbox", { name: "Add Exigence to step 2" });
    fireEvent.change(input, { target: { value: "R2 R3;R4" } });
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("R1, R2, R3, R4");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("commits on blur, does nothing for known ids, and cancels on Escape", () => {
    const onChange = rf("R1");
    fireEvent.click(screen.getByRole("button", { name: "Add Exigence to step 2" }));
    let input = screen.getByRole("textbox", { name: "Add Exigence to step 2" });
    fireEvent.change(input, { target: { value: "R1" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add Exigence to step 2" }));
    input = screen.getByRole("textbox", { name: "Add Exigence to step 2" });
    fireEvent.change(input, { target: { value: "R9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is read-only without add or remove", () => {
    rf("R1", true);
    expect(screen.getByText("R1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
