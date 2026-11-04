// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { JobLog } from "../../../../src/ui/components/shell/JobLog.tsx";
import { fakeEvents, fakeNet } from "../../helpers/ui-data.tsx";
import { noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearAllToasts } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  document.title = "";
});

const at = (s: number) => `2026-11-02T10:00:${String(s).padStart(2, "0")}.000Z`;

describe("JobLog", () => {
  it("shows an empty log, colours warnings and errors, and sticks to the bottom until scrolled up", () => {
    const { rerender } = render(<JobLog events={[]} />);
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Live log" });
    Object.defineProperty(log, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 100, configurable: true });
    const events: JobEvent[] = [
      { jobId: "j1", at: at(1), type: "log", level: "warn", message: "slow" },
      { jobId: "j1", at: at(2), type: "log", level: "error", message: "broken" },
    ];
    rerender(<JobLog events={events} label="Import log" />);
    expect(screen.getByText("slow").parentElement ?? screen.getByText("slow")).toBeInTheDocument();
    expect(document.querySelector("[data-level=warn]")).toHaveTextContent("slow");
    expect(document.querySelector("[data-level=error]")).toHaveTextContent("broken");
    expect(log.scrollTop).toBe(500);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    rerender(<JobLog events={[...events, { jobId: "j1", at: at(3), type: "log", level: "info", message: "more" }]} />);
    expect(log.scrollTop).toBe(0);
  });
});
