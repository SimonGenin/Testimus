// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosisText } from "../../../../src/ui/components/claude/DiagnosisText.tsx";
import { Markdown } from "../../../../src/ui/components/claude/Markdown.tsx";
import { dataWrapper } from "../../helpers/ui-data.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ANSWER = `## Le menu

Le menu **dépend du type** de *sectionneur* [D401#§5.6.6 "le menu diffère"].

### Sans TK

- Propriétés ;
- autorisation :
  - puis confirmation.

3. trois
4. quatre

| Type | Entrées |
| --- | --- |
| Sans TK | **Propriétés** |

> Les documents ne précisent pas l'ordre.

\`\`\`sh
testimus rag index
\`\`\`

---

Voir [la doc](https://example.com/doc), \`rag.index\` et <script>alert(1)</script>.`;

describe("Markdown", () => {
  it("draws each construct as its element, with no mark left and no HTML read", () => {
    const open = vi.fn();
    const { container } = render(<Markdown text={ANSWER} onOpenSource={open} />);
    expect(screen.getByRole("heading", { level: 4, name: "Le menu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 5, name: "Sans TK" })).toBeInTheDocument();
    expect(screen.getByText("dépend du type").tagName).toBe("STRONG");
    expect(screen.getByText("sectionneur").tagName).toBe("EM");
    const lists = screen.getAllByRole("list");
    expect(lists.map((l) => l.tagName)).toEqual(["UL", "UL", "OL"]);
    expect(lists[2]).toHaveAttribute("start", "3");
    expect(within(lists[1]).getByText("puis confirmation.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(within(table).getByText("Propriétés").tagName).toBe("STRONG");
    expect(container.querySelector("blockquote")).toHaveTextContent("Les documents ne précisent pas l'ordre.");
    expect(screen.getByRole("group", { name: "Code (sh)" })).toHaveTextContent("testimus rag index");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByText("rag.index").tagName).toBe("CODE");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).not.toMatch(/\*\*|^#|\| ---/m);
    fireEvent.click(screen.getByRole("button", { name: "D401 §5.6.6" }));
    expect(open).toHaveBeenCalledWith({ docId: "D401", anchor: "§5.6.6", quote: "le menu diffère" });
  });

  it("opens a link outside the app, never in the page", () => {
    const win = vi.fn();
    vi.stubGlobal("open", win);
    render(<Markdown text="Voir [la doc](https://example.com/doc)." onOpenSource={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "la doc" }));
    expect(win).toHaveBeenCalledWith("https://example.com/doc", "_blank", "noopener,noreferrer");
  });

  it("keeps a listed source out of the line, and the caret after the last words while Claude writes", () => {
    const { rerender } = render(
      <Markdown
        text={'Un.\n\n- a\n- b D#§1 "q"'}
        running
        listed={[{ docId: "D", anchor: "§1", quote: "q" }]}
        onOpenSource={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "D §1" })).toBeNull();
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toContainElement(screen.getByTestId("caret"));
    expect(items[1].textContent).toBe("b");
    rerender(<Markdown text="" running onOpenSource={() => {}} />);
    expect(screen.getByTestId("caret")).toBeInTheDocument();
    rerender(<Markdown text="Fini" onOpenSource={() => {}} />);
    expect(screen.queryByTestId("caret")).toBeNull();
  });

  it("a page Claude wrote to be read (the overview) puts its # and ## at level 2, its ### at level 3", () => {
    render(<Markdown reading text={"# Un\n## Deux\n### Trois"} onOpenSource={() => {}} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Un", "Deux"]);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Trois");
  });
});

describe("DiagnosisText", () => {
  it("reads a line of Markdown inside its sentence: code and bold, no block", () => {
    const { container } = render(
      <p>
        <DiagnosisText text="Run `claude login`, then **Check again**." />
      </p>,
    );
    expect(screen.getByText("claude login").tagName).toBe("CODE");
    expect(screen.getByText("Check again").tagName).toBe("STRONG");
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
