// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch } from "../../../../src/core/types.ts";
import { project } from "../../../../src/ui/api.ts";
import { App, parseRoute } from "../../../../src/ui/app/App.tsx";
import type { DockRequest } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app as appState } from "../../helpers/ui-desktop.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => {
  const { useApp } = await import("../../../../src/ui/lib/app.ts");
  return {
    TestsScreen: () => {
      const a = useApp();
      return (
        <section aria-label="Tests screen">
          <span>arg {a.route.arg ?? "-"}</span>
          <button type="button" onClick={a.closeProject}>
            close the project
          </button>
          <button type="button" onClick={a.refreshInfo}>
            read the project again
          </button>
        </section>
      );
    },
  };
});
vi.mock("../../../../src/ui/screens/documents/DocumentsScreen.tsx", async () => ({
  DocumentsScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Documents screen"),
}));
vi.mock("../../../../src/ui/screens/setup/FirstRunScreen.tsx", async () => ({
  FirstRunScreen: (await import("../../helpers/ui-data.tsx")).fakeScreen("Setup screen"),
}));
vi.mock("../../../../src/ui/components/claude/ClaudeDock.tsx", () => ({
  ClaudeDock: ({ request }: { request?: DockRequest | null }) => (
    <aside aria-label="Dock" data-request={JSON.stringify(request ?? null)} />
  ),
}));

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return null;
}

const hit = (h: Partial<SearchMatch>): SearchMatch => ({
  kind: "test",
  id: "T-1",
  title: "Sectionneur sans TK",
  titleMarks: [],
  marks: [],
  score: 1,
  why: "words",
  ...h,
});

let hits: SearchMatch[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  window.location.hash = "";
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true, writable: true });
  net.api = () => ({ project: "C:\\p", mock: false, commands: [] });
  net.routes["project.info"] = () => ({ ...appState().info, counts: { awaiting: 0 } });
  net.routes["system.credentials"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => [];
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
  net.routes["search.all"] = () => ({ hits, totals: {}, order: ["test", "document", "passage"] });
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});

const mount = async () => {
  render(
    <DataProvider>
      <App />
      <Probe />
    </DataProvider>,
  );
  await screen.findByRole("region", { name: "Tests screen" });
  await waitFor(() => expect(callsOf("project.info").length).toBeGreaterThan(0));
};

const pick = async (h: SearchMatch) => {
  hits = [h];
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.change(await screen.findByRole("combobox", { name: "Search" }), { target: { value: "sectionneur" } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(h.title) }, { timeout: 3000 }));
};

const route = () => parseRoute(window.location.hash);

describe("a search hit picked in the palette", () => {
  it("a test opens in Tests", async () => {
    await mount();
    await pick(hit({ step: 2 }));
    await waitFor(() => expect(route()).toEqual({ screen: "tests", arg: "T-1" }));
  });

  it("a document opens in Documents", async () => {
    await mount();
    await pick(hit({ kind: "document", id: "SOSIE_211", title: "Spécification SOSIE" }));
    await waitFor(() => expect(route()).toEqual({ screen: "documents", arg: "SOSIE_211" }));
  });

  it("a passage opens its document at its anchor", async () => {
    await mount();
    await pick(hit({ kind: "passage", id: "p1", title: "5.6 Sectionneurs", docId: "SOSIE_211", anchor: "§5.6" }));
    await waitFor(() => expect(route()).toEqual({ screen: "documents", arg: "SOSIE_211#§5.6" }));
  });
});

describe("a screen that changes the project", () => {
  it("closing the project forgets it, and the remembered project with it", async () => {
    localStorage.setItem("testimus.project", "C:\\p");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "close the project" }));
    await waitFor(() => expect(project()).toBeNull());
    expect(localStorage.getItem("testimus.project")).toBeNull();
  });

  it("asking for the project's info again reads it again", async () => {
    await mount();
    const n = callsOf("project.info").length;
    fireEvent.click(screen.getByRole("button", { name: "read the project again" }));
    await waitFor(() => expect(callsOf("project.info").length).toBeGreaterThan(n));
  });
});
