// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { type FlowGroup, FlowMap } from "../../../../src/ui/components/ui/FlowMap.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const said = { icon: "text", word: "Said in full" } as const;
const pointed = { icon: "link", word: "Pointed at" } as const;
const loaded = { icon: "download", word: "Loaded by Claude Code" } as const;
const searched = { icon: "search", word: "Searched" } as const;

const groups = (onEdit = () => {}, onNew = () => {}): FlowGroup[] => [
  {
    label: "The request",
    nodes: [
      {
        id: "instruction",
        name: "Ask Claude on a test",
        on: true,
        locked: true,
        icon: "send",
        how: said,
        size: "~420 tokens",
        weight: 1680,
        why: "What Testimus asks of this run",
        text: "Use the edit-test skill on the test.",
      },
      {
        id: "tools",
        name: "14 tools of the app",
        on: true,
        locked: "Chosen for each run, where you write to Claude",
        how: loaded,
        detail: "Read, Edit, Write, tests_show",
      },
    ],
  },
  {
    label: "Contexts",
    nodes: [
      {
        id: "context:glossaire",
        name: "Glossaire RATP",
        on: true,
        icon: "context",
        how: said,
        size: "~310 tokens",
        weight: 1240,
        why: "A default of the project",
        text: "PCC = poste de commande centralisé",
        actions: <Button size="xs" variant="quiet" label="Edit" onClick={onEdit} />,
      },
      {
        id: "context:old",
        name: "Ancien lot",
        on: false,
        icon: "context",
        how: pointed,
        size: "~2.4k tokens",
        weight: 9600,
        why: "Saved, not attached to this run",
      },
    ],
    actions: <Button size="sm" icon="plus" label="New context" onClick={onNew} />,
  },
  {
    label: "Documents",
    nodes: [
      {
        id: "doc:D401",
        name: "Spécifications J5",
        on: true,
        icon: "documents",
        how: searched,
        size: "~48k tokens",
        weight: 192000,
      },
      { id: "docnote:D401", name: "What the team knows about D401", on: true, under: true, weight: 240 },
    ],
  },
];

const TARGET = { title: "Request to Claude", total: "5 of 6 pieces · ~2.7k tokens", note: "Said or read first." };

const map = () => screen.getByRole("group", { name: "What Claude is given" });
const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const link = (id: string) => document.querySelector(`path[data-link="${id}"]`) as SVGPathElement;
const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

