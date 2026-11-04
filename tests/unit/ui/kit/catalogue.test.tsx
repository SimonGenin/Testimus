// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KitScreen } from "../../../../src/ui/screens/kit/KitScreen.tsx";
import { FAMILIES, type KitSection } from "../../../../src/ui/screens/kit/kit.tsx";

const SECTIONS = Object.values(
  import.meta.glob<KitSection>("../../../../src/ui/screens/kit/sections/*.tsx", { eager: true, import: "section" }),
).map((s) => s.name);

afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: "Components" });
const options = () => within(nav()).getAllByRole("option");
// ponytail: a row is the component's name then its one-line description; its name is the leaf that holds a name alone
const nameOf = (o: HTMLElement) =>
  [...o.querySelectorAll("span, div")].find((el) => el.children.length === 0 && SECTIONS.includes(el.textContent ?? ""))
    ?.textContent ?? "";
const option = (name: string) => {
  const found = options().find((o) => nameOf(o) === name);
  if (!found) throw new Error(`no option ${name}`);
  return found;
};
const figures = (panel: HTMLElement) =>
  within(panel)
    .getAllByRole("figure")
    .filter((f) => f.closest("section") === panel)
    .map((f) => f.getAttribute("aria-label"));

describe("Kit catalogue", () => {
  it("lists every component once, grouped by family in the families' order", () => {
    render(<KitScreen />);
    const names = options().map(nameOf);
    expect(names.length).toBeGreaterThan(25);
    expect(new Set(names).size).toBe(names.length);
    expect(
      within(nav()).getByText(`${names.length} components · one per control, options before copies`),
    ).toBeVisible();
    const groups = within(nav())
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label") ?? "");
    expect(groups.length).toBeGreaterThan(5);
    const order = groups.map((g) => FAMILIES.findIndex((f) => g.startsWith(f)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists exactly the sections of the kit", () => {
    render(<KitScreen />);
    expect(options().map(nameOf).sort()).toEqual([...SECTIONS].sort());
  });

  it.each(SECTIONS)("%s: its page shows its name, file and props, and the same states light then dark", (name) => {
    render(<KitScreen />);
    fireEvent.click(option(name));
    const main = screen.getByRole("main", { name: "Component" });
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(name);
    expect(within(main).getByText(/^src\/ui\/components\/ui\/\w+\.tsx$/)).toBeInTheDocument();
    const light = within(main).getByRole("region", { name: `${name}, Light` });
    const dark = within(main).getByRole("region", { name: `${name}, Dark` });
    const states = figures(light);
    expect(states.length, `${name} shows at least one state`).toBeGreaterThan(0);
    expect(figures(dark), `${name} shows the same states in dark`).toEqual(states);
    expect(light.className).not.toBe(dark.className);
    for (const label of states)
      expect(within(light).getByText(label as string, { selector: "figcaption" })).toBeInTheDocument();
    expect(within(main).getByRole("region", { name: "Props" })).toBeInTheDocument();
  });

  it("reads a component's props table from its source, a required one with its badge (design-gaps point 97)", () => {
    render(<KitScreen />);
    fireEvent.click(option("Button"));
    const props = screen.getByRole("region", { name: "Props" });
    expect(within(props).getByRole("columnheader", { name: "Prop" })).toBeInTheDocument();
    expect(within(props).getByRole("columnheader", { name: "Type and use" })).toBeInTheDocument();
    const label = within(props).getByText("label", { selector: "span" }).closest("tr") as HTMLElement;
    expect(within(label).getByText("required")).toBeInTheDocument();
    const variant = within(props).getByText("variant", { selector: "span" }).closest("tr") as HTMLElement;
    expect(within(variant).queryByText("required")).toBeNull();
    expect(within(props).getByRole("button", { name: "Copy the types" })).toBeEnabled();
  });

  it("copies the props type, names the family with a badge, and describes each row of the nav", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<KitScreen />);
    fireEvent.click(option("Button"));
    fireEvent.click(screen.getByRole("button", { name: "Copy the types" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^export type ButtonProps = \{\n[\s\S]* {2}label: string;/),
    );
    const main = screen.getByRole("main", { name: "Component" });
    expect(within(main).getByText("Actions")).toBeInTheDocument();
    expect((option("Button").textContent ?? "").length).toBeGreaterThan("Button".length + 10);
    vi.unstubAllGlobals();
  });

  it("shows the guidelines under the preview, with code marked and no stars left (design-gaps point 45)", () => {
    render(<KitScreen />);
    fireEvent.click(option("Button"));
    const guide = screen.getByRole("region", { name: "Guidelines" });
    expect(within(guide).getByText("Variants.")).toBeInTheDocument();
    expect(within(guide).getAllByText("primary", { selector: "code" }).length).toBeGreaterThan(0);
    expect(guide.textContent).not.toMatch(/\*|`/);
  });

  it("puts « Kit › the component » and « serve --mock only » in the screen's head", () => {
    render(<KitScreen />);
    fireEvent.click(option("Modal"));
    const heads = screen.getAllByRole("heading", { level: 1 });
    expect(heads[0]).toHaveTextContent(/^KitModal$/);
    expect(screen.getByText("serve --mock only")).toBeInTheDocument();
  });

  it("shows the List driven by a field: the focus stays in the field, the arrows move the active row", () => {
    render(<KitScreen />);
    fireEvent.click(option("List"));
    expect(within(screen.getByRole("region", { name: "Props" })).getByText("activeDescendant", { selector: "span" })).toBeVisible();
    const light = screen.getByRole("region", { name: "List, Light" });
    const cell = within(light).getByRole("figure", { name: /^activeDescendant/ });
    const field = within(cell).getByRole("combobox", { name: "Search" });
    const results = within(cell).getByRole("listbox", { name: "Results" });
    expect(field).toHaveAttribute("aria-controls", results.id);
    expect(field.getAttribute("aria-activedescendant")).toBe(
      within(results).getByRole("option", { name: /Sectionneur sans TK/ }).id,
    );
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(field).toHaveFocus();
    expect(within(results).getByRole("option", { name: /Ask Claude/ })).toHaveAttribute("aria-selected", "true");
    expect(within(results).getByRole("button", { name: "All 9 tests" })).toBeInTheDocument();
  });

  it("filters the list by name, says how many match, and says when none does", () => {
    render(<KitScreen />);
    const all = options().length;
    const field = screen.getByRole("textbox", { name: "Filter components" });
    fireEvent.change(field, { target: { value: "  modal " } });
    expect(options().map(nameOf)).toEqual(["Modal"]);
    expect(within(nav()).getByText(`1 of ${all} components match`)).toBeVisible();
    fireEvent.change(field, { target: { value: "nothing-like-this" } });
    expect(within(nav()).queryAllByRole("option")).toHaveLength(0);
    expect(within(nav()).getByText("No component named « nothing-like-this »")).toBeVisible();
  });
});
