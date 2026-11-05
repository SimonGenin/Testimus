// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepImage } from "../../../../../src/core/types.ts";
import { NEW_TABLE } from "../../../../../src/ui/lib/table.ts";
import { FieldBlocks, MOVE } from "../../../../../src/ui/screens/tests/FieldBlocks.tsx";
import { mount } from "../../../helpers/ui-screens.tsx";

afterEach(cleanup);

const images: StepImage[] = [{ file: "images/a.png" }];

const leave = (el: HTMLElement, related: Node | null) => {
  const ev = createEvent.dragLeave(el);
  Object.defineProperty(ev, "relatedTarget", { value: related });
  fireEvent(el, ev);
};

const fb = (text: string, over: { readOnly?: boolean } = {}) => {
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
    expect(container.querySelector('[data-testid="blocks"][data-empty]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    const box = screen.getByLabelText("Action of step 1");
    expect(box).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Delete this text/ })).toBeNull();
    fireEvent.change(box, { target: { value: "typed" } });
    expect(onText).toHaveBeenCalledWith(0, 0, "typed");
    cleanup();
    const ro = fb("", { readOnly: true });
    expect(ro.container.querySelector('[data-testid="blocks"][data-empty]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Image" })).toBeNull();
    expect(ro.container.querySelector('input[type="file"]')).toBeNull();
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
    const plus = screen.getAllByRole("button", { name: "Text" });
    fireEvent.mouseDown(plus[1]);
    fireEvent.click(plus[1]);
    const boxes = screen.getAllByLabelText("Action of step 1") as HTMLTextAreaElement[];
    expect(boxes.map((b) => b.value)).toEqual(["One", "", "Two"]);
    expect(document.activeElement).toBe(boxes[1]);
    fireEvent.blur(boxes[1]);
    expect(screen.getAllByLabelText("Action of step 1")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[3]);
    expect((screen.getAllByLabelText("Action of step 1") as HTMLTextAreaElement[]).map((b) => b.value)).toEqual([
      "One",
      "Two",
      "",
    ]);
  });

  it("adds an image or a table at an insert point", () => {
    const { onAddFiles, onText, container } = fb("One");
    const picker = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    expect(picker).toHaveAttribute("accept", "image/*");
    const click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[1]);
    expect(click).toHaveBeenCalled();
    const shot = new File(["x"], "s.png", { type: "image/png" });
    fireEvent.change(picker, { target: { files: [shot] } });
    expect(onAddFiles).toHaveBeenCalledWith(3, [shot]);
    fireEvent.change(picker, { target: { files: null } });
    expect(onAddFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Table" })[0]);
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
    expect(screen.getByText("old.png")).toBeInTheDocument();
    expect(screen.getByText("Jira no longer holds this image.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "old.png" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Plan from Action of step 1" }));
    expect(onRemove).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "extern" }));
    fireEvent.click(screen.getByRole("button", { name: "Xray markup this editor cannot read" }));
    expect(screen.getByText("!xray-attachment://9!")).toBeInTheDocument();
  });

  it("captions an image block with its file name, not its path", () => {
    const { container } = fb("![](images/a.png)");
    const figure = container.querySelector('[data-testid="image-block"]') as HTMLElement;
    expect(within(figure).getByText("a.png")).toBeInTheDocument();
    expect(figure.querySelector("figcaption")).toHaveTextContent("a.png");
    expect(figure).not.toHaveTextContent("images/a.png");
    const pic = within(figure).getByRole("img", { name: "a.png" }) as HTMLImageElement;
    Object.defineProperty(pic, "naturalWidth", { value: 320 });
    Object.defineProperty(pic, "naturalHeight", { value: 160 });
    fireEvent.load(pic);
    expect(figure.querySelector("figcaption")).toHaveTextContent("a.png320 × 160");
  });

  it("opens an image with Enter but not with Ctrl+Enter, editable or read-only", async () => {
    for (const readOnly of [false, true]) {
      const user = userEvent.setup();
      const { onOpen } = fb("![](images/a.png)", { readOnly });
      const open = screen.getByRole("button", { name: "Open a.png" });
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
    const figure = container.querySelector('[data-testid="image-block"]') as HTMLElement;
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
    expect(document.querySelector('[data-testid="block-grip"]')).toBeNull();
  });

  it("drops a moved block or files on an insert point and highlights it while dragging", () => {
    const { container, onDropBlock, onAddFiles } = fb("One\n\nTwo");
    const zones = container.querySelectorAll('[data-testid="block-insert"]');
    const zone = zones[1] as HTMLElement;
    fireEvent.dragOver(zone, dt());
    expect(zone).not.toHaveAttribute("data-over");
    fireEvent.dragOver(zone, dt({ types: ["Files"] }));
    expect(zone).toHaveAttribute("data-over");
    leave(zone, zone.firstChild);
    expect(zone).toHaveAttribute("data-over");
    leave(zones[0] as HTMLElement, null);
    expect(zone).toHaveAttribute("data-over");
    leave(zone, null);
    expect(zone).not.toHaveAttribute("data-over");
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
    const field = container.querySelector('[data-testid="blocks"]') as HTMLElement;
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
    const f2 = ro.container.querySelector('[data-testid="blocks"]') as HTMLElement;
    fireEvent.dragOver(f2, dt({ types: ["Files"] }));
    fireEvent.drop(f2, dt({ types: ["Files"] }));
    expect(ro.onAddFiles).not.toHaveBeenCalled();
  });

  it("starts a block drag with its slice of the field, never for a draft or read-only", () => {
    const { container } = fb("One");
    const row = container.querySelector('[data-testid="block"]') as HTMLElement;
    const ev = dt();
    fireEvent.dragStart(row, ev);
    expect(ev.dataTransfer.setData).toHaveBeenCalledWith(
      MOVE,
      JSON.stringify({ step: 1, field: "Action", at: 0, end: 3 }),
    );
    expect(ev.dataTransfer.effectAllowed).toBe("move");
    cleanup();
    const empty = fb("");
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    const ev2 = dt();
    fireEvent.dragStart(empty.container.querySelector('[data-testid="block"]') as HTMLElement, ev2);
    expect(ev2.dataTransfer.setData).not.toHaveBeenCalled();
    cleanup();
    const ro = fb("One", { readOnly: true });
    const ev3 = dt();
    fireEvent.dragStart(ro.container.querySelector('[data-testid="block"]') as HTMLElement, ev3);
    expect(ev3.dataTransfer.setData).not.toHaveBeenCalled();
  });
});

