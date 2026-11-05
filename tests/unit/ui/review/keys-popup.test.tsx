// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { List } from "../../../../src/ui/components/ui/List.tsx";
import { Select } from "../../../../src/ui/components/ui/Select.tsx";
import { type ReviewKeys, useReviewKeys } from "../../../../src/ui/screens/review/useReviewKeys.ts";
import { openList } from "../../helpers/select.ts";

afterEach(cleanup);

const keys = (): ReviewKeys => ({
  next: vi.fn(),
  previous: vi.fn(),
  validate: vi.fn(),
  toFix: vi.fn(),
  step: vi.fn(),
  editing: false,
  off: false,
});

function Harness({ k }: { k: ReviewKeys }) {
  useReviewKeys(k);
  return (
    <>
      <Select
        label="Sort"
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "Anomalies" },
          { value: "v", label: "Validated" },
        ]}
      />
      <List
        label="Queue"
        selection="single"
        selected="T-1"
        items={["T-1", "T-2"]}
        getKey={(t) => t}
        renderItem={(t) => ({ title: t })}
      />
    </>
  );
}

describe("the review keys and an open list", () => {
  it("a key typed in a Select's open list chooses in it, never validates nor moves the step", () => {
    const k = keys();
    render(<Harness k={k} />);
    const list = openList(screen.getByRole("combobox", { name: "Sort" }));
    const option = list.querySelector('[role="option"]') as HTMLElement;
    fireEvent.keyDown(option, { key: "v" });
    fireEvent.keyDown(option, { key: "ArrowDown" });
    expect(k.validate).not.toHaveBeenCalled();
    expect(k.step).not.toHaveBeenCalled();
  });

  it("an arrow that moves the focus in the queue moves only the queue, not the step", () => {
    const k = keys();
    render(<Harness k={k} />);
    const row = screen.getByRole("option", { name: /T-1/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /T-2/ }));
    expect(k.step).not.toHaveBeenCalled();
  });

  it("with nothing open, the keys still decide", () => {
    const k = keys();
    render(<Harness k={k} />);
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(k.validate).toHaveBeenCalledTimes(1);
    expect(k.step).toHaveBeenCalledWith(1);
  });
});
