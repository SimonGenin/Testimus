// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { App } from "../../../../src/ui/app/App.tsx";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { callsOf, fakeEvents, fakeNet, job, net } from "../../helpers/ui-data.tsx";
import { app as appState } from "../../helpers/ui-desktop.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => ({
  TestsScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Tests screen"),
}));
vi.mock("../../../../src/ui/screens/documents/DocumentsScreen.tsx", async () => ({
  DocumentsScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Documents screen"),
}));
vi.mock("../../../../src/ui/screens/generate/GenerateScreen.tsx", async () => ({
  GenerateScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Generate screen"),
}));
vi.mock("../../../../src/ui/screens/review/ReviewScreen.tsx", async () => ({
  ReviewScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Review screen"),
}));
vi.mock("../../../../src/ui/screens/jobs/JobsScreen.tsx", async () => ({
  JobsScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Jobs screen"),
}));
vi.mock("../../../../src/ui/screens/doctor/DoctorScreen.tsx", async () => ({
  DoctorScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Doctor screen"),
}));
vi.mock("../../../../src/ui/screens/settings/SettingsScreen.tsx", async () => ({
  SettingsScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Settings screen"),
}));
vi.mock("../../../../src/ui/components/claude/ClaudeDock.tsx", () => ({
  ClaudeDock: () => <aside aria-label="Dock" />,
}));

beforeEach(() => {
  fakeNet();
  fakeEvents();
  window.location.hash = "";
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true, writable: true });
  net.api = () => ({ project: "C:\\p", mock: true, commands: [] });
  net.routes["project.info"] = () => appState().info;
  net.routes["system.credentials"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => [job({ id: "a", kind: "pull", subject: "LFRPS12-9", message: "Reading" })];
  net.routes["jobs.cancel"] = () => ({ cancelled: true });
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});

const SCREENS: [string, string][] = [
  ["", "Tests screen"],
  ["#/documents", "Documents screen"],
  ["#/generate", "Generate screen"],
  ["#/review", "Review screen"],
  ["#/jobs", "Jobs screen"],
  ["#/doctor", "Doctor screen"],
  ["#/settings", "Settings screen"],
];

describe("the activity indicator (PARITY #63)", () => {
  it("shows the running jobs in the top bar of every screen, with the list and Cancel", async () => {
    render(
      <DataProvider>
        <App />
      </DataProvider>,
    );
    for (const [hash, name] of SCREENS) {
      act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(await screen.findByRole("region", { name })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "1 job running" })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "1 job running" }));
    const list = screen.getByRole("dialog", { name: /^Running \d/ });
    fireEvent.click(within(list).getByRole("button", { name: "Cancel LFRPS12-9" }));
    await waitFor(() => expect(callsOf("jobs.cancel")[0].input).toEqual({ id: "a" }));
  });
});
