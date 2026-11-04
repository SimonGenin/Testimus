// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KitScreen } from "../../../../src/ui/screens/kit/KitScreen.tsx";
import { FAMILIES, type KitSection } from "../../../../src/ui/screens/kit/kit.tsx";

const SECTIONS = Object.values(
  import.meta.glob<KitSection>("../../../../src/ui/screens/kit/sections/*.tsx", { eager: true, import: "section" }),
).map((s) => s.name);

afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: "Components" });
const options = () => within(nav()).getAllByRole("option");
const nameOf = (o: HTMLElement) => (o.textContent ?? "").trim();
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
    fireEvent.click(within(nav()).getByRole("option", { name }));
    const main = screen.getByRole("main", { name: "Component" });
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(name);
    expect(within(main).getByText(/· src\/ui\/components\/ui\/\w+\.tsx$/)).toBeInTheDocument();
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

  it("reads a component's props table from its source, required ones without a question mark", () => {
    render(<KitScreen />);
    fireEvent.click(within(nav()).getByRole("option", { name: "Button" }));
    const props = screen.getByRole("region", { name: "Props" });
    expect(within(props).getByText("label")).toBeVisible();
    expect(within(props).getByText("variant?")).toBeVisible();
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
