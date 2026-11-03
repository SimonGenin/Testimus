// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "../../../../src/ui/components/ui/Switch.tsx";

afterEach(cleanup);

const cls = (el: Element) => el.getAttribute("class") ?? "";

function OnTop() {
  const [on, setOn] = useState(false);
  return <Switch on={on} onChange={setOn} label="Always on top" />;
}

describe("Switch", () => {
  it("is a switch named by its label; a click or the keyboard turns it on and off", () => {
    render(<OnTop />);
    const s = screen.getByRole("switch", { name: "Always on top" });
    expect(s).not.toBeChecked();
    expect(s).toHaveAttribute("type", "button");
    fireEvent.click(s);
    expect(s).toBeChecked();
    fireEvent.click(screen.getByText("Always on top"));
    expect(s).not.toBeChecked();
  });

  it("reports the new state", () => {
    const onChange = vi.fn();
    render(<Switch on onChange={onChange} label="Claude fills it" />);
    fireEvent.click(screen.getByRole("switch", { name: "Claude fills it" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("on and off look different", () => {
    render(
      <>
        <Switch on onChange={() => {}} label="on" />
        <Switch on={false} onChange={() => {}} label="off" />
      </>,
    );
    const track = (name: string) => screen.getByRole("switch", { name }).firstElementChild as Element;
    expect(cls(track("on"))).not.toBe(cls(track("off")));
  });

  it("reads its hint as its description", () => {
    render(<Switch on={false} onChange={() => {}} label="Always on top" hint="Keeps the window above Jira." />);
    expect(screen.getByRole("switch", { name: "Always on top" })).toHaveAccessibleDescription(
      "Keeps the window above Jira.",
    );
  });

  it("disabled cannot be changed, and gives its reason as a tooltip", () => {
    const onChange = vi.fn();
    render(
      <>
        <Switch on onChange={onChange} label="Plain" disabled />
        <Switch on onChange={onChange} label="Glossaire RATP" disabled="Claude is working" />
      </>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Plain" }));
    const s = screen.getByRole("switch", { name: "Glossaire RATP" });
    expect(s).toBeDisabled();
    fireEvent.click(s);
    expect(onChange).not.toHaveBeenCalled();
    expect(s).toHaveAccessibleDescription("Claude is working");
  });

  it("the catalogue can show focus", () => {
    render(
      <>
        <Switch on={false} onChange={() => {}} label="rest" />
        <Switch on={false} onChange={() => {}} label="focus" debugState="focus" />
      </>,
    );
    const track = (name: string) => screen.getByRole("switch", { name }).firstElementChild as Element;
    expect(cls(track("focus"))).not.toBe(cls(track("rest")));
  });
});
