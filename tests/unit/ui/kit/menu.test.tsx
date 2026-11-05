// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../../../src/ui/components/ui/Menu.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

const more = (on: Record<string, () => void> = {}): MenuEntry[] => [
  { label: "Clone", icon: "copy", hint: "saves first", onSelect: on.clone ?? (() => {}) },
  { label: "Download from Jira", icon: "download", onSelect: on.download ?? (() => {}) },
  {
    label: "Undo local changes",
    icon: "undo",
    disabled: "Only while the test differs from Jira",
    onSelect: on.undo ?? (() => {}),
  },
  { label: "Open in Jira", icon: "external", shortcut: "O", onSelect: on.open ?? (() => {}) },
  "separator",
  { label: "Delete local copy", icon: "trash", danger: true, onSelect: on.del ?? (() => {}) },
];

const trigger = <Button variant="quiet" iconOnly icon="more" label="More actions" />;

describe("Menu", () => {
  it("opens from its trigger as a menu, focuses the first item, and Escape gives the focus back", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={trigger} entries={more()} />);
    const button = screen.getByRole("button", { name: "More actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", menu.id);
    expect(screen.getByRole("menuitem", { name: /Clone/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("moves with the arrows (wrapping), Home and End, and keeps a disabled item reachable", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = (name: RegExp) => screen.getByRole("menuitem", { name });
    await user.keyboard("{ArrowDown}");
    expect(item(/Download/)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item(/Undo/)).toHaveFocus();
    await user.keyboard("{End}");
    expect(item(/Delete/)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item(/Clone/)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item(/Delete/)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item(/Clone/)).toHaveFocus();
  });

  it("acts on Enter, Space or a click, closes and gives the focus back to the trigger", async () => {
    const user = userEvent.setup();
    const clone = vi.fn();
    const download = vi.fn();
    const del = vi.fn();
    render(<Menu trigger={trigger} entries={more({ clone, download, del })} />);
    const button = screen.getByRole("button", { name: "More actions" });
    await user.click(button);
    await user.keyboard("{Enter}");
    expect(clone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard("{ArrowDown} ");
    expect(download).toHaveBeenCalledTimes(1);
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: /Delete local copy/ }));
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("finds an item by its first letters, cycling on a repeated letter", async () => {
    const user = userEvent.setup();
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = (name: RegExp) => screen.getByRole("menuitem", { name });
    await user.keyboard("u");
    expect(item(/Undo/)).toHaveFocus();
    now += 1000;
    await user.keyboard("d");
    expect(item(/Delete/)).toHaveFocus();
    await user.keyboard("d");
    expect(item(/Download/)).toHaveFocus();
    now += 1000;
    await user.keyboard("o");
    expect(item(/Open in Jira/)).toHaveFocus();
    now += 1000;
    await user.keyboard("{Home}");
    await user.keyboard("de");
    expect(item(/Delete/)).toHaveFocus();
    now += 1000;
    await user.keyboard("z");
    expect(item(/Delete/)).toHaveFocus();
    await user.keyboard("{Control>}c{/Control}");
    expect(item(/Delete/)).toHaveFocus();
  });

  it("opens from the keyboard on the trigger: ArrowDown on the first item, ArrowUp on the last", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={trigger} entries={more()} />);
    const button = screen.getByRole("button", { name: "More actions" });
    button.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Clone/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Tab (focus back on the trigger), on a press outside and on a second press of its trigger", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu trigger={trigger} entries={more()} />
        <p>Outside</p>
      </>,
    );
    const button = screen.getByRole("button", { name: "More actions" });
    await user.click(button);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    fireEvent.mouseDown(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: /Clone/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a disabled item stays visible with its reason, and does nothing", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    const off = vi.fn();
    render(
      <Menu trigger={trigger} entries={[...more({ undo }), { label: "Plain off", disabled: true, onSelect: off }]} />,
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Undo local changes/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription("Only while the test differs from Jira");
    await user.click(item);
    expect(undo).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Plain off" }));
    expect(off).not.toHaveBeenCalled();
  });

  it("shows hints, keys, second lines, groups of checked choices, notes, and a red danger item", async () => {
    const user = userEvent.setup();
    const pick = vi.fn();
    render(
      <Menu
        trigger={<Button variant="quiet" label="Sort" iconAfter="chevron-down" />}
        label="Sort the tests"
        align="end"
        entries={[
          { group: "Sort" },
          { label: "Newest", checked: true, onSelect: () => {} },
          { label: "Key", checked: false, description: "LFRPS12-1 first", onSelect: pick },
          { group: "Show" },
          { label: "Only mine", onSelect: () => {} },
          { note: "Tests without a key come last." },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("menu", { name: "Sort the tests" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sort" })).toContainElement(
      screen.getByRole("menuitemcheckbox", { name: /Newest/ }),
    );
    expect(screen.getByRole("menuitemcheckbox", { name: /Newest/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: /Key/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("LFRPS12-1 first")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Show" })).toContainElement(
      screen.getByText("Tests without a key come last."),
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Key/ }));
    expect(pick).toHaveBeenCalledTimes(1);

    cleanup();
    render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Clone/ })).toHaveTextContent("saves first");
    expect(screen.getByRole("menuitem", { name: /Open in Jira/ }).querySelector("kbd")).toHaveTextContent("O");
    expect(cls(screen.getByRole("menuitem", { name: /Delete/ }))).not.toBe(
      cls(screen.getByRole("menuitem", { name: /Download/ })),
    );
  });

  it("keeps the trigger's own click, and in the catalogue is drawn open without taking the focus", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Menu
        trigger={<Button label="Project" onClick={onClick} />}
        entries={more()}
        debugState="open"
        debugActive="Download from Jira"
        align="end"
      />,
    );
    const menu = screen.getByRole("menu", { name: "Project" });
    expect(menu).toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute("aria-expanded", "true");
    expect(cls(screen.getByRole("menuitem", { name: /Download/ }))).not.toBe(
      cls(screen.getByRole("menuitem", { name: /Clone/ })),
    );
    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    render(
      <Menu
        trigger={<Button label="Danger hot" />}
        entries={more()}
        debugState="open"
        debugActive="Delete local copy"
      />,
    );
  });

  it("sits under its trigger, flips above at the bottom of the window and keeps inside it sideways", async () => {
    const user = userEvent.setup();
    const box = (top: number, left: number) =>
      ({ top, bottom: top + 28, left, right: left + 28, width: 28, height: 28, x: left, y: top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    const at = { top: 100, left: 100 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => box(at.top, at.left));
    const { unmount } = render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    let menu = screen.getByRole("menu");
    expect(menu.style.top).toBe("128px");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.bottom).toBe("");
    at.top = window.innerHeight - 40;
    at.left = window.innerWidth - 50;
    fireEvent.scroll(window);
    menu = screen.getByRole("menu");
    expect(menu.style.bottom).toBe("40px");
    expect(menu.style.top).toBe("");
    expect(menu.style.right).toBe("22px");
    unmount();
    at.top = 100;
    at.left = 10;
    render(<Menu trigger={trigger} entries={more()} align="end" />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu").style.left).toBe("10px");
    at.left = 400;
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("menu").style.right).toBe(`${window.innerWidth - 428}px`);
  });

  it("beside: opens at the trigger's right, level with it, and stays inside the window (design-gaps point 56)", async () => {
    const user = userEvent.setup();
    const at = { top: 60 };
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({ top: at.top, bottom: at.top + 40, left: 8, right: 64, width: 56, height: 40, x: 8, y: at.top }) as DOMRect,
    );
    render(<Menu trigger={trigger} entries={more()} align="beside" />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu").style.top).toBe("60px");
    expect(screen.getByRole("menu").style.left).toBe("64px");
    at.top = window.innerHeight - 50;
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("menu").style.top).toBe(`${window.innerHeight - 200 - 8}px`);
  });

  it("follows the pointer: hovering an item focuses it", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.hover(screen.getByRole("menuitem", { name: /Open in Jira/ }));
    expect(screen.getByRole("menuitem", { name: /Open in Jira/ })).toHaveFocus();
  });

  it("a long menu scrolls inside the room left in the window on its side of the trigger", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 140,
      left: 8,
      right: 64,
      width: 56,
      height: 40,
      x: 8,
      y: 100,
    } as DOMRect);
    render(<Menu trigger={trigger} entries={more()} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu").style.maxHeight).toContain(`${window.innerHeight - 140 - 16}px`);
  });
});

