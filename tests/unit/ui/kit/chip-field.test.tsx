// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { ChipField, type ChipFieldProps } from "../../../../src/ui/components/ui/ChipField.tsx";

afterEach(cleanup);

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

function Labels(props: Partial<ChipFieldProps> & { initial?: string[]; seen?: (v: string[]) => void }) {
  const [values, setValues] = useState(props.initial ?? ["testimus-checked"]);
  return (
    <ChipField
      label="Labels"
      placeholder="Add a label…"
      {...props}
      values={values}
      onChange={(v) => {
        setValues(v);
        props.seen?.(v);
      }}
    />
  );
}

const box = () => screen.getByRole("textbox", { name: "Labels" });
const combo = () => screen.getByRole("combobox", { name: "Labels" });
const chips = () =>
  screen
    .queryAllByRole("button", { name: /^Remove / })
    .map((b) => (b.getAttribute("aria-label") ?? "").replace("Remove ", ""));

describe("ChipField", () => {
  it("shows each value as a chip before a text box named by its label", () => {
    render(<Labels initial={["testimus-checked", "traction"]} />);
    expect(chips()).toEqual(["testimus-checked", "traction"]);
    expect(box()).toHaveAttribute("placeholder", "Add a label…");
  });

  it("Enter adds the typed value, trimmed, once", () => {
    const seen = vi.fn();
    render(<Labels seen={seen} />);
    fireEvent.change(box(), { target: { value: "  traction " } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chips()).toEqual(["testimus-checked", "traction"]);
    expect(box()).toHaveValue("");
    fireEvent.change(box(), { target: { value: "traction" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chips()).toEqual(["testimus-checked", "traction"]);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("a comma or a semicolon adds, and a pasted list adds each value", () => {
    render(<Labels initial={[]} />);
    fireEvent.change(box(), { target: { value: "a," } });
    expect(chips()).toEqual(["a"]);
    fireEvent.change(box(), { target: { value: "b;" } });
    expect(chips()).toEqual(["a", "b"]);
    fireEvent.change(box(), { target: { value: "c, d; a, e;" } });
    expect(chips()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("leaving the box adds what was typed", () => {
    render(<Labels initial={[]} />);
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.blur(box());
    expect(chips()).toEqual(["x"]);
  });

  it("Backspace in an empty box removes the last chip; the ✕ removes its own", () => {
    render(<Labels initial={["a", "b", "c"]} />);
    fireEvent.change(box(), { target: { value: "z" } });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(chips()).toEqual(["a", "b", "c"]);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(chips()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove a" }));
    expect(chips()).toEqual(["b"]);
  });

  it("without onChange the chips are only read: no box, no ✕, a group named by the label", () => {
    render(<ChipField label="Covers" values={["LFRPS12-880"]} mono />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("group", { name: "Covers" })).toHaveTextContent("LFRPS12-880");
  });

  it("shows its label above the field", () => {
    render(<Labels showLabel />);
    expect(screen.getByText("Labels").tagName).toBe("LABEL");
    expect(box()).toBeVisible();
  });

  it("a click on the frame puts the caret in the box", () => {
    render(<Labels />);
    const frame = box().closest("span")?.parentElement as Element;
    fireEvent.click(frame);
    expect(box()).toHaveFocus();
  });

  it("disabled: the box is off and the chips cannot be removed", () => {
    render(<ChipField label="Labels" values={["a"]} onChange={() => {}} disabled />);
    expect(box()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove a" })).toBeNull();
  });

  it("shows trailing content at the end of the field", () => {
    render(<Labels trailing={<Button size="sm" label="Browse…" />} />);
    expect(screen.getByRole("button", { name: "Browse…" })).toBeVisible();
  });

  it("suggests as you type: a combobox and a listbox without the values already there", async () => {
    const suggest = vi.fn((q: string) => Promise.resolve(["traction", "testimus-checked", `${q}-new`]));
    render(<Labels suggest={suggest} />);
    expect(combo()).toHaveAttribute("aria-expanded", "false");
    await act(async () => combo().focus());
    expect(suggest).toHaveBeenLastCalledWith("");
    const list = screen.getByRole("listbox", { name: "Labels" });
    expect(combo()).toHaveAttribute("aria-expanded", "true");
    expect(combo()).toHaveAttribute("aria-controls", list.id);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["traction", "-new"]);
    await act(async () => fireEvent.change(combo(), { target: { value: "tr" } }));
    expect(suggest).toHaveBeenLastCalledWith("tr");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["traction", "tr-new"]);
  });

  it("the arrows move through the suggestions, Enter picks one, a click picks one, Escape closes", async () => {
    render(<Labels initial={[]} suggest={() => ["alpha", "beta", "gamma"]} />);
    await act(async () => combo().focus());
    fireEvent.keyDown(combo(), { key: "ArrowDown" });
    fireEvent.keyDown(combo(), { key: "ArrowDown" });
    const beta = screen.getByRole("option", { name: "beta" });
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(combo()).toHaveAttribute("aria-activedescendant", beta.id);
    fireEvent.keyDown(combo(), { key: "ArrowUp" });
    fireEvent.keyDown(combo(), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "gamma" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(chips()).toEqual(["gamma"]);
    expect(combo()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.click(screen.getByRole("option", { name: "alpha" }));
    expect(chips()).toEqual(["gamma", "alpha"]);
    fireEvent.keyDown(combo(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(combo(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("asks once per query, even when the screen passes a new function at each render", async () => {
    const calls: string[] = [];
    render(
      <Labels
        initial={[]}
        suggest={(q) => {
          calls.push(q);
          return ["alpha"];
        }}
      />,
    );
    await act(async () => combo().focus());
    await act(async () => fireEvent.change(combo(), { target: { value: "a" } }));
    expect(calls).toEqual(["", "a"]);
  });

  it("an answer to an older query is dropped", async () => {
    const answers: Record<string, (v: string[]) => void> = {};
    render(<Labels initial={[]} suggest={(q) => new Promise((ok) => (answers[q] = ok))} />);
    await act(async () => combo().focus());
    await act(async () => fireEvent.change(combo(), { target: { value: "b" } }));
    await act(async () => answers.b(["beta"]));
    await act(async () => answers[""](["old"]));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["beta"]);
  });

  it("with choices only these can be added; chips show their label; the list filters without accents", async () => {
    const seen = vi.fn();
    const choices = [
      { value: "LFRPS12-10", label: "Session ouverte" },
      { value: "LFRPS12-11", label: "Écran d'accueil affiché" },
      { value: "LFRPS12-12", label: "Droits administrateur" },
    ];
    render(<Labels initial={["LFRPS12-10"]} choices={choices} seen={seen} />);
    expect(chips()).toEqual(["Session ouverte"]);
    await act(async () => combo().focus());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Écran d'accueil affiché",
      "Droits administrateur",
    ]);
    fireEvent.change(combo(), { target: { value: "nothing, at all," } });
    fireEvent.keyDown(combo(), { key: "Enter" });
    fireEvent.blur(combo());
    expect(seen).not.toHaveBeenCalled();
    await act(async () => combo().focus());
    fireEvent.change(combo(), { target: { value: "ecran" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Écran d'accueil affiché"]);
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(seen).toHaveBeenLastCalledWith(["LFRPS12-10", "LFRPS12-11"]);
    expect(chips()).toEqual(["Session ouverte", "Écran d'accueil affiché"]);
  });

  it("with choices, text that matches none adds nothing", () => {
    const seen = vi.fn();
    render(
      <ChipField
        label="Labels"
        values={["a"]}
        choices={[{ value: "a", label: "A" }]}
        onChange={seen}
        debugState="focus"
      />,
    );
    fireEvent.change(combo(), { target: { value: "B" } });
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("mono chips, the inline appearance and the catalogue's hover, focus and open states", () => {
    render(
      <>
        <ChipField label="rest" values={["k"]} onChange={() => {}} />
        <ChipField label="mono" values={["k"]} onChange={() => {}} mono />
        <ChipField label="inline" values={["k"]} onChange={() => {}} appearance="inline" />
        <ChipField label="hover" values={["k"]} onChange={() => {}} debugState="hover" />
        <ChipField label="focus" values={["k"]} onChange={() => {}} debugState="focus" />
        <ChipField
          label="open"
          values={[]}
          onChange={() => {}}
          choices={[{ value: "x", label: "Session ouverte" }]}
          debugState="open"
        />
      </>,
    );
    const frame = (name: string) => screen.getByRole("textbox", { name }).closest("span")?.parentElement ?? null;
    const chip = (name: string) => frame(name)?.firstElementChild ?? null;
    expect(cls(chip("mono"))).not.toBe(cls(chip("rest")));
    const frames = ["rest", "inline", "hover", "focus"].map((n) => cls(frame(n)));
    expect(new Set(frames).size).toBe(4);
    expect(screen.getByRole("listbox", { name: "open" })).toBeVisible();
  });
});
