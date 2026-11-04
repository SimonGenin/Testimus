// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented, type SegmentedOption } from "../../../../src/ui/components/ui/Segmented.tsx";

afterEach(cleanup);

const cls = (el: Element) => el.getAttribute("class") ?? "";

type Filter = "all" | "checked" | "fix" | "validated";
const FILTERS: SegmentedOption<Filter>[] = [
  { value: "all", label: "All", count: 5 },
  { value: "checked", label: "Checked" },
  { value: "fix", label: "To fix", disabled: true },
  { value: "validated", label: "Validated" },
];

function Review({ initial = "all" as Filter, onChange = (_: Filter) => {} }) {
  const [v, setV] = useState<Filter>(initial);
  return (
    <Segmented
      label="Review filter"
      value={v}
      options={FILTERS}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe("Segmented", () => {
  it("is a radiogroup named by its label; each option is a radio, the chosen one checked", () => {
    render(<Review />);
    expect(screen.getByRole("radiogroup", { name: "Review filter" })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /All/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Checked" })).not.toBeChecked();
  });

  it("a click chooses; choosing the chosen one does not report again", () => {
    const onChange = vi.fn();
    render(<Review onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Checked" }));
    expect(screen.getByRole("radio", { name: "Checked" })).toBeChecked();
    expect(onChange).toHaveBeenCalledWith("checked");
    fireEvent.click(screen.getByRole("radio", { name: "Checked" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("only the chosen option is in the tab order", () => {
    render(<Review initial="checked" />);
    expect(screen.getByRole("radio", { name: "Checked" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute("tabindex", "-1");
  });

  it("the arrows move and choose, skipping disabled options and wrapping; Home and End", () => {
    render(<Review initial="checked" />);
    const radio = (name: string | RegExp) => screen.getByRole("radio", { name });
    radio("Checked").focus();
    fireEvent.keyDown(radio("Checked"), { key: "ArrowRight" });
    expect(radio("Validated")).toBeChecked();
    expect(radio("Validated")).toHaveFocus();
    fireEvent.keyDown(radio("Validated"), { key: "ArrowDown" });
    expect(radio(/All/)).toBeChecked();
    fireEvent.keyDown(radio(/All/), { key: "ArrowLeft" });
    expect(radio("Validated")).toBeChecked();
    fireEvent.keyDown(radio("Validated"), { key: "ArrowUp" });
    expect(radio("Checked")).toBeChecked();
    fireEvent.keyDown(radio("Checked"), { key: "End" });
    expect(radio("Validated")).toBeChecked();
    fireEvent.keyDown(radio("Validated"), { key: "Home" });
    expect(radio(/All/)).toBeChecked();
    fireEvent.keyDown(radio(/All/), { key: "a" });
    expect(radio(/All/)).toBeChecked();
  });

  it("shows a count apart from the label, and a disabled option with its reason", () => {
    render(
      <Segmented
        label="Jobs"
        value="all"
        onChange={() => {}}
        options={[
          { value: "all", label: "All", count: 12 },
          { value: "running", label: "Running", count: 0, disabled: "Nothing is running" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "All 12" })).toHaveTextContent("All 12");
    const running = screen.getByRole("radio", { name: "Running 0" });
    expect(running).toBeDisabled();
    expect(running).toHaveAccessibleDescription("Nothing is running");
  });

  it("an icon-only option is named by its label and shows it as a tooltip", () => {
    render(
      <Segmented
        label="Step layout"
        value="stacked"
        onChange={() => {}}
        options={[
          { value: "stacked", label: "Stacked", icon: "layout-stacked", iconOnly: true },
          { value: "split", label: "Action | Expected", icon: "layout-split" },
        ]}
      />,
    );
    const stacked = screen.getByRole("radio", { name: "Stacked" });
    expect(stacked).not.toHaveTextContent("Stacked");
    expect(stacked).toHaveAccessibleDescription("Stacked");
    expect(stacked.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Action | Expected" }).querySelector("svg")).not.toBeNull();
  });

  it("enters on the first enabled option when the value is not one of them", () => {
    render(
      <Segmented
        label="Theme"
        value={"none" as "a"}
        onChange={() => {}}
        options={[
          { value: "a", label: "A", disabled: true },
          { value: "b" as "a", label: "B" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("tabindex", "0");
  });

  it("sm, the chosen look, hover and focus forced by the catalogue all differ", () => {
    const opts: SegmentedOption<"x" | "y" | "z">[] = [
      { value: "x", label: "x" },
      { value: "y", label: "y" },
      { value: "z", label: "z" },
    ];
    render(
      <>
        <Segmented
          label="md"
          value="x"
          options={opts}
          onChange={() => {}}
          debugState={{ value: "y", state: "hover" }}
        />
        <Segmented label="sm" size="sm" value="x" options={opts} onChange={() => {}} />
        <Segmented
          label="focus"
          value="x"
          options={opts}
          onChange={() => {}}
          debugState={{ value: "z", state: "focus" }}
        />
      </>,
    );
    const r = (group: string, name: string) =>
      cls(
        screen.getByRole("radiogroup", { name: group }).querySelectorAll("[role=radio]")[
          ["x", "y", "z"].indexOf(name)
        ] as Element,
      );
    expect(r("md", "x")).not.toBe(r("md", "z"));
    expect(r("md", "y")).not.toBe(r("md", "z"));
    expect(r("sm", "z")).not.toBe(r("md", "z"));
    expect(r("focus", "z")).not.toBe(r("md", "z"));
  });

  it("fill takes its container's width, the options sharing it", () => {
    const opts: SegmentedOption<"x" | "y">[] = [
      { value: "x", label: "x" },
      { value: "y", label: "y" },
    ];
    render(
      <>
        <Segmented label="plain" value="x" options={opts} onChange={() => {}} />
        <Segmented label="full" fill value="x" options={opts} onChange={() => {}} />
      </>,
    );
    const group = (n: string) => screen.getByRole("radiogroup", { name: n });
    expect(cls(group("full"))).not.toBe(cls(group("plain")));
    expect(cls(group("full").querySelector("[role=radio]") as Element)).not.toBe(
      cls(group("plain").querySelector("[role=radio]") as Element),
    );
  });
});
