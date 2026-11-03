// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, StepImage, XrayJson } from "../../src/core/types.ts";
import { MOVE } from "../../src/ui/screens/tests/FieldBlocks.tsx";
import { cut, put, StepCard } from "../../src/ui/screens/tests/StepCard.tsx";

type T = { title: string; detail?: string; onExpire?: () => void; action?: { run: () => void } };
const toasts: T[] = [];
const errors: unknown[][] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return {
    ...real,
    toast: vi.fn((t: T) => toasts.push(t)),
    errorToast: vi.fn((...a: unknown[]) => errors.push(a)),
  };
});

beforeEach(() => {
  toasts.length = 0;
  errors.length = 0;
});

afterEach(cleanup);

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: [], hidden: [] },
};

const base: Step = {
  fields: { Action: "Open the view", "Expected Result": "The view opens" },
  sources: [],
  images: [],
};

type Props = Partial<ComponentProps<typeof StepCard>>;

const card = (step: Step = base, over: Props = {}) => {
  const onChange = vi.fn();
  const r = render(
    <StepCard
      index={1}
      count={3}
      step={step}
      xray={xray}
      layout="stacked"
      url={(f) => `/u/${f}`}
      onChange={onChange}
      {...over}
    />,
  );
  const apply = (s: Step = step) => (onChange.mock.lastCall![0] as (s: Step) => Step)(s);
  return { ...r, onChange, apply };
};

const dt = (o: { types?: string[]; move?: unknown; files?: File[] } = {}) => ({
  dataTransfer: {
    types: o.types ?? [],
    getData: (t: string) => (t === MOVE && o.move ? JSON.stringify(o.move) : ""),
    setData: vi.fn(),
    files: o.files ?? [],
    effectAllowed: "",
  },
});

const blocksOf = (container: HTMLElement, field: string) =>
  container.querySelector(`[data-field="${field}"] .blocks`) as HTMLElement;

const fieldNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".step-body > .fl > .fl-k")).map((e) => e.firstChild?.textContent);

describe("put and cut", () => {
  it("join with a blank line, or a single line break inside a table", () => {
    expect(put("ab", 1, "X")).toBe("a\n\nX\n\nb");
    expect(put("", 0, "X")).toBe("X");
    expect(put("|a|b|", 3, "X")).toBe("|a|\nX\nb|");
    expect(cut("a  X  b", 3, 4)).toBe("a\n\nb");
    expect(cut("X", 0, 1)).toBe("");
  });
});

