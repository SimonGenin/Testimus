// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { PassageText, paragraphs } from "../../../../src/ui/components/sources/PassageView.tsx";

afterEach(cleanup);

describe("figures inside a paragraph", () => {
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
