// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Passage } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { PassageText } from "../../../../src/ui/components/sources/PassageView.tsx";

afterEach(cleanup);

const doc = { code: "D1", title: "", version: "", status: "draft" as const };
const passage = (p: Partial<Passage>): Passage => ({
  docId: "D1",
  anchor: "§1",
  path: "",
  title: "",
  text: "",
  figures: [],
  doc,
  ...p,
});

const TABLE = "| État | Couleur |\n| --- | --- |\n| Consigné | Rouge |\n| Libre | Vert |";

describe("a passage drawn as the documents reader draws it", () => {
  it("shows a picture where the text has it, once, and no markdown", () => {
    setProject("C:/p");
    const { container } = render(
      <PassageText
        passage={passage({
          text: "![](figures/fig-f83.png) <!-- fig f83 --> Le local.",
          figures: [{ file: "figures/fig-f83.png", anchor: "fig:f83", caption: "", description: "" }],
        })}
        quote=""
      />,
    );
    expect(container.textContent).not.toContain("![");
    expect(container.textContent).toContain("Le local.");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("lays a table of the text out as a table, named by its caption, the quoted row lit; no placeholder for it", () => {
    render(
      <PassageText
        passage={passage({
          text: `Les couleurs :\n\n${TABLE}\n\nFigure 23 – Couleurs des états <!-- fig 23 -->`,
          figures: [{ file: "", anchor: "fig:23", caption: "Figure 23 – Couleurs des états", description: "" }],
        })}
        quote="Libre Vert"
      />,
    );
    const table = screen.getByRole("table", { name: "Figure 23 – Couleurs des états" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["État", "Couleur"]);
    expect(within(table).getByText("Rouge")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("| ---");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("a table figure read by its anchor shows its table, then its caption and what it shows", () => {
    render(
      <PassageText
        passage={passage({
          anchor: "fig:23",
          title: "Figure 23 – Couleurs des états",
          text: "Figure 23 – Couleurs des états\nLes états déclarés.",
          figures: [
            {
              file: "",
              anchor: "fig:23",
              caption: "Figure 23 – Couleurs des états",
              description: "Les états déclarés.",
              table: TABLE,
            },
          ],
        })}
        quote=""
      />,
    );
    expect(screen.getByRole("table", { name: "Figure 23 – Couleurs des états" })).toBeInTheDocument();
    expect(screen.getByText("Les états déclarés.")).toBeInTheDocument();
  });

  it("a picture figure read by its anchor shows its picture; one with neither picture nor table its text", () => {
    setProject("C:/p");
    const fig = { file: "figures/f4.png", anchor: "fig:4", caption: "Schéma [1]", description: "Le schéma." };
    const { rerender } = render(
      <PassageText passage={passage({ anchor: "fig:4", title: "Schéma [1]", figures: [fig] })} quote="" />,
    );
    expect(screen.getByRole("img", { name: "Schéma [1]" })).toBeInTheDocument();
    rerender(
      <PassageText
        passage={passage({ anchor: "fig:4", title: "Schéma", text: "Schéma\nRien.", figures: [{ ...fig, file: "" }] })}
        quote=""
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Rien\./)).toBeInTheDocument();
  });

  it("writes a sub-heading's number before its title (no gutter in a passage)", () => {
    render(<PassageText passage={passage({ text: "### 5.6.6.1 Menus\n\nTexte." })} quote="" />);
    expect(screen.getByRole("heading", { name: /5\.6\.6\.1/ }).textContent).toBe("§ 5.6.6.1 Menus");
  });
});
