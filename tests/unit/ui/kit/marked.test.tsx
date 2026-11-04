// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Marked } from "../../../../src/ui/components/ui/Marked.tsx";

afterEach(cleanup);

const marks = (c: HTMLElement) => [...c.querySelectorAll("mark")].map((m) => m.textContent);
const atoms = (el: Element | null) =>
  (el?.getAttribute("class") ?? "")
    .split(" ")
    .filter((c) => c && !c.includes("__"))
    .sort()
    .join(" ");

describe("Marked", () => {
  it("shows the text as it is, with the marked parts in <mark>", () => {
    const { container } = render(
      <Marked
        text="Le sectionneur refuse l'ouverture"
        marks={[
          [3, 14],
          [24, 33],
        ]}
      />,
    );
    expect(container).toHaveTextContent("Le sectionneur refuse l'ouverture");
    expect(marks(container)).toEqual(["sectionneur", "ouverture"]);
    expect(container.querySelector("mark")).toHaveAttribute("data-hl");
  });

  it("without marks is the plain text", () => {
    const { container } = render(<Marked text="Aucun résultat" marks={[]} />);
    expect(container.textContent).toBe("Aucun résultat");
    expect(container.querySelector("mark")).toBeNull();
  });

  it("marks the start, the end, or the whole text", () => {
    const { container } = render(
      <Marked
        text="abcdef"
        marks={[
          [0, 2],
          [4, 6],
        ]}
      />,
    );
    expect(marks(container)).toEqual(["ab", "ef"]);
    expect(container.textContent).toBe("abcdef");
    cleanup();
    const all = render(<Marked text="abc" marks={[[0, 3]]} />);
    expect(marks(all.container)).toEqual(["abc"]);
    expect(all.container.textContent).toBe("abc");
  });

  it("leaves out a mark that overlaps the one before, runs past the text or is empty", () => {
    const { container } = render(
      <Marked
        text="abcdef"
        marks={[
          [1, 3],
          [2, 4],
          [4, 4],
          [5, 9],
        ]}
      />,
    );
    expect(marks(container)).toEqual(["bc"]);
    expect(container.textContent).toBe("abcdef");
  });

  it("has a search look and a quote look", () => {
    const search = render(<Marked text="abc" marks={[[0, 1]]} />);
    const s = atoms(search.container.querySelector("mark"));
    cleanup();
    const quote = render(<Marked text="abc" marks={[[0, 1]]} look="quote" />);
    const q = atoms(quote.container.querySelector("mark"));
    expect(s).not.toBe("");
    expect(q).not.toBe(s);
    cleanup();
    expect(atoms(render(<Marked text="abc" marks={[[0, 1]]} look="search" />).container.querySelector("mark"))).toBe(s);
  });
});