describe("FlowMap", () => {
  it("is one named group holding a named group per group of nodes, each saying how many of its nodes are on", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    const names = within(map())
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(names).toEqual(["The request", "Contexts", "Documents"]);
    expect(within(map()).getByRole("group", { name: "The request" })).toHaveTextContent("2 of 2");
    const contexts = within(map()).getByRole("group", { name: "Contexts" });
    expect(contexts).toHaveTextContent("1 of 2");
    expect(within(contexts).getAllByRole("listitem")).toHaveLength(2);
    expect(within(map()).getAllByRole("listitem")).toHaveLength(6);
  });

  it("a node is a checkbox named by its name and described by why it is there; a tick reports its id and its new state", () => {
    const onToggle = vi.fn();
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={onToggle} />);
    const on = screen.getByRole("checkbox", { name: "Glossaire RATP" });
    expect(on).toBeChecked();
    expect(on).toHaveAccessibleDescription("A default of the project");
    expect(row("Glossaire RATP").querySelector('[data-icon="context"]')).not.toBeNull();
    const off = screen.getByRole("checkbox", { name: "Ancien lot" });
    expect(off).not.toBeChecked();
    fireEvent.click(on);
    expect(onToggle).toHaveBeenLastCalledWith("context:glossaire", false);
    fireEvent.click(off);
    expect(onToggle).toHaveBeenLastCalledWith("context:old", true);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("a locked node has no checkbox: a lock that reads « Always goes with it », or the reason it was given", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: "Ask Claude on a test" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "14 tools of the app" })).toBeNull();
    const always = within(row("Ask Claude on a test")).getByRole("img", { name: "Always goes with it" });
    expect(always).toHaveAttribute("data-icon", "lock");
    expect(row("Ask Claude on a test")).toHaveTextContent("What Testimus asks of this run");
    expect(row("Ask Claude on a test").querySelector('[data-icon="send"]')).not.toBeNull();
    expect(
      within(row("14 tools of the app")).getByRole("img", { name: "Chosen for each run, where you write to Claude" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("says how each node reaches the target, as icon and word, then how big it is", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(row("Ask Claude on a test")).toHaveTextContent("Said in full · ~420 tokens");
    expect(row("Ask Claude on a test").querySelector('[data-icon="text"]')).not.toBeNull();
    expect(within(row("14 tools of the app")).getByText("Loaded by Claude Code")).toBeInTheDocument();
    expect(row("14 tools of the app").querySelector('[data-icon="download"]')).not.toBeNull();
    expect(row("Ancien lot")).toHaveTextContent("Pointed at · ~2.4k tokens");
    expect(row("Spécifications J5")).toHaveTextContent("Searched · ~48k tokens");
    expect(row("What the team knows about D401")).toHaveTextContent(/^What the team knows about D401$/);
  });

  it("shows a line of detail, and folds the node's text behind « What … says »", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(within(row("14 tools of the app")).getByText("Read, Edit, Write, tests_show")).toBeInTheDocument();
    const fold = within(row("Glossaire RATP")).getByRole("button", { name: "What « Glossaire RATP » says" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("PCC = poste de commande centralisé")).toBeNull();
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Glossaire RATP, in full" })).toHaveTextContent(
      "PCC = poste de commande centralisé",
    );
    expect(within(row("Ancien lot")).queryByRole("button", { name: /^What/ })).toBeNull();
  });

  it("sets a node under the one before it in; a node's own actions end its row, a group's sit under its nodes", () => {
    const onEdit = vi.fn();
    const onNew = vi.fn();
    render(<FlowMap label="What Claude is given" groups={groups(onEdit, onNew)} target={TARGET} onToggle={() => {}} />);
    expect(cls(row("What the team knows about D401"))).not.toBe(cls(row("Spécifications J5")));
    expect(cls(row("Ancien lot"))).toBe(cls(row("Spécifications J5")));
    fireEvent.click(within(row("Glossaire RATP")).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    const add = within(screen.getByRole("group", { name: "Contexts" })).getByRole("button", { name: "New context" });
    expect(add.closest("li")).toBeNull();
    fireEvent.click(add);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("group", { name: "Documents" })).queryByRole("button")).toBeNull();
  });

  it("a group with no node says so, counts nothing and keeps its actions", () => {
    render(
      <FlowMap
        label="What Claude is given"
        groups={[
          { label: "Contexts", nodes: [], empty: "No saved context yet.", actions: <Button label="New context" /> },
          { label: "Documents", nodes: [] },
        ]}
        target={{ title: "Request to Claude" }}
        onToggle={() => {}}
      />,
    );
    const contexts = screen.getByRole("group", { name: "Contexts" });
    expect(contexts).toHaveTextContent("No saved context yet.");
    expect(contexts).not.toHaveTextContent(/\d of \d/);
    expect(within(contexts).queryByRole("list")).toBeNull();
    expect(within(contexts).getByRole("button", { name: "New context" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Documents" })).toHaveTextContent(/^Documents$/);
  });

  it("the target says where everything goes: its title, the total announced when it changes, a line under it, its icon", () => {
    const { rerender } = render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} />);
    const title = screen.getByRole("heading", { level: 3, name: "Request to Claude" });
    const target = title.parentElement as HTMLElement;
    expect(within(target).getByRole("status")).toHaveTextContent(/^5 of 6 pieces · ~2\.7k tokens$/);
    expect(target).toHaveTextContent("Said or read first.");
    expect(target.querySelector("[data-icon]")).toHaveAttribute("data-icon", "claude");
    rerender(
      <FlowMap
        label="What Claude is given"
        groups={groups()}
        target={{ title: "Every run on this document", icon: "documents" }}
      />,
    );
    const other = screen.getByRole("heading", { level: 3, name: "Every run on this document" })
      .parentElement as HTMLElement;
    expect(within(other).queryByRole("status")).toBeNull();
    expect(other.querySelector("[data-icon]")).toHaveAttribute("data-icon", "documents");
    expect(other).toHaveTextContent(/^Every run on this document$/);
  });

  it("nothing can be ticked without onToggle, nor while disabled — with the reason as a tooltip when one is given", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    rerender(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={onToggle} disabled />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    rerender(
      <FlowMap
        label="What Claude is given"
        groups={groups()}
        target={TARGET}
        onToggle={onToggle}
        disabled="Claude is working — wait for it to finish"
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes) expect(box).toBeDisabled();
    const tips = screen.getAllByRole("tooltip", { hidden: true });
    expect(tips).toHaveLength(boxes.length);
    expect(tips[0]).toHaveTextContent("Claude is working — wait for it to finish");
    rerender(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={onToggle} />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeEnabled();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("FlowMap links", () => {
  const width = (id: string) => Number(link(id).getAttribute("stroke-width"));

  it("draws one link per node, kept from assistive tech: everything it says is in the list", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    const links = link("instruction").closest("svg") as SVGSVGElement;
    expect(links.getAttribute("aria-hidden")).toBe("true");
    expect(links.querySelectorAll("path")).toHaveLength(6);
    expect(within(map()).queryByRole("img", { name: /link/i })).toBeNull();
  });

  it("a link is as wide as its node weighs, by the logarithm: the heaviest the widest, a node without weight thin", () => {
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(width("doc:D401")).toBe(8);
    expect(width("tools")).toBe(1.5);
    expect(width("docnote:D401")).toBeGreaterThan(1.5);
    expect(width("docnote:D401")).toBeLessThan(width("context:glossaire"));
    expect(width("context:glossaire")).toBeLessThan(width("instruction"));
    expect(width("instruction")).toBeLessThan(width("doc:D401"));
    expect(width("instruction")).toBeGreaterThan(8 / 2);
  });

  it("the link of a node that is off is thin whatever it weighs, drawn apart, and lies under the others", () => {
    const { rerender } = render(
      <FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />,
    );
    expect(link("context:old")).toHaveAttribute("data-state", "off");
    expect(link("context:glossaire")).toHaveAttribute("data-state", "on");
    expect(width("context:old")).toBe(1.5);
    expect(cls(link("context:old"))).not.toBe(cls(link("context:glossaire")));
    const order = () => [...document.querySelectorAll("path[data-link]")].map((p) => p.getAttribute("data-link"));
    expect(order()[0]).toBe("context:old");
    const before = width("instruction");
    const flip = (id: string, on: boolean) => (n: FlowGroup["nodes"][number]) => (n.id === id ? { ...n, on } : n);
    const next = groups().map((g) => ({
      ...g,
      nodes: g.nodes.map(flip("doc:D401", false)).map(flip("context:old", true)),
    }));
    rerender(<FlowMap label="What Claude is given" groups={next} target={TARGET} onToggle={() => {}} />);
    expect(order()[0]).toBe("doc:D401");
    expect(width("doc:D401")).toBe(1.5);
    expect(link("context:old")).toHaveAttribute("data-state", "on");
    expect(width("context:old")).toBeGreaterThan(before);
    expect(width("context:old")).toBeLessThan(8);
    expect(width("instruction"), "the scale holds when the heaviest node is unticked").toBe(before);
  });
});

const rect = (top: number, height: number, width = 0) =>
  ({ top, height, width, left: 0, right: width, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

// ponytail: jsdom lays nothing out — the page as drawn is given here: the links' frame, the target, and each row by id
function drawn(rows: Record<string, number>, frame = rect(100, 300, 120), target = rect(200, 100)) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.tagName.toLowerCase() === "svg" && !this.hasAttribute("data-icon")) return frame;
    const id = this.getAttribute("data-flow-node");
    if (id) return rect(rows[id] ?? 0, 20);
    if ([...this.children].some((c) => c.tagName === "H3")) return target;
    return rect(0, 0);
  });
}

describe("FlowMap links, as measured", () => {
  const d = (id: string) => link(id).getAttribute("d");

  it("each link runs from the middle of its row to the middle of the target, inside the links' frame", () => {
    drawn({ instruction: 130, tools: 190, "context:glossaire": 250 });
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(d("instruction")).toBe("M0 40 C60 40 60 150 120 150");
    expect(d("tools")).toBe("M0 100 C60 100 60 150 120 150");
    expect(d("context:glossaire")).toBe("M0 160 C60 160 60 150 120 150");
  });

  it("a row scrolled out of sight leaves from the edge it went past, and a scroll of the list measures again", () => {
    drawn({ instruction: 20, tools: 130, "doc:D401": 900 });
    render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(d("instruction")).toBe("M0 0 C60 0 60 150 120 150");
    expect(d("doc:D401")).toBe("M0 300 C60 300 60 150 120 150");
    expect(d("tools")).toBe("M0 40 C60 40 60 150 120 150");
    vi.restoreAllMocks();
    drawn({ instruction: -200, tools: -90, "doc:D401": 290 });
    const list = screen.getByRole("group", { name: "The request" }).parentElement?.parentElement as HTMLElement;
    fireEvent.scroll(list);
    expect(d("tools")).toBe("M0 0 C60 0 60 150 120 150");
    expect(d("doc:D401")).toBe("M0 200 C60 200 60 150 120 150");
  });

  it("measures again when the list or its content changes size, and stops watching once gone", () => {
    let resized: (() => void) | undefined;
    const watched: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe(el: Element) {
          watched.push(el);
        }
        disconnect() {
          resized = undefined;
        }
      },
    );
    drawn({ tools: 130 });
    const r = render(<FlowMap label="What Claude is given" groups={groups()} target={TARGET} onToggle={() => {}} />);
    expect(watched).toHaveLength(2);
    expect(watched[0]).toContainElement(watched[1] as HTMLElement);
    expect(d("tools")).toBe("M0 40 C60 40 60 150 120 150");
    vi.restoreAllMocks();
    drawn({ tools: 170 }, rect(100, 300, 200), rect(100, 100));
    act(() => resized?.());
    expect(d("tools")).toBe("M0 80 C100 80 100 50 200 50");
    r.unmount();
    expect(resized).toBeUndefined();
  });
});
