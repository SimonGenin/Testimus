// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "../../../../src/ui/components/ui/Checkbox.tsx";
import { RadioGroup } from "../../../../src/ui/components/ui/RadioGroup.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("Checkbox", () => {
  it("is a checkbox named by its label; a click or the label reports the new state", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Only with findings" />);
    const box = screen.getByRole("checkbox", { name: "Only with findings" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Only with findings"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("on shows a check mark and reports off when clicked", () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="Only with findings" />);
    const box = screen.getByRole("checkbox", { name: "Only with findings" });
    expect(box).toBeChecked();
    expect(box.parentElement?.querySelector("svg")).not.toBeNull();
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("mixed is partly checked, looks on, and a click turns it on", () => {
    const onChange = vi.fn();
    render(
      <>
        <Checkbox checked="mixed" onChange={onChange} label="All folders" />
        <Checkbox checked onChange={() => {}} label="on" />
        <Checkbox checked={false} onChange={() => {}} label="off" />
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "All folders" });
    expect(box).toBePartiallyChecked();
    expect(cls(box)).toBe(cls(screen.getByRole("checkbox", { name: "on" })));
    expect(cls(box)).not.toBe(cls(screen.getByRole("checkbox", { name: "off" })));
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("leaves mixed when the state changes", () => {
    const { rerender } = render(<Checkbox checked="mixed" onChange={() => {}} label="All" />);
    expect(screen.getByRole("checkbox", { name: "All" })).toBePartiallyChecked();
    rerender(<Checkbox checked onChange={() => {}} label="All" />);
    expect(screen.getByRole("checkbox", { name: "All" })).not.toBePartiallyChecked();
    expect(screen.getByRole("checkbox", { name: "All" })).toBeChecked();
  });

  it("reads its hint as its description", () => {
    render(
      <Checkbox
        checked
        onChange={() => {}}
        label="Shared with every project"
        hint="Every project sees this context."
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Shared with every project" })).toHaveAccessibleDescription(
      "Every project sees this context.",
    );
  });

  it("disabled cannot be changed, and gives its reason as a tooltip", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <>
        <Checkbox checked onChange={onChange} label="Plain" disabled />
        <Checkbox checked={false} onChange={onChange} label="Shared" disabled="Claude is not connected" />
      </>,
    );
    expect(screen.getByRole("checkbox", { name: "Plain" })).toBeDisabled();
    const box = screen.getByRole("checkbox", { name: "Shared" });
    expect(box).toBeDisabled();
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).toHaveTextContent("Claude is not connected");
    fireEvent.mouseEnter(tip.parentElement as Element);
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("tooltip")).toBeVisible();
  });

  it("a radio is a radio input with its name and value, and only reports being chosen", () => {
    const onChange = vi.fn();
    render(<Checkbox radio name="folder" value="move" checked={false} onChange={onChange} label="Move the models" />);
    const r = screen.getByRole("radio", { name: "Move the models" });
    expect(r).toHaveAttribute("name", "folder");
    expect(r).toHaveAttribute("value", "move");
    fireEvent.click(r);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("a radio on has no check mark and looks unlike a checkbox on", () => {
    render(
      <>
        <Checkbox radio checked onChange={() => {}} label="radio on" />
        <Checkbox checked onChange={() => {}} label="box on" />
        <Checkbox radio checked="mixed" onChange={() => {}} label="radio mixed" />
      </>,
    );
    const r = screen.getByRole("radio", { name: "radio on" });
    expect(r).toBeChecked();
    expect(r.parentElement?.querySelector("svg")).toBeNull();
    expect(cls(r)).not.toBe(cls(screen.getByRole("checkbox", { name: "box on" })));
    expect(screen.getByRole("radio", { name: "radio mixed" })).not.toBeChecked();
  });

  it("the catalogue can show hover and focus", () => {
    render(
      <>
        <Checkbox checked={false} onChange={() => {}} label="rest" />
        <Checkbox checked={false} onChange={() => {}} label="hover" debugState="hover" />
        <Checkbox checked={false} onChange={() => {}} label="focus" debugState="focus" />
      </>,
    );
    const rest = cls(screen.getByRole("checkbox", { name: "rest" }));
    expect(cls(screen.getByRole("checkbox", { name: "hover" }))).not.toBe(rest);
    expect(cls(screen.getByRole("checkbox", { name: "focus" }))).not.toBe(rest);
  });
});

function Folder({ initial = null as "move" | "keep" | "copy" | null, showLabel = false }) {
  const [v, setV] = useState(initial);
  return (
    <RadioGroup
      label="The models folder"
      showLabel={showLabel}
      value={v}
      onChange={setV}
      options={[
        { value: "move", label: "Move the models", hint: "4.2 GB, about 2 minutes" },
        { value: "keep", label: "Keep them where they are" },
        { value: "copy", label: "Copy them", disabled: "Not enough room on D:" },
      ]}
    />
  );
}

describe("RadioGroup", () => {
  it("is a radiogroup named by its label, one choice at a time, all sharing a name", () => {
    render(<Folder />);
    const group = screen.getByRole("radiogroup", { name: "The models folder" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(new Set(radios.map((r) => r.getAttribute("name"))).size).toBe(1);
    expect(group).toContainElement(radios[0]);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Move the models" }));
    expect(screen.getByRole("radio", { name: "Move the models" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Keep them where they are" }));
    expect(screen.getByRole("radio", { name: "Keep them where they are" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Move the models" })).not.toBeChecked();
  });

  it("shows its label above the choices, a hint per choice, and a disabled choice with its reason", () => {
    render(<Folder initial="keep" showLabel />);
    expect(screen.getByRole("radiogroup", { name: "The models folder" })).toBeVisible();
    expect(screen.getByText("The models folder")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Move the models" })).toHaveAccessibleDescription(
      "4.2 GB, about 2 minutes",
    );
    expect(screen.getByRole("radio", { name: "Copy them" })).toBeDisabled();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("Not enough room on D:");
  });

  it("disabled as a whole, inline, and the catalogue's forced state on one choice", () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        label="Theme"
        inline
        value={null}
        onChange={onChange}
        disabled
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        debugState={{ value: "b", state: "focus" }}
      />,
    );
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
    expect(cls(screen.getByRole("radio", { name: "B" }))).not.toBe(cls(screen.getByRole("radio", { name: "A" })));
  });
});
