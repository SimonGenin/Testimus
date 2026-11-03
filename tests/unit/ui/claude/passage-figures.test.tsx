// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { PassageText, paragraphs } from "../../../../src/ui/components/sources/PassageView.tsx";
import { DocText } from "../../../../src/ui/screens/documents/DocText.tsx";
import { dataWrapper } from "../../cov-uishell-helpers.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

afterEach(cleanup);

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
    expect(container.querySelector(".doctext-p")).toBeNull();
  });

  it("the passage text drops pictures anywhere in a paragraph (they are shown as figures below)", () => {
    expect(paragraphs("![](figures/a.png) <!-- fig a --> Le local. ![x \\]](figures/b.png) Fin.")).toEqual([
      "Le local.  Fin.",
    ]);
    setProject("C:/p");
    const { container } = render(
      <PassageText
        passage={{
          docId: "D1",
          anchor: "§1",
          path: "",
          title: "",
          text: "![](figures/fig-f83.png) <!-- fig f83 --> Le local.",
          figures: [{ file: "figures/fig-f83.png", anchor: "fig:f83", caption: "", description: "" }],
          doc: { code: "D1", title: "", version: "", status: "draft" },
        }}
        quote=""
      />,
    );
    expect(container.textContent).not.toContain("![");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});
