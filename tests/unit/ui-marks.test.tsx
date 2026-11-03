// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Step } from "../../src/core/types.ts";
import { emphasisRuns, highlight } from "../../src/ui/components/sources/PassageView.tsx";
import { worst } from "../../src/ui/lib/doctor.ts";
import { addedSteps } from "../../src/ui/lib/marks.ts";
import { StepCard } from "../../src/ui/screens/tests/StepCard.tsx";
import { layoutOf } from "./layout-helpers.ts";

afterEach(cleanup);

const xray = layoutOf([{ id: "action", name: "Action", type: "text", builtin: true }], {
  order: ["Action"],
  collapsed: [],
  hidden: [],
});

const localStep: Step = { fields: { Action: "Ouvrir la vue de traction." }, sources: [], images: [] };

describe("Claude marks", () => {
  it("calls a step added only when the test had fewer steps before the run", () => {
    expect([...addedSteps([2, 6], 5)]).toEqual([6]);
    expect([...addedSteps([1], 3)]).toEqual([]);
  });

  it("never calls a step added when the step count before the run is unknown", () => {
    expect([...addedSteps([1], undefined)]).toEqual([]);
    expect([...addedSteps([1, 2], null)]).toEqual([]);
  });

  it("badges a changed local step (no Xray id) as Changed by Claude", () => {
    render(
      <StepCard
        index={0}
        count={1}
        step={localStep}
        xray={xray}
        layout="stacked"
        url={(f) => f}
        claude
        added={addedSteps([1], 1).has(1)}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    expect(screen.queryByText("Added by Claude")).not.toBeInTheDocument();
  });
});

describe("passage emphasis", () => {
  it("reads **bold** and *italic* runs and keeps a lone star", () => {
    expect(emphasisRuns("**EXI_MOP_SPF_511_A_1650** : le *sectionneur* 2 * 3")).toEqual([
      { text: "EXI_MOP_SPF_511_A_1650", strong: true, em: false },
      { text: " : le ", strong: false, em: false },
      { text: "sectionneur", strong: false, em: true },
      { text: " 2 * 3", strong: false, em: false },
    ]);
  });

  it("renders emphasis without the stars and highlights a quote across it", () => {
    const { container } = render(
      <p>{highlight("**EXI_MOP_SPF_511_A_1650** : Le sectionneur *est* représenté.", "1650 : le sectionneur est")}</p>,
    );
    expect(container.textContent).toBe("EXI_MOP_SPF_511_A_1650 : Le sectionneur est représenté.");
    const text = (sel: string) =>
      Array.from(container.querySelectorAll(sel))
        .map((e) => e.textContent)
        .join("");
    expect(text("strong")).toBe("EXI_MOP_SPF_511_A_1650");
    expect(text("em")).toBe("est");
    expect(container.innerHTML).not.toContain("*");
    const marked = Array.from(container.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marked.join("")).toBe("1650 : Le sectionneur est");
  });
});

describe("system status", () => {
  it("says Not checked when every check was skipped, never All good", () => {
    const c = (state: "ok" | "warn" | "fail" | "skip") => ({ id: state, label: state, state, detail: "" });
    expect(worst([c("skip"), c("skip")])).toBe("skip");
    expect(worst([c("skip"), c("ok")])).toBe("ok");
    expect(worst([c("skip"), c("warn")])).toBe("warn");
  });
});
