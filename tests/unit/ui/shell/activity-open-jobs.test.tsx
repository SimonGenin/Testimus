// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity } from "../../../../src/ui/components/shell/Activity.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { fakeEvents, fakeNet, job, net } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("Activity › Open Jobs", () => {
  it("goes to the Jobs screen from the list of running jobs and closes the list", async () => {
    net.routes["jobs.list"] = () => [job({ id: "a", kind: "pull", subject: "LFRPS12" })];
    const { state } = withData(<Activity />);
    fireEvent.click(await screen.findByRole("button", { name: "1 job running" }));
    const pop = screen.getByRole("dialog", { name: /^Running 1/ });
    fireEvent.click(within(pop).getByRole("button", { name: "Open Jobs" }));
    expect(state.navigate).toHaveBeenCalledWith("jobs");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "1 job running" })).toBeInTheDocument();
  });
});