describe("Menu with search", () => {
  const projects = (on: (k: string) => void): MenuEntry[] =>
    ["DS — Driving Simulator", "P226 — Metro Cairo", "TM3D — 3D Lead CatchUp", "CRM — Colas Rail Maintenance"].map(
      (label) => ({ label, onSelect: () => on(label) }),
    );
  const pick = <Button label="Project" />;

  it("opens on its field, filters by every word typed (accents and case aside), and Enter picks the first", async () => {
    const user = userEvent.setup();
    const on = vi.fn();
    render(<Menu trigger={pick} entries={projects(on)} search="Type to filter…" />);
    await user.click(screen.getByRole("button", { name: "Project" }));
    const field = screen.getByRole("combobox", { name: "Filter Project" });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    await user.keyboard("maintenance colas");
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["CRM — Colas Rail Maintenance"]);
    await user.clear(field);
    await user.keyboard("CAÏRO");
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["P226 — Metro Cairo"]);
    await user.keyboard("{Enter}");
    expect(on).toHaveBeenCalledWith("P226 — Metro Cairo");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says when nothing matches, goes down into the items with the arrows, and typing there goes on in the field; Escape clears, then closes", async () => {
    const user = userEvent.setup();
    render(<Menu trigger={pick} entries={projects(() => {})} search="Type to filter…" />);
    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.keyboard("zzz");
    expect(screen.getByText("Nothing matches « zzz ».")).toBeInTheDocument();
    await user.keyboard("{Backspace}{Backspace}{Backspace}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "DS — Driving Simulator" })).toHaveFocus();
    await user.keyboard("t");
    const field = screen.getByRole("combobox", { name: "Filter Project" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("t");
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    await user.keyboard("t{Escape}{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("combobox", { name: "Filter Project" })).toHaveValue("");
  });
});
