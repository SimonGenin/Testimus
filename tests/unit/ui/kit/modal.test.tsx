// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Modal, type ModalProps } from "../../../../src/ui/components/ui/Modal.tsx";
import { Text } from "../../../../src/ui/components/ui/Text.tsx";

afterEach(cleanup);

const cls = (el: Element) => el.getAttribute("class") ?? "";

// ponytail: the opener, the dialog it opens, and focus going back when it closes — the way a screen uses Modal
function Opener(props: Partial<ModalProps> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label={props.label ?? "Open project"} onClick={() => setOpen(true)} />
      {open && (
        <Modal
          title="Open a project by its Jira key"
          subtitle="Testimus opens the folder that has this key."
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button label="Cancel" onClick={() => setOpen(false)} />
              <Button variant="primary" label="Open" onClick={() => setOpen(false)} />
            </>
          }
          {...props}
        >
          {props.children ?? <Button label="Inside" />}
        </Modal>
      )}
    </>
  );
}

describe("Modal", () => {
  it("is a modal dialog named by its title and described by its subtitle, with the focus inside", async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole("button", { name: "Open project" }));
    const dialog = screen.getByRole("dialog", { name: "Open a project by its Jira key" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Testimus opens the folder that has this key.");
    expect(dialog).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Open a project by its Jira key" })).toBeInTheDocument();
  });

  it("keeps Tab inside, both ways, and Escape closes it and gives the focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Open project" });
    await user.click(opener);
    const close = screen.getByRole("button", { name: "Close" });
    const open = screen.getByRole("button", { name: "Open" });
    await user.keyboard("{Tab}");
    expect(close).toHaveFocus();
    await user.keyboard("{Tab}{Tab}{Tab}");
    expect(open).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(close).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(open).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("Shift+Tab from the dialog itself goes to its last control; a dialog with nothing to focus keeps Tab", async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole("button", { name: "Open project" }));
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    cleanup();
    render(
      <Modal title="Palette" frameless onClose={() => {}}>
        nothing
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Palette" });
    expect(dialog).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(dialog).toHaveFocus();
  });

  it("the close button and a press on the scrim close it; a press inside does not", async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole("button", { name: "Open project" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open project" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the focus where a field put it on opening (autofocus)", async () => {
    const user = userEvent.setup();
    render(
      <Opener>
        <Text ariaLabel="Jira project key" value="LFRPS12" onChange={() => {}} autoFocus />
      </Opener>,
    );
    await user.click(screen.getByRole("button", { name: "Open project" }));
    expect(screen.getByRole("textbox", { name: "Jira project key" })).toHaveFocus();
  });

  it("as a form, submits on Enter in a field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Modal
        title="Open a project"
        onClose={() => {}}
        onSubmit={onSubmit}
        actions={<Button type="submit" variant="primary" label="Open" />}
      >
        <Text ariaLabel="Key" value="" onChange={() => {}} />
      </Modal>,
    );
    await user.click(screen.getByRole("textbox", { name: "Key" }));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("a danger confirmation: an alert dialog, the focus on Cancel, its consequences, a red verb", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <Modal
        title="Delete the local copy?"
        size="sm"
        confirm={{ verb: "Delete", danger: true, onConfirm }}
        consequences={[
          [2, "modified steps are lost"],
          [1, "added step is lost"],
        ]}
        onClose={onClose}
      >
        LFRPS12-1420 has changes that are not in Jira yet.
      </Modal>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete the local copy?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["2modified steps are lost", "1added step is lost"]);
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del.querySelector("svg"), "the danger verb carries its trash (design-gaps point 17)").not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" }).querySelector("svg")).toBeNull();
    await user.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    render(
      <Modal title="Overwrite?" confirm={{ verb: "Overwrite local", onConfirm: () => {} }} onClose={() => {}}>
        x
      </Modal>,
    );
    expect(cls(screen.getByRole("button", { name: "Overwrite local" }))).not.toBe(cls(del));
    expect(screen.getByRole("button", { name: "Overwrite local" }).querySelector("svg")).toBeNull();
    render(
      <Modal title="Undo?" confirm={{ verb: "Undo", icon: "undo", onConfirm: () => {} }} onClose={() => {}}>
        x
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Undo" }).querySelector("svg")).not.toBeNull();
  });

  it("a plain confirmation puts the focus on its verb; an async one is busy while it runs, then shows its failure", async () => {
    const user = userEvent.setup();
    let fail: (e: Error) => void = () => {};
    const onClose = vi.fn();
    render(
      <Modal
        title="Download from Jira?"
        confirm={{
          verb: "Download",
          onConfirm: () =>
            new Promise<void>((_, reject) => {
              fail = reject;
            }),
        }}
        onClose={onClose}
      >
        Your local changes are replaced.
      </Modal>,
    );
    const verb = screen.getByRole("button", { name: "Download" });
    expect(verb).toHaveFocus();
    await user.click(verb);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(verb).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(dialog).toHaveTextContent("Do not close Testimus until this is done");
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => fail(new Error("Jira did not answer — try again in a minute")));
    expect(screen.getByRole("alert")).toHaveTextContent("Jira did not answer — try again in a minute");
    expect(dialog).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("an async confirmation that resolves is no longer busy, and a non-Error failure is shown as text", async () => {
    const user = userEvent.setup();
    let done: () => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const { unmount } = render(
      <Modal
        title="Push?"
        confirm={{ verb: "Push", onConfirm: () => new Promise<void>((r) => (done = r)) }}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "true");
    await act(async () => done());
    expect(screen.getByRole("alertdialog")).not.toHaveAttribute("aria-busy");
    unmount();
    render(
      <Modal
        title="Pull?"
        confirm={{
          verb: "Pull",
          onConfirm: () =>
            new Promise<void>((_, reject) => {
              fail = reject;
            }),
        }}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pull" }));
    await act(async () => fail("403"));
    expect(screen.getByRole("alert")).toHaveTextContent("403");
  });

  it("busy from outside: Escape, close and scrim do nothing, and its own foot note replaces the default one", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal
        title="Pushing to Jira"
        busy
        footNote="Do not close Testimus while pushing"
        actions={<Button variant="primary" label="Push to Jira" loading />}
        onClose={onClose}
      >
        <Button label="Details" />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Do not close Testimus while pushing");
    expect(dialog).not.toHaveTextContent("Do not close Testimus until this is done");
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows an error as a danger banner at the top of the body and stays open", () => {
    render(
      <Modal title="Push plan" error="Jira refused the request (403)." onClose={() => {}}>
        <p>Plan</p>
      </Modal>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Jira refused the request (403).");
    expect(alert.compareDocumentPosition(screen.getByText("Plan")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has three sizes, a flush body, a frameless form named only by its title, and two drawers", () => {
    const looks = new Set<string>();
    for (const size of ["sm", "md", "lg"] as const) {
      render(
        <Modal title={`Size ${size}`} size={size} onClose={() => {}} debugState="open">
          x
        </Modal>,
      );
      looks.add(cls(screen.getByRole("dialog", { name: `Size ${size}` })));
    }
    expect(looks.size).toBe(3);
    render(
      <Modal title="Lightbox" size="lg" icon="image" flush onClose={() => {}} debugState="open">
        <span>well</span>
      </Modal>,
    );
    render(
      <Modal title="Padded" onClose={() => {}} debugState="open">
        <span>padded</span>
      </Modal>,
    );
    expect(cls(screen.getByText("well").parentElement as Element)).not.toBe(
      cls(screen.getByText("padded").parentElement as Element),
    );
    render(
      <Modal title="Search everything" frameless onClose={() => {}} debugState="open">
        <span>palette</span>
      </Modal>,
    );
    const palette = screen.getByRole("dialog", { name: "Search everything" });
    expect(palette.querySelector("h2")).toBeNull();
    const drawers = new Set<string>();
    for (const side of ["left", "right"] as const) {
      render(
        <Modal title={`Drawer ${side}`} drawer={side} onClose={() => {}} debugState="open">
          list
        </Modal>,
      );
      drawers.add(cls(screen.getByRole("dialog", { name: `Drawer ${side}` })));
    }
    expect(drawers.size).toBe(2);
    expect(document.body).toHaveFocus();
  });

  it("in the catalogue, is drawn in place and ignores Escape and the scrim", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Shown" onClose={onClose} debugState="open">
        <Button label="In the kit" />
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "In the kit" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });

describe("the danger button", () => {
  it("lives only in Modal's confirmation (SYSTEM.md: danger only to confirm a destructive dialog)", () => {
    const found = walk("src/ui")
      .filter((f) => !f.includes("components/legacy") && !f.endsWith("components/ui/Modal.tsx"))
      .filter((f) => /variant=\{?["']danger["']|variant: ["']danger["']/.test(readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });
});