describe("StepCard editing", () => {
  it("replaces and clears text, deleting an emptied field", () => {
    const { apply } = card();
    fireEvent.change(screen.getByLabelText("Action of step 2"), { target: { value: "Close it" } });
    expect(apply().fields.Action).toBe("Close it");
    fireEvent.change(screen.getByLabelText("Action of step 2"), { target: { value: "" } });
    expect("Action" in apply().fields).toBe(false);
  });

  it("types into an empty field through a draft, ignoring blanks", () => {
    const { container, apply } = card();
    fireEvent.click(blocksOf(container, "Data").querySelector(".blk-insert button") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Data of step 2"), { target: { value: "  " } });
    expect(apply().fields.Data).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Data of step 2"), { target: { value: "S 12" } });
    expect(apply().fields.Data).toBe("S 12");
  });

  it("removes a text block, and its undo puts the field back while the test is the same", () => {
    let alive = true;
    const { apply, onChange } = card(base, { alive: () => () => alive });
    fireEvent.click(screen.getByRole("button", { name: "Delete this text of Action of step 2" }));
    expect("Action" in apply().fields).toBe(false);
    expect(toasts[0]).toMatchObject({ title: "Text removed", detail: "Action of step 2" });
    expect(toasts[0].onExpire).toBeUndefined();
    toasts[0].action?.run();
    expect(apply({ ...base, fields: {} }).fields.Action).toBe("Open the view");
    alive = false;
    onChange.mockClear();
    toasts[0].action?.run();
    expect(onChange).not.toHaveBeenCalled();
    expect(toasts.at(-1)?.title).toBe("Too late to undo");
  });

  it("removes a table with its own toast title, and undoes without a token", () => {
    const step = { ...base, fields: { Action: "|a|" } };
    const { apply } = card(step);
    fireEvent.click(screen.getByRole("button", { name: "Delete this table of Action of step 2" }));
    expect(toasts[0].title).toBe("Table removed");
    toasts[0].action?.run();
    expect(apply({ ...base, fields: {} }).fields.Action).toBe("|a|");
  });

  it("removes an image, forgetting the file only when no field embeds it any more", () => {
    const images: StepImage[] = [{ file: "images/a.png" }];
    const twice: Step = {
      ...base,
      fields: { Action: "![](images/a.png)", "Expected Result": "![](images/a.png)" },
      images,
    };
    const one = card(twice);
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Action of step 2" }));
    expect(one.apply().images).toEqual(images);
    expect(toasts[0].title).toBe("Image removed");
    expect(toasts[0].onExpire).toBeUndefined();
    cleanup();
    const onImageGone = vi.fn();
    let alive = true;
    const single = { ...twice, fields: { Action: "![](images/a.png)" } };
    const once = card(single, { onImageGone, alive: () => () => alive });
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Action of step 2" }));
    expect(once.apply().images).toEqual([]);
    const t = toasts.at(-1) as T;
    t.action?.run();
    expect(once.apply({ ...single, fields: {}, images: [] })).toMatchObject({
      fields: { Action: "![](images/a.png)" },
      images,
    });
    expect(once.apply(single).images).toEqual(images);
    t.onExpire?.();
    expect(onImageGone).toHaveBeenCalledWith("images/a.png");
    alive = false;
    t.action?.run();
    expect(onImageGone).toHaveBeenCalledTimes(2);
  });

  it("rewrites a field from its table tools", () => {
    const { apply } = card({ ...base, fields: { Action: "|a|b|" } });
    fireEvent.click(screen.getByRole("button", { name: /Row/ }));
    expect(apply().fields.Action).toBe("|a|b|\n| | |");
    fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
    expect(apply().fields.Action).toBeUndefined();
  });

  it("edits a requirement column and a project text column, and notes columns not in Xray", () => {
    const x: XrayJson = {
      ...xray,
      fields: [...xray.fields, { id: "cf", name: "Exigence", type: "text", builtin: false }],
    };
    const { apply, container } = card({ ...base, fields: { ...base.fields, Exigence: "R1", Note: "n" } }, { xray: x });
    fireEvent.click(screen.getByRole("button", { name: "Remove requirement R1" }));
    expect(apply().fields.Exigence).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Note of step 2"), { target: { value: "noted" } });
    expect(apply().fields.Note).toBe("noted");
    expect(container.querySelector('[data-field="Note"] .fl-note')).toHaveTextContent("not in Xray");
  });

  it("notes no column as not in Xray while Xray is not linked", () => {
    const { container } = card({ ...base, fields: { ...base.fields, Note: "n" } }, { linked: false });
    expect(container.querySelector('[data-field="Note"]')).toBeInTheDocument();
    expect(container.querySelector(".fl-note")).toBeNull();
  });
});

describe("StepCard columns", () => {
  it("folds a column by its project mode and opens it per step", () => {
    const x: XrayJson = { ...xray, prefs: { ...xray.prefs, collapsed: ["Data"] } };
    const { container } = card({ ...base, fields: { ...base.fields, Data: "S 12" } }, { xray: x });
    expect(fieldNames(container)).toEqual(["Action", "Expected Result"]);
    const toggle = screen.getByRole("button", { name: "Data column of step 2" });
    expect(toggle).toHaveTextContent("Data ●");
    expect(toggle).toHaveAttribute("title", "This step has Data");
    fireEvent.click(toggle);
    expect(fieldNames(container)).toEqual(["Action", "Data", "Expected Result"]);
    expect(toggle).toHaveAttribute("title", "Fold Data");
    fireEvent.click(toggle);
    expect(fieldNames(container)).toEqual(["Action", "Expected Result"]);
  });

  it("shows a when-filled column only on a step that holds it", () => {
    const x: XrayJson = { ...xray, prefs: { ...xray.prefs, filled: ["Data"] } };
    const { container } = card(base, { xray: x });
    expect(fieldNames(container)).toEqual(["Action", "Expected Result"]);
    const toggle = screen.getByRole("button", { name: "Data column of step 2" });
    expect(toggle).toHaveTextContent("Data");
    expect(toggle).toHaveAttribute("title", "Show Data");
    cleanup();
    const filled = card({ ...base, fields: { ...base.fields, Data: "x" } }, { xray: x });
    expect(fieldNames(filled.container)).toEqual(["Action", "Data", "Expected Result"]);
  });

  it("follows the modes it is given over the project's", () => {
    const { container } = card(base, { projectModes: { Data: "collapsed" }, testModes: { Data: "open" } });
    expect(fieldNames(container)).toEqual(["Action", "Data", "Expected Result"]);
  });

  it("lays the open columns side by side", () => {
    const { container } = card(base, { layout: "split", claude: true, added: true, dragging: true });
    const body = container.querySelector(".step-body") as HTMLElement;
    expect(body).toHaveClass("is-split");
    expect(body.style.getPropertyValue("--tracks")).toContain("minmax");
    expect(screen.getByText("Added by Claude")).toBeInTheDocument();
    expect(container.querySelector("article")).toHaveClass("is-dragging", "is-claude");
  });
});

describe("StepCard screenshots", () => {
  const shot = () => new File(["x"], "s.png", { type: "image/png" });

  it("uploads dropped images at the end of the field and embeds them", async () => {
    const addImage = vi.fn(async (f: File) => ({ file: `images/${f.name}` }));
    const { container, apply, onChange } = card(base, { addImage });
    fireEvent.drop(
      blocksOf(container, "Expected Result"),
      dt({ types: ["Files"], files: [shot(), new File(["t"], "n.txt", { type: "text/plain" })] }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = apply();
    expect(next.images).toEqual([{ file: "images/s.png" }]);
    expect(next.fields["Expected Result"]).toBe("The view opens\n\n![](images/s.png)");
  });

  it("puts a pasted image where the caret is, clamped to the current text", async () => {
    const addImage = vi.fn(async () => ({ file: "images/p.png" }));
    const { apply, onChange } = card(base, { addImage });
    const box = screen.getByLabelText("Action of step 2") as HTMLTextAreaElement;
    box.setSelectionRange(4, 4);
    fireEvent.paste(box, { clipboardData: { files: [shot()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(apply().fields.Action).toBe("Open\n\n![](images/p.png)\n\nthe view");
    expect(apply({ ...base, fields: {} }).fields.Action).toBe("![](images/p.png)");
  });

  it("puts an image pasted on a field outside its text boxes at the end of the field", async () => {
    const addImage = vi.fn(async () => ({ file: "images/p.png" }));
    const { container, apply, onChange } = card(base, { addImage });
    const row = container.querySelector('[data-field="Expected Result"]') as HTMLElement;
    fireEvent.paste(row, { clipboardData: { files: [new File(["t"], "n.txt", { type: "text/plain" })] } });
    fireEvent.paste(row, { clipboardData: { files: [shot()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(apply().fields["Expected Result"]).toBe("The view opens\n\n![](images/p.png)");
  });

  it("ignores a paste on a project column or when read-only", () => {
    const addImage = vi.fn(async () => ({ file: "images/p.png" }));
    const { container } = card({ ...base, fields: { ...base.fields, Note: "n" } }, { addImage });
    fireEvent.paste(container.querySelector('[data-field="Note"]') as HTMLElement, {
      clipboardData: { files: [shot()] },
    });
    cleanup();
    const ro = card(base, { addImage, readOnly: true });
    fireEvent.paste(ro.container.querySelector('[data-field="Action"]') as HTMLElement, {
      clipboardData: { files: [shot()] },
    });
    expect(addImage).not.toHaveBeenCalled();
  });

  it("ignores non-images, does nothing without an uploader and reports an upload failure", async () => {
    const plain = card(base);
    const row = (c: HTMLElement) => c.querySelector('[data-field="Expected Result"]') as HTMLElement;
    fireEvent.paste(row(plain.container), { clipboardData: { files: [shot()] } });
    expect(plain.onChange).not.toHaveBeenCalled();
    cleanup();
    const addImage = vi.fn(async () => {
      throw new Error("disk full");
    });
    const failing = card(base, { addImage });
    fireEvent.drop(
      blocksOf(failing.container, "Expected Result"),
      dt({ types: ["Files"], files: [new File(["t"], "n.txt", { type: "text/plain" })] }),
    );
    expect(addImage).not.toHaveBeenCalled();
    fireEvent.paste(row(failing.container), { clipboardData: { files: [shot()] } });
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0][1]).toBe("Could not save the screenshot");
    expect(failing.onChange).not.toHaveBeenCalled();
  });
});

describe("StepCard block moves", () => {
  const img: StepImage = { file: "images/a.png" };
  const step: Step = {
    fields: { Action: "One\n\n![](images/a.png)\n\nTwo", "Expected Result": "Done" },
    sources: [],
    images: [img, { file: "images/loose.png" }],
  };

  it("moves a block to the end of another field", () => {
    const { container, apply } = card(step);
    fireEvent.drop(
      blocksOf(container, "Expected Result"),
      dt({ types: [MOVE], move: { step: 2, field: "Action", at: 0, end: 3 } }),
    );
    const next = apply();
    expect(next.fields.Action).toBe("![](images/a.png)\n\nTwo");
    expect(next.fields["Expected Result"]).toBe("Done\n\nOne");
  });

  it("moves a block later in the same field, shifting by what was cut", () => {
    const { container, apply } = card(step);
    fireEvent.drop(
      blocksOf(container, "Action"),
      dt({ types: [MOVE], move: { step: 2, field: "Action", at: 0, end: 3 } }),
    );
    expect(apply().fields.Action).toBe("![](images/a.png)\n\nTwo\n\nOne");
  });

  it("moves a block into an empty field", () => {
    const { container, apply } = card(step);
    const zone = blocksOf(container, "Data").querySelector(".blk-insert") as HTMLElement;
    fireEvent.drop(zone, dt({ types: [MOVE], move: { step: 2, field: "Action", at: 0, end: 3 } }));
    expect(apply().fields.Data).toBe("One");
  });

  it("ignores a drop from another step, onto itself, or of a blank slice", () => {
    const { container, apply } = card(step);
    const drop = (field: string, move: unknown) => {
      fireEvent.drop(blocksOf(container, field), dt({ types: [MOVE], move }));
      return apply();
    };
    expect(drop("Action", { step: 9, field: "Action", at: 0, end: 3 })).toBe(step);
    const len = step.fields.Action.length;
    expect(drop("Action", { step: 2, field: "Action", at: len - 3, end: len })).toBe(step);
    expect(drop("Action", { step: 2, field: "Action", at: 3, end: 5 })).toBe(step);
    expect(drop("Data", { step: 2, field: "Data", at: 0, end: 2 })).toBe(step);
  });

  it("embeds a loose attachment, but only one this step holds", () => {
    const { container, apply } = card(step);
    const zone = blocksOf(container, "Expected Result").querySelector(".blk-insert") as HTMLElement;
    fireEvent.drop(zone, dt({ types: [MOVE], move: { step: 2, file: "images/loose.png" } }));
    expect(apply().fields["Expected Result"]).toBe("![](images/loose.png)\n\nDone");
    fireEvent.drop(zone, dt({ types: [MOVE], move: { step: 2, file: "images/other.png" } }));
    expect(apply()).toBe(step);
    fireEvent.drop(zone, dt({ types: [MOVE], move: { step: 2 } }));
    expect(apply()).toBe(step);
    fireEvent.drop(blocksOf(container, "Data"), dt({ types: [MOVE], move: { step: 2, file: "images/loose.png" } }));
    expect(apply().fields.Data).toBe("![](images/loose.png)");
  });

  it("lists loose attachments, drags, opens and detaches them with an undo", () => {
    const onOpenImage = vi.fn();
    const onImageGone = vi.fn();
    let alive = true;
    const { apply } = card(step, { onOpenImage, onImageGone, alive: () => () => alive });
    expect(screen.getByText("1 attachment not embedded — drag into a field")).toBeInTheDocument();
    const loose = screen.getByRole("img", { name: "loose.png" });
    const ev = dt();
    fireEvent.dragStart(loose, ev);
    expect(ev.dataTransfer.setData).toHaveBeenCalledWith(MOVE, JSON.stringify({ step: 2, file: "images/loose.png" }));
    fireEvent.click(loose);
    expect(onOpenImage).toHaveBeenCalledWith("images/loose.png", step.images);
    fireEvent.click(screen.getByRole("img", { name: "a.png" }));
    expect(onOpenImage).toHaveBeenLastCalledWith("images/a.png", step.images);
    fireEvent.click(screen.getByRole("button", { name: "Detach loose.png from step 2" }));
    expect(apply().images).toEqual([img]);
    const t = toasts.at(-1) as T;
    expect(t).toMatchObject({ title: "Attachment detached", detail: "loose.png of step 2" });
    t.action?.run();
    expect(apply({ ...step, images: [img] }).images).toEqual(step.images);
    expect(apply(step)).toBe(step);
    t.onExpire?.();
    expect(onImageGone).toHaveBeenCalledWith("images/loose.png");
    alive = false;
    t.action?.run();
    expect(onImageGone).toHaveBeenCalledTimes(2);
    cleanup();
    card({ ...step, fields: {}, images: [img, { file: "images/b.png" }] }, { readOnly: true });
    expect(screen.getByText("2 attachments not embedded — drag into a field")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Detach/ })).toBeNull();
    fireEvent.click(screen.getByRole("img", { name: "b.png" }));
  });
});

describe("StepCard Jira version", () => {
  const before: Step = { id: "7", fields: { Action: "Old action" }, sources: [], images: [] };

  it("marks a modified step and shows, then restores, what Jira has", () => {
    const onRestore = vi.fn();
    const onOpenImage = vi.fn();
    const { container } = card({ ...base, id: "7" }, { mark: "modified", before, onRestore, onOpenImage });
    expect(container.querySelector("article")).toHaveClass("is-modified");
    expect(screen.getByText("modified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    expect(screen.getByRole("region", { name: "Step 2 as Jira has it" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore this step" }));
    expect(onRestore).toHaveBeenCalledWith(before);
    fireEvent.click(screen.getByRole("button", { name: "hide Jira version" }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("opens the Jira version's images and offers no restore when read-only or not wired", () => {
    const onOpenImage = vi.fn();
    const withImage: Step = {
      ...before,
      fields: { Action: "![](images/old.png)" },
      images: [{ file: "images/old.png" }],
    };
    card(base, { before: withImage, onOpenImage, readOnly: true, onRestore: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    fireEvent.click(screen.getByRole("img", { name: "old.png" }));
    expect(onOpenImage).toHaveBeenCalledWith("images/old.png", withImage.images);
    expect(screen.queryByRole("button", { name: "Restore this step" })).toBeNull();
    cleanup();
    card(base, { before });
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    expect(screen.queryByRole("button", { name: "Restore this step" })).toBeNull();
  });

  it("marks a new step", () => {
    const { container } = card(base, { mark: "new" });
    expect(container.querySelector("article")).toHaveClass("is-new");
    expect(screen.getByText("new")).toBeInTheDocument();
  });
});

describe("StepCard chrome", () => {
  it("runs the step tools and keyboard shortcuts", () => {
    const h = { onInsert: vi.fn(), onMove: vi.fn(), onDelete: vi.fn(), onFold: vi.fn(), onAsk: vi.fn() };
    const { container } = card(base, h);
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude about step 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert a step below step 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up (Alt+↑)" }));
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 down (Alt+↓)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete step 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    expect(h.onAsk).toHaveBeenCalled();
    expect(h.onInsert).toHaveBeenCalledTimes(1);
    expect(h.onMove.mock.calls).toEqual([[-1], [1]]);
    expect(h.onDelete).toHaveBeenCalled();
    expect(h.onFold).toHaveBeenCalledWith(true);
    const article = container.querySelector("article") as HTMLElement;
    fireEvent.keyDown(article, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(article, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(article, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(article, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(article, { key: "Enter" });
    expect(h.onInsert).toHaveBeenCalledTimes(2);
    expect(h.onMove.mock.calls).toEqual([[-1], [1], [-1], [1]]);
  });

  it("disables moves at the ends and works without handlers", () => {
    const { container } = card(base, { index: 0, count: 1 });
    expect(screen.queryByRole("button", { name: /Ask Claude/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Move step 1 up (Alt+↑)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 1 down (Alt+↓)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fold step 1" }));
    const article = container.querySelector("article") as HTMLElement;
    fireEvent.keyDown(article, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(article, { key: "ArrowUp", altKey: true });
    fireEvent.dragStart(article, dt());
    fireEvent.dragOver(article, dt());
    fireEvent.drop(article, dt());
    fireEvent.dragEnd(article);
  });

  it("is read-only: no tools, no shortcuts, never draggable", () => {
    const onInsert = vi.fn();
    const { container } = card(base, { readOnly: true, onInsert });
    expect(screen.queryByRole("button", { name: "Delete step 2" })).toBeNull();
    const article = container.querySelector("article") as HTMLElement;
    fireEvent.keyDown(article, { key: "Enter", ctrlKey: true });
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector(".grip") as HTMLElement);
    expect(article).toHaveAttribute("draggable", "false");
  });

  it("drags from the grip only, and leaves block and file drags to the fields", () => {
    const h = { onDragStart: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn(), onDragEnd: vi.fn(), onFocus: vi.fn() };
    const { container } = card(base, h);
    const article = container.querySelector("article") as HTMLElement;
    const grip = container.querySelector(".grip") as HTMLElement;
    expect(article).toHaveAttribute("draggable", "false");
    fireEvent.mouseDown(grip);
    expect(article).toHaveAttribute("draggable", "true");
    fireEvent.mouseUp(grip);
    expect(article).toHaveAttribute("draggable", "false");
    fireEvent.mouseDown(grip);
    fireEvent.dragStart(grip, dt());
    expect(h.onDragStart).not.toHaveBeenCalled();
    const start = dt();
    fireEvent.dragStart(article, start);
    expect(start.dataTransfer.setData).toHaveBeenCalledWith("text/plain", "step 2");
    expect(start.dataTransfer.effectAllowed).toBe("move");
    expect(h.onDragStart).toHaveBeenCalled();
    fireEvent.dragOver(article, dt({ types: [MOVE] }));
    fireEvent.dragOver(article, dt({ types: ["Files"] }));
    expect(h.onDragOver).not.toHaveBeenCalled();
    fireEvent.dragOver(article, dt({ types: ["text/plain"] }));
    expect(h.onDragOver).toHaveBeenCalledTimes(1);
    fireEvent.drop(article, dt({ types: [MOVE] }));
    fireEvent.drop(article, dt({ types: ["Files"] }));
    expect(h.onDrop).not.toHaveBeenCalled();
    fireEvent.drop(article, dt({ types: ["text/plain"] }));
    expect(h.onDrop).toHaveBeenCalledTimes(1);
    fireEvent.dragEnd(article);
    expect(h.onDragEnd).toHaveBeenCalled();
    fireEvent.focus(screen.getByLabelText("Action of step 2"));
    expect(h.onFocus).toHaveBeenCalled();
  });

  it("warns about Xray markup it cannot read and opens sources", () => {
    const onOpenSource = vi.fn();
    const source = { docId: "D1", anchor: "§1", quote: "q" };
    const { container } = card(
      { ...base, fields: { Action: "!xray-attachment://1!" }, sources: [source] },
      { onOpenSource },
    );
    expect(container.querySelector("article")).toHaveClass("is-unreadable");
    expect(screen.getByText("Not fully read — never pushed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /D1 §1/ }));
    expect(onOpenSource).toHaveBeenCalledWith(source);
  });

  it("folds to one line and expands back", () => {
    const onFold = vi.fn();
    const { container } = card(
      { ...base, fields: { Action: "![](images/x.png) First\nSecond" } },
      { folded: true, claude: true, dragging: true, mark: "modified", onFold },
    );
    expect(container.querySelector(".step-line")).toHaveTextContent("First");
    expect(container.querySelector("article")).toHaveClass("step-folded", "is-dragging", "is-claude", "is-modified");
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand step 2" }));
    expect(onFold).toHaveBeenCalledWith(false);
    cleanup();
    card({ ...base, fields: {} }, { folded: true });
    expect(screen.getByText("Empty step")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand step 2" }));
    cleanup();
    const none: XrayJson = { fields: [], prefs: { order: [], collapsed: [], hidden: [] } };
    card({ ...base, fields: { Action: "Only action" } }, { folded: true, xray: none });
    expect(screen.getByText("Only action")).toBeInTheDocument();
  });

  it("shows the step number as visible text, open or folded", () => {
    const { container } = card(base, { index: 4, count: 6 });
    expect(container.querySelector(".step-head .num")?.textContent).toBe("5");
    cleanup();
    const folded = card(base, { index: 4, count: 6, folded: true });
    expect(folded.container.querySelector("article .num")?.textContent).toBe("5");
  });
});
