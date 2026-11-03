// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step, XrayJson } from "../../../../src/core/types.ts";
import { MOVE } from "../../../../src/ui/screens/tests/FieldBlocks.tsx";
import { StepCard } from "../../../../src/ui/screens/tests/StepCard.tsx";

afterEach(cleanup);

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
};

const step: Step = {
  fields: { Action: "Open the view\n\n![](images/embedded.png)", "Expected Result": "It opens" },
  sources: [],
  images: [{ file: "images/embedded.png" }, { file: "images/loose.png" }, { file: "images/other.png" }],
};

// ponytail: the attachment is an <img> today and becomes a button (N2) — found by its name, whatever its role
const attachment = (name: string) =>
  screen.queryByRole("img", { name }) ?? screen.getByRole("button", { name: new RegExp(`^(Open )?${name}`) });

const card = (readOnly = false) => {
  const onOpenImage = vi.fn();
  render(
    <StepCard
      index={1}
      count={2}
      step={step}
      xray={xray}
      layout="stacked"
      url={(f) => `/u/${f}`}
      onChange={vi.fn()}
      onOpenImage={onOpenImage}
      readOnly={readOnly}
    />,
  );
  return onOpenImage;
};

describe("StepCard: a loose attachment opens the viewer on a click (StepCard.tsx:546, before it becomes a button)", () => {
  it("names each loose attachment by its file name and shows it from the test folder", () => {
    card();
    expect(screen.getByText("2 attachments not embedded — drag into a field")).toBeInTheDocument();
    expect(attachment("loose.png")).toBeInTheDocument();
    expect(attachment("other.png")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "loose.png" })).toHaveAttribute("src", "/u/images/loose.png");
  });

  it("a click opens the viewer on that file, with every picture of the step to move through", () => {
    const onOpenImage = card();
    fireEvent.click(attachment("other.png"));
    expect(onOpenImage).toHaveBeenCalledTimes(1);
    expect(onOpenImage).toHaveBeenCalledWith("images/other.png", step.images);
  });

  it("still opens the viewer while the step is read-only (Claude works), and cannot be dragged then", () => {
    const onOpenImage = card(true);
    const el = attachment("loose.png");
    fireEvent.click(el);
    expect(onOpenImage).toHaveBeenCalledWith("images/loose.png", step.images);
    expect(el.getAttribute("draggable")).not.toBe("true");
  });

  it("can be dragged into a field while editable: the drag names its step and file", () => {
    card();
    const el = attachment("loose.png");
    expect(el).toHaveAttribute("draggable", "true");
    const setData = vi.fn();
    fireEvent.dragStart(el, { dataTransfer: { setData, effectAllowed: "", types: [], files: [], getData: () => "" } });
    expect(setData).toHaveBeenCalledWith(MOVE, JSON.stringify({ step: 2, file: "images/loose.png" }));
  });
});
