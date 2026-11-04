// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnLayout, Source, Step } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { ReviewStep } from "../../src/ui/screens/review/ReviewStep.tsx";
import { StepCard } from "../../src/ui/screens/tests/StepCard.tsx";
import { clearToasts } from "./cov-uiscreens-helpers.tsx";
import { renderWithData } from "./cov-uishell-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";
import { fakeFetch, noDesktop } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
  resetDoctor();
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fields = [
  { id: "action", name: "Action", type: "text", builtin: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true },
  { id: "cf1", name: "Exigence", type: "text", builtin: false },
];
const xray = (referenceSource: boolean): ColumnLayout =>
  layoutOf(fields, {}, [{ name: "Exigence", id: "cf1", description: "Le code", referenceSource }]);
const a: Source = {
  docId: "SPF",
  anchor: "§4.2",
  quote: "le sectionneur est représenté",
  column: "Exigence",
  item: "EXI_1650",
};
const b: Source = {
  docId: "SPF",
  anchor: "§4.3",
  quote: "un autre passage qui le dit",
  column: "Exigence",
  item: "EXI_1670",
};
const b2: Source = { ...b, anchor: "fig:40", quote: "Figure 40" };
const plain: Source = { docId: "SPF", anchor: "§5.1", quote: "le menu contextuel s'ouvre" };
const step: Step = {
  fields: { Action: "Ouvrir la vue", "Expected Result": "Le sectionneur est affiché", Exigence: "EXI_1650, EXI_1670" },
  sources: [a, b, b2, plain],
  images: [],
};

const card = (x: ColumnLayout, onOpenSource = vi.fn()) => {
  renderWithData(
    <StepCard
      index={0}
      count={1}
      step={step}
      xray={x}
      layout="stacked"
      url={(f) => `/u/${f}`}
      onChange={vi.fn()}
      onOpenSource={onOpenSource}
    />,
  );
  return onOpenSource;
};

describe("a Reference source column in a step", () => {
  it("makes each item a link to its passage, and lists an item's several sources", () => {
    const open = card(xray(true));
    const links = document.querySelector('[data-column="Exigence"]') as HTMLElement;
    expect(links).toHaveTextContent("EXI_1650");
    fireEvent.click(screen.getByRole("button", { name: /EXI_1650/ }));
    expect(open).toHaveBeenCalledWith(a);
    expect(
      within(links)
        .getAllByRole("tooltip")
        .some((t) => t.textContent?.includes(a.quote)),
    ).toBe(true);
    expect(links).toHaveTextContent("EXI_1670");
    fireEvent.click(screen.getByRole("button", { name: /Figure 40/ }));
    expect(open).toHaveBeenLastCalledWith(b2);
    const rest = screen.getByTestId("step-sources");
    expect(within(rest).getAllByRole("button")).toHaveLength(1);
    expect(rest).toHaveTextContent("§5.1");
  });

  it("keeps every source with the step when the option is off", () => {
    card(xray(false));
    expect(document.querySelector('[data-column="Exigence"]')).toBeNull();
    expect(within(screen.getByTestId("step-sources")).getAllByRole("button")).toHaveLength(4);
  });

  it("links the items on the review screen too", () => {
    const onSelect = vi.fn();
    renderWithData(
      <ReviewStep
        n={2}
        step={step}
        xray={xray(true)}
        findings={[]}
        stale={false}
        folded={false}
        active={false}
        selected="SPF#§4.2"
        url={(f) => f}
        onFold={vi.fn()}
        onSelect={onSelect}
        onOpenImage={vi.fn()}
      />,
    );
    const link = screen.getByRole("button", { name: /EXI_1650/ });
    expect(link).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith(a, 2);
  });
});
