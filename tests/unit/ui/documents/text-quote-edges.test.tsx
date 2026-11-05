// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocText } from "../../../../src/ui/components/sources/DocText.tsx";

afterEach(() => {
  cleanup();
});

const lit = (c: HTMLElement) => [...c.querySelectorAll("[data-focus]")];
// the quoted words are a <mark> of the kit (Marked) inside the place the reader scrolls to
const kind = (e: Element) => (e.querySelector("mark") ? "MARK" : e.tagName);

describe("DocText, where the quote is lit", () => {
  it("marks a quote whose words the text spaces out, past a block of stars alone", () => {
    const md = ["***", "Le  frein agit\n sur l'essieu."].join("\n\n");
    const { container } = render(<DocText docId="D" md={md} focus="frein agit sur" onFigure={vi.fn()} />);
    expect(lit(container)).toHaveLength(1);
    expect(kind(lit(container)[0])).toBe("MARK");
    expect(lit(container)[0].textContent).toBe("frein agit\n sur");
  });

  it("lights the whole paragraph when the quote only starts like it", () => {
    const start = "Le sectionneur est ouvert par le conducteur depuis le pupitre de";
    const md = ["## Titre", `${start} commande principale, en cabine.`].join("\n\n");
    const { container } = render(
      <DocText docId="D" md={md} focus={`${start} secours, sur le quai.`} onFigure={vi.fn()} />,
    );
    expect(lit(container)).toHaveLength(1);
    expect(lit(container)[0].tagName).toBe("DIV");
    expect(lit(container)[0]).toHaveTextContent(`${start} commande principale, en cabine.`);
    expect(container.querySelector("mark")).toBeNull();
  });
});
