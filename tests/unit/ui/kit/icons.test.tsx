// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, DIFF, SYNC } from "../../../../src/ui/components/ui/Badge.tsx";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Checkbox } from "../../../../src/ui/components/ui/Checkbox.tsx";
import { Disclosure } from "../../../../src/ui/components/ui/Disclosure.tsx";
import { Icon } from "../../../../src/ui/components/ui/Icon.tsx";
import { Modal } from "../../../../src/ui/components/ui/Modal.tsx";

afterEach(cleanup);

const iconOf = (el: Element | null) => el?.querySelector("[data-icon]")?.getAttribute("data-icon");

describe("the design's icons in the kit", () => {
  it("an icon says which one it is (data-icon); « spinner » is the turning Spinner, never a still arc", () => {
    const { container } = render(<Icon name="file" />);
    expect(container.querySelector("svg")).toHaveAttribute("data-icon", "file");
    cleanup();
    render(<Button variant="quiet" icon="spinner" label="2 jobs running" />);
    const b = screen.getByRole("button", { name: "2 jobs running" });
    expect(b.querySelector("svg")).toBeNull();
    expect(b.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    cleanup();
    render(<Icon name="spinner" label="Running" />);
    expect(screen.getByRole("status", { name: "Running" })).toBeInTheDocument();
  });

  it("sync badges as the screens draw them: Checking… refresh, In sync sync, Modified circle-dot, Local only drive", () => {
    render(
      <>
        <Badge {...SYNC.checking} />
        <Badge {...SYNC["in-sync"]} />
        <Badge {...SYNC.modified} />
        <Badge {...SYNC.local} />
        <Badge {...DIFF.modified} label="Step modified" />
      </>,
    );
    expect(iconOf(screen.getByText("Checking…"))).toBe("refresh");
    expect(iconOf(screen.getByText("In sync"))).toBe("sync");
    expect(iconOf(screen.getByText("Modified"))).toBe("circle-dot");
    expect(iconOf(screen.getByText("Local only"))).toBe("drive");
    expect(iconOf(screen.getByText("Step modified"))).toBe("circle-dot");
  });

  it("a checkbox and a fold can lead with an icon; Claude's fold in Claude's colour", () => {
    render(
      <>
        <Checkbox label="Glossaire RATP" icon="context" checked onChange={() => {}} />
        <Disclosure summary="What Claude did" icon="claude">
          <p>x</p>
        </Disclosure>
      </>,
    );
    expect(screen.getByRole("checkbox", { name: "Glossaire RATP" })).toBeChecked();
    expect(iconOf(screen.getByText("Glossaire RATP"))).toBe("context");
    expect(iconOf(screen.getByRole("button", { name: "What Claude did" }))).toBe("chevron-right");
    expect(
      screen.getByRole("button", { name: "What Claude did" }).querySelector('[data-icon="claude"]'),
    ).not.toBeNull();
  });

  it("a danger confirmation heads with alert-circle; its verb can go without the trash (icon: null)", () => {
    render(
      <Modal
        title="Revert anyway?"
        size="sm"
        confirm={{ verb: "Revert anyway", danger: true, icon: null, onConfirm: () => {} }}
        onClose={() => {}}
      >
        x
      </Modal>,
    );
    expect(screen.getByRole("alertdialog").querySelector('[data-icon="alert-circle"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Revert anyway" }).querySelector("svg")).toBeNull();
    cleanup();
    render(
      <Modal title="Delete?" size="sm" confirm={{ verb: "Delete", danger: true, onConfirm: () => {} }} onClose={() => {}}>
        x
      </Modal>,
    );
    expect(iconOf(screen.getByRole("button", { name: "Delete" }))).toBe("trash");
  });
});
