// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocText } from "../../../../src/ui/screens/documents/DocText.tsx";

afterEach(() => {
  cleanup();
  setProject(null);
});

const marked = (c: HTMLElement) => [...c.querySelectorAll("[data-focus]")];
// the quoted words are a <mark> of the kit (Marked) inside the place the reader scrolls to
const kind = (e: Element) => (e.querySelector("mark") ? "MARK" : e.tagName);

describe("DocText", () => {
  it("renders headings, figures, tables, inline marks and the focus", () => {
    setProject("C:/p");
    const onFigure = vi.fn();
    const md = [
      "## 5.6 Sectionneur",
      "# Title\nwith a second line",
      "![Vue de traction](figures/fig-1.png) <!-- fig fig-1 -->",
      '![Plain](figures/x.png "t")',
      "| a | b |\n| - | - |",
      "Le **sectionneur** est *ouvert* en cas de défaut.",
      "Selon le type de sectionneur, le menu diffère",
      "<!-- only a comment -->",
    ].join("\n\n");
    const { container } = render(<DocText docId="D1" md={md} focus="Selon le  type" onFigure={onFigure} />);
    expect(screen.getByRole("heading", { name: "5.6 Sectionneur" })).toHaveAttribute("data-level", "2");
    expect(screen.getByText(/with a second line/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Vue de traction" })).toHaveAttribute(
      "src",
      "/files/docs/D1/figures/fig-1.png?project=C%3A%2Fp",
    );
    fireEvent.click(screen.getByRole("button", { name: "Vue de traction" }));
    expect(onFigure).toHaveBeenCalledWith("fig:fig-1");
    expect(screen.getByText("Plain", { selector: "figcaption" })).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveTextContent("| a | b |");
    expect(screen.getByText("sectionneur", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("ouvert", { selector: "em" })).toBeInTheDocument();
    expect(marked(container)).toHaveLength(1);
    expect(kind(marked(container)[0])).toBe("MARK");
    expect(marked(container)[0].textContent).toBe("Selon le type");
    expect(marked(container)[0].parentElement).toHaveTextContent("Selon le type de sectionneur, le menu diffère");
  });

  it("puts a numbered heading's anchor and a figure's key in the gutter", () => {
    const md = "## 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->\n\n![Figure 40](figures/f.png) <!-- fig 40 -->\n\n## Annexe";
    const { container } = render(<DocText docId="D" md={md} onFigure={vi.fn()} />);
    const h = screen.getByRole("heading", { name: "5.6.6 Sectionneur (S)" });
    expect(h).toHaveTextContent("§ 5.6.6 Sectionneur (S)");
    expect(container).toHaveTextContent("fig 40");
    expect(screen.getByRole("heading", { name: "Annexe" })).toBeInTheDocument();
  });

  it("finds the quote in a table row, across paragraphs, in a heading or a figure, and only once", () => {
    const md = [
      "## 8.1 Boutons",
      "| Bouton | Action |\n| - | - |\n| Valider | Appel de la fonction serveur. |",
      "Une phrase coupée\nici et",
      "continuée là.",
      "![Figure 2 – Vue](figures/f.png) <!-- fig 2 -->",
      "Appel de la fonction serveur.",
    ].join("\n\n");
    const hot = (focus: string) => {
      const { container, unmount } = render(<DocText docId="D" md={md} focus={focus} onFigure={vi.fn()} />);
      const on = marked(container).map((e) => `${kind(e)}|${e.textContent}`);
      unmount();
      return on;
    };
    expect(hot("Appel de la fonction serveur.")).toEqual(["SPAN|| Valider | Appel de la fonction serveur. |"]);
    expect(hot("coupée ici et continuée là")).toEqual(["MARK|coupée\nici et"]);
    expect(hot("phrase coupée")).toEqual(["MARK|phrase coupée"]);
    expect(hot("Boutons")).toEqual(["H4|§ 8.1 Boutons"]);
    expect(hot("Figure 2 – Vue")[0]).toMatch(/^FIGURE\|/);
    expect(hot(`${"x".repeat(60)} absent`)).toEqual([]);
  });

  it("marks only the quoted words, across bold, and nothing in italic", () => {
    const { container } = render(
      <DocText
        docId="D"
        md={"Avant. La **deuxième** ligne,\ncitée. Après."}
        focus=" la deuxième ligne, citée "
        onFigure={vi.fn()}
      />,
    );
    const m = marked(container);
    expect(m.map((e) => e.textContent)).toEqual(["La deuxième ligne,\ncitée"]);
    expect(m[0].querySelector("strong")).toHaveTextContent("deuxième");
    expect(container.querySelector("p")).toHaveTextContent("Avant. La deuxième ligne, citée. Après.");
  });

  it("sets the linked heading or figure apart, nothing else", () => {
    const md = "## 5.6 Objets\n\n## 5.6.6 Sectionneur (S)\n\n![Figure 40](figures/f.png) <!-- fig 40 -->\n\nTexte.";
    const on = (target: string) => {
      const { container, unmount } = render(<DocText docId="D" md={md} target={target} onFigure={vi.fn()} />);
      const t = [...container.querySelectorAll("[data-target]")].map((e) => e.textContent);
      unmount();
      return t;
    };
    expect(on("§5.6.6")).toEqual(["§ 5.6.6 Sectionneur (S)"]);
    expect(on("fig:40")).toEqual(["fig 40Figure 40"]);
    expect(on("§9")).toEqual([]);
    expect(on("")).toEqual([]);
  });

  it("says when the part is empty; no focus without one", () => {
    const { rerender, container } = render(<DocText docId="D" md={"<!-- x -->\n\n\n"} onFigure={vi.fn()} />);
    expect(screen.getByText("This part of the document is empty.")).toBeInTheDocument();
    rerender(<DocText docId="D" md="**all bold**" onFigure={vi.fn()} />);
    expect(marked(container)).toHaveLength(0);
    expect(screen.getByText("all bold", { selector: "strong" })).toBeInTheDocument();
  });
});

describe("figures inside a paragraph", () => {
  it("DocText draws a picture anchored in the text and keeps the text around it", () => {
    setProject("C:/p");
    const onFigure = vi.fn();
    const md =
      "![](figures/fig-f83.png) <!-- fig f83 --> Le local est l'endroit. ![Vue \\[A\\]](figures/fig-f84.png) <!-- fig f84 --> Plusieurs locaux.";
    const { container } = render(<DocText docId="D1" md={md} onFigure={onFigure} />);
    expect(container.textContent).not.toContain("![");
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("fig-f83.png");
    expect(screen.getByRole("img", { name: "Vue [A]" })).toBeInTheDocument();
    expect(screen.getByText("Le local est l'endroit.")).toBeInTheDocument();
    expect(screen.getByText("Plusieurs locaux.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vue [A]" }));
    expect(onFigure).toHaveBeenCalledWith("fig:f84");
  });

  it("DocText draws a lone picture whose caption has escaped brackets", () => {
    setProject("C:/p");
    const { container } = render(
      <DocText docId="D1" md={"![Schéma \\[1\\]](figures/fig-3.png) <!-- fig 3 -->"} onFigure={() => {}} />,
    );
    expect(container.querySelector("figure img")).toHaveAttribute("alt", "Schéma [1]");
    expect(container.querySelector("p")).toBeNull();
  });
});
