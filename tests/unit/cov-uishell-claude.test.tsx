// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerText } from "../../src/ui/components/claude/AnswerText.tsx";
import { ConnectClaude } from "../../src/ui/components/claude/ConnectClaude.tsx";
import { RevertConflict } from "../../src/ui/components/claude/RevertConflict.tsx";
import { Toasts } from "../../src/ui/components/ui/index.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
});

const clipboard = (writeText: (s: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

describe("ConnectClaude", () => {
  it("copies a step's command and says so, or says it could not", async () => {
    const write = vi.fn(async () => {});
    clipboard(write);
    const check = vi.fn();
    render(
      <>
        <ConnectClaude
          status={{ installed: false, signedIn: null, detail: "claude.exe was not found on PATH" }}
          checking={false}
          onCheck={check}
          onDoctor={() => {}}
        />
        <Probe />
      </>,
    );
    expect(screen.getByText("claude.exe was not found on PATH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy: npm install -g @anthropic-ai/claude-code" }));
    expect(await screen.findByText("Command copied")).toBeInTheDocument();
    expect(write).toHaveBeenCalledWith("npm install -g @anthropic-ai/claude-code");
    clipboard(async () => {
      throw new Error("denied");
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy: claude" }));
    expect(await screen.findByText("Could not copy the command")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(check).toHaveBeenCalled();
  });

  it("uses the steps the core sends and shows the check in progress", () => {
    render(
      <ConnectClaude
        status={{ installed: true, signedIn: false, connect: [{ title: "Use the proxy", cmd: "set X=1", hint: "" }] }}
        checking
        onCheck={() => {}}
        onDoctor={() => {}}
      />,
    );
    expect(screen.getByText("Use the proxy")).toBeInTheDocument();
    expect(document.querySelector(".connect-hint")).toBeNull();
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    cleanup();
    render(
      <ConnectClaude
        status={{ installed: true, signedIn: false }}
        checking={false}
        onCheck={() => {}}
        onDoctor={() => {}}
      />,
    );
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});

describe("AnswerText", () => {
  it("splits paragraphs, turns references into chips and shows the caret while running", () => {
    const open = vi.fn();
    const { container, rerender } = render(
      <AnswerText text={'Premier.\n\nVoir [D#§1.2] "le menu" et D#fig:3.'} running onOpenSource={open} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll(".caret")).toHaveLength(1);
    expect(container.querySelectorAll("p")[1].querySelector(".caret")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "D §1.2" }));
    expect(open).toHaveBeenCalledWith({ docId: "D", anchor: "§1.2", quote: "le menu" });
    fireEvent.click(screen.getByRole("button", { name: "D Figure 3" }));
    expect(open).toHaveBeenLastCalledWith({ docId: "D", anchor: "fig:3", quote: "" });
    rerender(<AnswerText text="Fini" onOpenSource={open} />);
    expect(container.querySelector(".caret")).toBeNull();
  });
});

describe("RevertConflict", () => {
  it("offers to revert anyway or keep the test", () => {
    const force = vi.fn();
    const keep = vi.fn();
    render(<RevertConflict detail="Step 2 was edited" onForce={force} onKeep={keep} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Step 2 was edited");
    fireEvent.click(screen.getByRole("button", { name: /Revert anyway/ }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(force).toHaveBeenCalled();
    expect(keep).toHaveBeenCalled();
  });
});
