// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setProject } from "../../../../src/ui/api.ts";
import { ProblemPanel, problemOf } from "../../../../src/ui/components/shell/ProblemPanel.tsx";
import { fakeEvents, fakeNet } from "../../helpers/ui-data.tsx";
import { noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

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

describe("ProblemPanel", () => {
  it("tells a Jira access problem from a Jira outage and a local failure", () => {
    expect(problemOf(new ApiError("Jira answered 401")).access).toBe(true);
    expect(problemOf(new ApiError("Xray timed out")).title).toBe("Jira did not answer");
    expect(problemOf(new Error("disk full")).title).toBe("This did not work");
    expect(problemOf(new ApiError("refused", "check your Jira token")).access).toBe(true);
  });

  it("points to Settings › Access for a refused token", () => {
    const retry = vi.fn();
    const { state } = withData(<ProblemPanel error={new ApiError("Jira 403")} doing="Pull" onRetry={retry} />);
    expect(screen.getByText(/create a new API token/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was written to Jira/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings › Access" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("points to the system check otherwise, with the core's own fix when there is one", () => {
    const { state } = withData(
      <>
        <ProblemPanel error={new ApiError("Jira unreachable")} doing="Push" untouched="Nothing changed." />
        <ProblemPanel error={new ApiError("No index", "run rag index")} doing="Search" />
        <ProblemPanel error="weird" doing="Thing" />
      </>,
    );
    expect(screen.getByText(/check your network or proxy/)).toBeInTheDocument();
    expect(screen.getByText("Nothing changed.")).toBeInTheDocument();
    expect(screen.getByText("run rag index")).toBeInTheDocument();
    expect(screen.getByText(/retry; if it fails again/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open the system check" })[0]);
    expect(state.navigate).toHaveBeenCalledWith("doctor");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