describe("TableBlock", () => {
  const TABLE = "Intro\n\n||H1||H2||\n|a|b|\n|c|";
  const B = "Action of step 1, row « a », column « H2 »";

  const focus = (label: string) => {
    const box = screen.getByLabelText(label);
    fireEvent.focus(box);
    return box as HTMLTextAreaElement;
  };
  const pick = (handle: string, item: string) => {
    fireEvent.click(screen.getByRole("button", { name: handle }));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${item}`) }));
  };

  it("edits a cell between Xray's padding spaces, at field offsets, with no tools inside the cell", () => {
    const { onText, onAddFiles, onDropBlock, onFieldText } = fb(TABLE);
    const cell = screen.getByLabelText(B);
    expect(cell).toHaveValue("b");
    fireEvent.change(cell, { target: { value: "B!" } });
    const at = TABLE.indexOf("|b|") + 1;
    expect(onText).toHaveBeenCalledWith(at, at + 1, "B!");
    const grid = within(screen.getByRole("table", { name: "Table in Action of step 1" }));
    expect(grid.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(grid.queryByRole("button", { name: "Text" })).toBeNull();
    const shot = new File(["x"], "s.png", { type: "image/png" });
    (cell as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.paste(cell, { clipboardData: { files: [shot] } });
    expect(onAddFiles).toHaveBeenLastCalledWith(at + 1, [shot]);
    const td = cell.closest("td") as HTMLElement;
    fireEvent.drop(td.firstElementChild as HTMLElement, dt({ types: ["Files"], files: [shot] }));
    expect(onAddFiles).toHaveBeenLastCalledWith(at + 1, [shot]);
    fireEvent.drop(
      td.firstElementChild as HTMLElement,
      dt({ types: [MOVE], move: JSON.stringify({ step: 1, file: "f" }) }),
    );
    expect(onDropBlock).toHaveBeenCalledWith(at + 1, { step: 1, file: "f" });
    expect(screen.getByRole("columnheader", { name: /H1/ })).toHaveAttribute("scope", "col");
    expect(screen.getAllByRole("textbox", { name: /row « c »/ })).toHaveLength(1);
    expect(onFieldText).not.toHaveBeenCalled();
    cleanup();
    const padded = fb("| Fermé | |");
    const f = screen.getByLabelText("Action of step 1, row « Fermé », column 1");
    expect(f).toHaveValue("Fermé");
    fireEvent.change(f, { target: { value: "Fermé " } });
    expect(padded.onText).toHaveBeenLastCalledWith(2, 7, "Fermé ");
    const blank = screen.getByLabelText("Action of step 1, row « Fermé », column 2");
    expect(blank).toHaveValue("");
    fireEvent.change(blank, { target: { value: "x" } });
    expect(padded.onText).toHaveBeenLastCalledWith(9, 10, " x ");
  });

  it("names a new table's heads by a placeholder, and shows the cell hint only where the focus is", () => {
    fb("|| || ||\n| | |");
    const head = screen.getByLabelText("Action of step 1, header row, column 1");
    expect(head).toHaveAttribute("placeholder", "Column name");
    const body = screen.getByLabelText("Action of step 1, row 1, column 1");
    expect(body).not.toHaveAttribute("placeholder");
    fireEvent.focus(body);
    expect(screen.getByLabelText("Action of step 1, row 1, column 1")).toHaveAttribute(
      "placeholder",
      "Type, or paste an image",
    );
  });

  it("acts on the row and the column of the cell being written, from their handles, with Undo for what goes", () => {
    const { onFieldText, onRemove } = fb(TABLE);
    expect(screen.queryByRole("button", { name: /Options for/ })).toBeNull();
    focus(B);
    pick("Options for column « H2 »", "Delete column");
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||\n|a|\n|c|", "Column « H2 » deleted");
    focus(B);
    pick("Options for row « a »", "Delete row");
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2||\n|c|", "Row « a » deleted");
    focus(B);
    pick("Options for row « a »", "Insert row below");
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2||\n|a|b|\n| | |\n|c|");
    focus(B);
    pick("Options for row « a »", "Move down");
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2||\n|c|\n|a|b|");
    focus(B);
    pick("Options for column « H2 »", "Move left");
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H2||H1||\n|b|a|\n|c|");
    focus("Action of step 1, header row, column « H1 »");
    fireEvent.click(screen.getByRole("button", { name: "Options for header row" }));
    expect(screen.getByRole("menuitem", { name: "Insert row above" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Header row" }));
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n|H1|H2|\n|a|b|\n|c|");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(onFieldText).toHaveBeenLastCalledWith(`${TABLE}\n| | |`);
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(onFieldText).toHaveBeenLastCalledWith("Intro\n\n||H1||H2|| ||\n|a|b| |\n|c| |");
    fireEvent.click(screen.getByRole("button", { name: "Table options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete table" }));
    expect(onRemove).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "table" }));
  });

  it("opens the cell's actions on a right click or Shift F10, and moves with the keyboard", () => {
    const { onFieldText } = fb("||H||I||\n|a|b|");
    const a = focus("Action of step 1, row « a », column « H »");
    fireEvent.contextMenu(a.closest("td") as HTMLElement);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("group", { name: "Row « a »" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Column « H »" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete column" }));
    expect(onFieldText).toHaveBeenLastCalledWith("||I||\n|b|", "Column « H » deleted");
    fireEvent.keyDown(a, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onFieldText).toHaveBeenLastCalledWith("||I||H||\n|b|a|");
    fireEvent.keyDown(a, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("goes from cell to cell with Tab, and Tab in the last cell adds a row", () => {
    const { onFieldText } = fb("||H||I||\n|a|b|");
    const a = focus("Action of step 1, row « a », column « H »");
    fireEvent.keyDown(a, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("Action of step 1, row « a », column « I »"));
    const b = focus("Action of step 1, row « a », column « I »");
    fireEvent.keyDown(b, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(focus("Action of step 1, row « a », column « I »"), { key: "Tab" });
    expect(onFieldText).toHaveBeenLastCalledWith("||H||I||\n|a|b|\n| | |");
    cleanup();
    const { rerender, onFieldText: grow } = fb("||H||I||\n|a|b|");
    fireEvent.keyDown(focus("Action of step 1, row « a », column « I »"), { key: "Tab" });
    rerender(
      <FieldBlocks
        idBase="s0-Action"
        name="Action"
        label="Action"
        text={grow.mock.lastCall?.[0] as string}
        images={images}
        url={(f) => `/u/${f}`}
        stepNumber={1}
        onText={vi.fn()}
        onAddFiles={vi.fn()}
        onFieldText={grow}
        onDropBlock={vi.fn()}
        onRemove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Action of step 1, row 2, column « H »"));
  });

  it("is read-only without its bar, handles or ways to grow", () => {
    fb(TABLE, { readOnly: true });
    expect(screen.queryByRole("button", { name: "Table options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
    fireEvent.focus(screen.getByLabelText(B));
    expect(screen.queryByRole("button", { name: /Options for/ })).toBeNull();
    expect(screen.getByLabelText(B)).toHaveAttribute("readonly");
  });

  it("shows a cell's markup it cannot read as raw text", () => {
    fb("||a|||b||");
    expect(screen.getByText("Xray markup this editor cannot read")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Table in/ })?.querySelector("table")).toBeNull();
  });
});

describe("FieldBlocks — a picture copied from a document figure", () => {
  it("names its figure and opens it in the source panel; a picture of unknown origin keeps its file name", async () => {
    const openSource = vi.fn();
    const pics: StepImage[] = [{ file: "images/a.png", figure: "SOSIE_211_D401-1_3#fig:40" }, { file: "images/b.png" }];
    const noop = vi.fn();
    mount(
      <FieldBlocks
        idBase="s0-Expected"
        name="Expected Result"
        label="Expected Result"
        text={"Vu\n\n![](images/a.png)\n\n![](images/b.png)"}
        images={pics}
        url={(f) => `/u/${f}`}
        stepNumber={1}
        readOnly
        onText={noop}
        onAddFiles={noop}
        onFieldText={noop}
        onDropBlock={noop}
        onRemove={noop}
        onOpen={noop}
      />,
      { openSource },
    );
    await userEvent.click(screen.getByRole("button", { name: /^SOSIE_211_D401-1_3 Figure 40/ }));
    expect(openSource).toHaveBeenCalledWith({ docId: "SOSIE_211_D401-1_3", anchor: "fig:40", quote: "" });
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(screen.queryByText("a.png")).toBeNull();
  });

  it("opens the figure through the step's own opener when it has one (the source dialog then knows its step)", async () => {
    const openSource = vi.fn();
    const onOpenSource = vi.fn();
    const noop = vi.fn();
    mount(
      <FieldBlocks
        idBase="s0-Expected"
        name="Expected Result"
        label="Expected Result"
        text="![](images/a.png)"
        images={[{ file: "images/a.png", figure: "D#fig:1" }]}
        url={(f) => `/u/${f}`}
        stepNumber={1}
        readOnly
        onText={noop}
        onAddFiles={noop}
        onFieldText={noop}
        onDropBlock={noop}
        onRemove={noop}
        onOpen={noop}
        onOpenSource={onOpenSource}
      />,
      { openSource },
    );
    await userEvent.click(screen.getByRole("button", { name: /^D Figure 1/ }));
    expect(onOpenSource).toHaveBeenCalledWith({ docId: "D", anchor: "fig:1", quote: "" });
    expect(openSource).not.toHaveBeenCalled();
  });
});
