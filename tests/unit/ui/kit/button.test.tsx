// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner } from "../../../../src/ui/components/ui/Banner.tsx";
import { Button, type ButtonVariant } from "../../../../src/ui/components/ui/Button.tsx";
import { Icon } from "../../../../src/ui/components/ui/Icon.tsx";
import { Kbd } from "../../../../src/ui/components/ui/Kbd.tsx";
import { Menu } from "../../../../src/ui/components/ui/Menu.tsx";
import { Modal } from "../../../../src/ui/components/ui/Modal.tsx";
import { Spinner } from "../../../../src/ui/components/ui/Spinner.tsx";
import { Tooltip } from "../../../../src/ui/components/ui/Tooltip.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("Button", () => {
  it("is a button named by its label that calls onClick", () => {
    const onClick = vi.fn();
    render(<Button label="Push to Jira" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Push to Jira" });
    expect(b).toHaveAttribute("type", "button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("looks different for each variant and size, and the same for the same options", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "quiet", "danger", "claude", "claude-quiet"];
    const seen = new Set<string>();
    for (const v of variants) {
      render(<Button label={v} variant={v} />);
      seen.add(cls(screen.getByRole("button", { name: v })));
    }
    expect(seen.size).toBe(variants.length);
    const sizes = new Set<string>();
    for (const s of ["xs", "sm", "md", "lg"] as const) {
      render(<Button label={`size ${s}`} size={s} />);
      sizes.add(cls(screen.getByRole("button", { name: `size ${s}` })));
    }
    expect(sizes.size).toBe(4);
    render(<Button label="a" variant="primary" />);
    render(<Button label="b" variant="primary" />);
    expect(cls(screen.getByRole("button", { name: "a" }))).toBe(cls(screen.getByRole("button", { name: "b" })));
  });

  it("with an icon only, is named by its label and shows it as a tooltip", () => {
    render(<Button label="Delete step" icon="trash" iconOnly />);
    const b = screen.getByRole("button", { name: "Delete step" });
    expect(b).not.toHaveTextContent("Delete step");
    expect(b).toHaveAccessibleDescription("Delete step");
    expect(b.querySelector("svg")).not.toBeNull();
  });

  it("shows an icon after, a count and a shortcut", () => {
    render(<Button label="Review" icon="review" iconAfter="chevron-down" count={3} shortcut="V" variant="primary" />);
    const b = screen.getByRole("button", { name: /Review/ });
    expect(b).toHaveTextContent("3");
    expect(b.querySelector("kbd")).toHaveTextContent("V");
    expect(b.querySelectorAll("svg")).toHaveLength(2);
  });

  it("while loading, is busy, shows a spinner and ignores clicks", () => {
    const onClick = vi.fn();
    render(<Button label="Saving" icon="check" loading onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Saving" });
    expect(b).toHaveAttribute("aria-busy", "true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled, cannot be pressed, and a reason becomes its description", () => {
    const onClick = vi.fn();
    render(<Button label="Push" disabled="Claude is working — wait for it to finish" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Push" });
    expect(b).toBeDisabled();
    expect(b).toHaveAccessibleDescription("Claude is working — wait for it to finish");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    render(<Button label="Plain off" disabled />);
    expect(screen.getByRole("button", { name: "Plain off" })).toBeDisabled();
  });

  it("says when it is a pressed toggle or a menu trigger, and forwards its ref and test id", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        label="More"
        icon="more"
        iconOnly
        ref={ref}
        popup={{ kind: "menu", open: true, controls: "m1" }}
        data-testid="more"
      />,
    );
    const b = screen.getByRole("button", { name: "More" });
    expect(b).toHaveAttribute("aria-haspopup", "menu");
    expect(b).toHaveAttribute("aria-expanded", "true");
    expect(b).toHaveAttribute("aria-controls", "m1");
    expect(ref.current).toBe(b);
    expect(screen.getByTestId("more")).toBe(b);
    render(<Button label="Stacked" pressed />);
    expect(screen.getByRole("button", { name: "Stacked" })).toHaveAttribute("aria-pressed", "true");
    render(<Button label="Unstacked" pressed={false} />);
    render(<Button label="Held" debugState="pressed" />);
    const on = cls(screen.getByRole("button", { name: "Stacked" }));
    expect(on).not.toBe(cls(screen.getByRole("button", { name: "Unstacked" })));
    expect(on).toBe(cls(screen.getByRole("button", { name: "Held" })));
  });

  it("is a submit button when asked, full width when block, and shows forced states for the catalogue", () => {
    render(<Button label="Save" type="submit" block />);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "submit");
    const states = new Set<string>();
    for (const d of [undefined, "hover", "pressed", "focus"] as const) {
      render(<Button label={`state ${d}`} variant="primary" debugState={d} />);
      states.add(cls(screen.getByRole("button", { name: `state ${d}` })));
    }
    expect(states.size).toBe(4);
  });
});

describe("Tooltip", () => {
  it("shows after 500 ms of hover, at once on focus, and hides on leave, blur and Escape", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Open in Jira" shortcut="O">
        <button type="button">Jira</button>
      </Tooltip>,
    );
    const tip = screen.getByRole("tooltip", { hidden: true });
    const anchor = screen.getByRole("button", { name: "Jira" }).parentElement as HTMLElement;
    const hiddenClass = cls(tip);
    fireEvent.mouseEnter(anchor);
    act(() => vi.advanceTimersByTime(499));
    expect(cls(tip)).toBe(hiddenClass);
    act(() => vi.advanceTimersByTime(1));
    expect(cls(tip)).not.toBe(hiddenClass);
    expect(tip).toHaveTextContent("Open in JiraO");
    fireEvent.mouseLeave(anchor);
    expect(cls(tip)).toBe(hiddenClass);
    fireEvent.focus(screen.getByRole("button", { name: "Jira" }));
    expect(cls(tip)).not.toBe(hiddenClass);
    fireEvent.keyDown(anchor, { key: "Escape" });
    expect(cls(tip)).toBe(hiddenClass);
    fireEvent.blur(screen.getByRole("button", { name: "Jira" }));
    fireEvent.pointerDown(document.body);
    fireEvent.focus(screen.getByRole("button", { name: "Jira" }));
    expect(cls(tip)).toBe(hiddenClass);
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(screen.getByRole("button", { name: "Jira" }));
    expect(cls(tip)).not.toBe(hiddenClass);
    for (const side of ["bottom", "left", "right"] as const) {
      render(
        <Tooltip label={side} side={side}>
          <button type="button">{`b-${side}`}</button>
        </Tooltip>,
      );
      expect(screen.getByRole("button", { name: `b-${side}` })).toHaveAccessibleDescription(side);
    }
  });
});

