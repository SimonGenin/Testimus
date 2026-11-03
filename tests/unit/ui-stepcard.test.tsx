// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnLayout, Step } from "../../src/core/types.ts";
import { StepCard } from "../../src/ui/screens/tests/StepCard.tsx";
import { layoutOf, prefsOf } from "./layout-helpers.ts";

afterEach(cleanup);

const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf-exigence", name: "Exigence", type: "text", builtin: false },
  ],
  { order: ["Action", "Data", "Expected Result", "Exigence"], collapsed: ["Data"], hidden: [] },
);

const step: Step = {
  id: "102",
  fields: {
    Action: "Clic droit sur le sectionneur S 12.",
    Data: "Sectionneur S 12, position fermée.",
    "Expected Result": "Le menu propose Propriétés.",
    Exigence: "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
  },
  sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
  images: [],
};

const card = (x: ColumnLayout, onChange = vi.fn()) =>
  render(<StepCard index={1} count={3} step={step} xray={x} layout="stacked" url={(f) => f} onChange={onChange} />);

describe("StepCard", () => {
  it("draws the fields in xray.json order", () => {
    const { container } = card(layoutOf(xray.fields, { ...prefsOf(xray), collapsed: [] }));
    const labels = Array.from(container.querySelectorAll(".fl-k")).map((e) => e.textContent);
    expect(labels).toEqual(["Action", "Data", "Expected Result", "Exigence"]);
  });

  it("follows a different order and hides hidden fields unless they hold text", () => {
    const x = layoutOf(xray.fields, {
      order: ["Expected Result", "Action", "Exigence", "Data"],
      collapsed: [],
      hidden: ["Exigence", "Data"],
    });
    const empty = { ...step, fields: { ...step.fields, Data: "" } };
    const { container } = render(
      <StepCard index={1} count={3} step={empty} xray={x} layout="stacked" url={(f) => f} onChange={vi.fn()} />,
    );
    const labels = Array.from(container.querySelectorAll(".fl-k")).map((e) => e.textContent);
    expect(labels).toEqual(["Expected Result", "Action", "Exigence"]);
  });

  it("folds a collapsed column, shows a dot when it holds something, and folds both ways", () => {
    card(xray);
    expect(screen.queryByLabelText("Data of step 2")).toBeNull();
    const fold = screen.getByRole("button", { name: "Data column of step 2" });
    expect(fold).toHaveAttribute("aria-pressed", "false");
    expect(fold).toHaveTextContent("Data ●");
    fireEvent.click(fold);
    expect(screen.getByLabelText("Data of step 2")).toHaveValue("Sectionneur S 12, position fermée.");
    expect(fold).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(fold);
    expect(screen.queryByLabelText("Data of step 2")).toBeNull();
  });

  it("opens a « when filled » column only on a step that holds something", () => {
    const filled = layoutOf(xray.fields, { ...prefsOf(xray), collapsed: [], filled: ["Data"] });
    card(filled);
    expect(screen.getByLabelText("Data of step 2")).toHaveValue("Sectionneur S 12, position fermée.");
  });

  it("shows Exigence as plain text and the sources strip", () => {
    const { container } = card(xray);
    expect(screen.getByLabelText("Exigence of step 2")).toHaveValue("EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20");
    expect(container.querySelector('[data-field="Exigence"] .chip')).toBeNull();
    const strip = container.querySelector(".sources");
    expect(strip).toHaveTextContent("Sources");
    expect(strip).toHaveTextContent("SOSIE_211_D401-1_3 §5.6.6");
  });

  it("edits a field through a reducer over the step", () => {
    const onChange = vi.fn();
    card(xray, onChange);
    fireEvent.change(screen.getByLabelText("Action of step 2"), { target: { value: "Clic droit sur S 14." } });
    const next = onChange.mock.calls[0][0](step) as Step;
    expect(next.fields.Action).toBe("Clic droit sur S 14.");
    expect(next.fields["Expected Result"]).toBe(step.fields["Expected Result"]);
  });

  it("edits a smart column as plain text", () => {
    const onChange = vi.fn();
    card(xray, onChange);
    fireEvent.change(screen.getByLabelText("Exigence of step 2"), { target: { value: "EXI_MOP_SPF_511_A_1670" } });
    const next = onChange.mock.calls[0][0](step) as Step;
    expect(next.fields.Exigence).toBe("EXI_MOP_SPF_511_A_1670");
  });
});
