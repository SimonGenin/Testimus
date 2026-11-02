// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step, XrayJson } from "../../src/core/types.ts";
import { StepCard } from "../../src/ui/screens/tests/StepCard.tsx";

afterEach(cleanup);

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf-exigence", name: "Exigence", type: "text", builtin: false },
  ],
  prefs: { order: ["Action", "Data", "Expected Result", "Exigence"], collapsed: ["Data"], hidden: [] },
};

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

const card = (x: XrayJson, onChange = vi.fn()) =>
  render(<StepCard index={1} count={3} step={step} xray={x} layout="stacked" url={(f) => f} onChange={onChange} />);

describe("StepCard", () => {
  it("draws the fields in xray.json order", () => {
    const { container } = card(xray);
    const labels = Array.from(container.querySelectorAll(".fl-k")).map((e) => e.textContent);
    expect(labels).toEqual(["Action", "Data", "Expected Result", "Exigence"]);
  });

  it("follows a different order and hides hidden fields unless they hold text", () => {
    const x: XrayJson = {
      ...xray,
      prefs: { order: ["Expected Result", "Action", "Exigence", "Data"], collapsed: [], hidden: ["Exigence", "Data"] },
    };
    const empty = { ...step, fields: { ...step.fields, Data: "" } };
    const { container } = render(
      <StepCard index={1} count={3} step={empty} xray={x} layout="stacked" url={(f) => f} onChange={vi.fn()} />,
    );
    const labels = Array.from(container.querySelectorAll(".fl-k")).map((e) => e.textContent);
    expect(labels).toEqual(["Expected Result", "Action", "Exigence"]);
  });

  it("folds Data by default and opens it on demand", () => {
    card(xray);
    expect(screen.queryByLabelText("Data of step 2")).toBeNull();
    const fold = screen.getByRole("button", { name: "Show Data of step 2" });
    expect(fold).toHaveTextContent("Folded");
    fireEvent.click(fold);
    expect(screen.getByLabelText("Data of step 2")).toHaveValue("Sectionneur S 12, position fermée.");
  });

  it("shows Exigence as requirement chips and the sources strip", () => {
    const { container } = card(xray);
    const reqs = Array.from(container.querySelectorAll(".chip.req")).map((e) => e.textContent);
    expect(reqs).toEqual(["EXI_MOP_SPF_511_A_1670", "EXI_MOP_SPF_510_A_20"]);
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

  it("removes a requirement without touching the others", () => {
    const onChange = vi.fn();
    card(xray, onChange);
    fireEvent.click(screen.getByRole("button", { name: "Remove requirement EXI_MOP_SPF_510_A_20" }));
    const next = onChange.mock.calls[0][0](step) as Step;
    expect(next.fields.Exigence).toBe("EXI_MOP_SPF_511_A_1670");
  });
});