function Host() {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Menu
        trigger={<Button variant="quiet" iconOnly icon="more" label="More actions for this document" />}
        entries={[{ label: "Delete this document…", danger: true, onSelect: () => setConfirm(true) }]}
      />
      {confirm && (
        <Modal
          title="Delete?"
          size="sm"
          confirm={{ verb: "Delete", danger: true, onConfirm: () => {} }}
          onClose={() => setConfirm(false)}
        >
          x
        </Modal>
      )}
    </>
  );
}

describe("Tooltip on a menu's trigger (design-gaps point 66)", () => {
  it("stays hidden while the menu is open and when a clicked item gives the focus back to open a confirmation", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const more = screen.getByRole("button", { name: "More actions for this document" });
    const tip = screen.getByRole("tooltip", { hidden: true });
    const hiddenClass = cls(tip);
    await user.click(more);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(cls(tip)).toBe(hiddenClass);
    await user.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    expect(screen.getByRole("alertdialog", { name: "Delete?" })).toBeInTheDocument();
    expect(cls(tip)).toBe(hiddenClass);
  });
});

describe("Icon, Spinner, Kbd, Banner", () => {
  it("an icon is decoration beside a word, and an image when it carries a label", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    render(<Icon name="validated" size="lg" label="Validated" />);
    expect(screen.getByRole("img", { name: "Validated" })).toBeInTheDocument();
    render(<Icon name="info" size="sm" />);
    const a = render(<Icon name="check" size="xs" bold />).container.querySelector("svg");
    const b = render(<Icon name="check" size="xs" />).container.querySelector("svg");
    expect(cls(a as Element)).not.toBe(cls(b as Element));
  });

  it("a spinner is silent unless it is the only sign of the work", () => {
    const { container } = render(<Spinner />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    render(<Spinner size="sm" label="Loading the passage" />);
    expect(screen.getByRole("status", { name: "Loading the passage" })).toBeInTheDocument();
  });

  it("keys read as keys, plain or on a filled control", () => {
    render(
      <>
        <Kbd>Ctrl K</Kbd>
        <Kbd onFill>V</Kbd>
      </>,
    );
    expect(screen.getByText("Ctrl K").tagName).toBe("KBD");
    expect(cls(screen.getByText("Ctrl K"))).not.toBe(cls(screen.getByText("V")));
  });

  it("a banner states, alerts when serious, and carries its actions", () => {
    const tones = ["info", "success", "warning", "danger", "claude", "neutral"] as const;
    const looks = new Set<string>();
    for (const t of tones) {
      render(
        <Banner tone={t} title={`T ${t}`}>
          {`body ${t}`}
        </Banner>,
      );
      const el = screen.getByText(`body ${t}`).closest("[role]") as HTMLElement;
      expect(el).toHaveAttribute("role", t === "danger" || t === "warning" ? "alert" : "status");
      looks.add(cls(el));
    }
    expect(looks.size).toBe(tones.length);
    render(
      <Banner compact icon="sync" actions={<Button label="Reindex" />}>
        Search on words only
      </Banner>,
    );
    expect(screen.getByRole("button", { name: "Reindex" })).toBeInTheDocument();
    expect(screen.getByText("Search on words only")).toBeInTheDocument();
  });
});

describe("Button pick", () => {
  it("opens a hidden file picker and hands over the files chosen", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <Button label="Add image" icon="image" pick={{ accept: "image/*", multiple: true, onFiles }} />,
    );
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("multiple");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(click).toHaveBeenCalled();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    fireEvent.change(input, { target: { files: [] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });
});
