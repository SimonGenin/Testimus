// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { Rail } from "../../../../src/ui/components/shell/Rail.tsx";
import { ScreenHeader } from "../../../../src/ui/components/shell/ScreenHeader.tsx";
import { SystemStatus } from "../../../../src/ui/components/shell/SystemStatus.tsx";
import { TopBar, TopBarContext, useTopBarSlots } from "../../../../src/ui/components/shell/TopBar.tsx";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { deferred, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
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

const onPalette = vi.fn();

function Probe() {
  useRead("system.doctor", { claude: true });
  return null;
}

function Shell({ children }: { children?: ReactNode }) {
  const slots = useTopBarSlots();
  return (
    <TopBarContext.Provider value={slots.value}>
      <TopBar title="Jobs" onPalette={onPalette} slots={slots} />
      <main>{children}</main>
    </TopBarContext.Provider>
  );
}

describe("Rail, system status, theme and headers", () => {
  it("navigates from the rail and shows counts and the current screen", async () => {
    net.routes["system.doctor"] = () => [{ id: "node", label: "Node", state: "fail", detail: "" }];
    net.routes["project.list"] = () => [];
    const { state } = withData(<Rail counts={{ review: 3, jobs: 0 }} />, { route: { screen: "doctor" } });
    expect(screen.getByRole("button", { name: /Review/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Generate/ })).not.toHaveTextContent(/\d/);
    expect(screen.getByRole("button", { name: /Tests/ })).not.toHaveTextContent(/\d/);
    expect(screen.getByRole("button", { name: /Jobs/ })).not.toHaveTextContent(/\d/);
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenCalledWith("tests", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", undefined);
    const sys = await screen.findByRole("button", { name: "System: Failed. Open the system check" });
    expect(sys).toHaveAttribute("aria-current", "page");
    fireEvent.click(sys);
    expect(state.navigate).toHaveBeenCalledWith("doctor", undefined);
    cleanup();
    withData(<Rail counts={{}} />, { route: { screen: "review" } });
    expect(screen.getByRole("button", { name: /Review/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Generate/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /Tests/ })).not.toHaveAttribute("aria-current");
  });

  it("shows Not checked until the first answer, then the worst state", async () => {
    const gate = deferred();
    net.routes["system.doctor"] = async () => {
      await gate.promise;
      return [{ id: "a", label: "A", state: "warn", detail: "" }];
    };
    withData(<SystemStatus onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /System: Not checked/ })).not.toHaveAttribute("aria-current");
    await act(async () => gate.resolve(null));
    expect(await screen.findByRole("button", { name: /System: To do\./ })).toHaveTextContent("To do");
  });

  it("takes the Claude sign-in probe of the System check in place of its « not checked » row", async () => {
    net.routes["system.doctor"] = (i) =>
      i.claude
        ? [{ id: "claudeLogin", label: "Claude", state: "fail", detail: "signed out" }]
        : [
            { id: "node", label: "Node", state: "ok", detail: "" },
            { id: "claudeLogin", label: "Claude", state: "skip", detail: "" },
          ];
    withData(<SystemStatus onOpen={() => {}} />);
    expect(await screen.findByRole("button", { name: /System: All good/ })).toBeInTheDocument();
    cleanup();
    withData(
      <>
        <Probe />
        <SystemStatus onOpen={() => {}} />
      </>,
    );
    expect(await screen.findByRole("button", { name: /System: Failed/ })).toBeInTheDocument();
  });

  it("has no theme switch, and shows the version, the number alone, under the system's state", () => {
    net.routes["system.doctor"] = () => [];
    net.routes["project.list"] = () => [];
    withData(<Rail counts={{}} />);
    expect(screen.queryByRole("button", { name: /Theme/ })).toBeNull();
    const nav = screen.getByRole("navigation");
    expect(nav.lastElementChild?.textContent).toBe(__VERSION__);
    expect(nav.lastElementChild?.previousElementSibling).toHaveAccessibleName(/^System: /);
  });

  it("puts a screen's header in the top bar, and draws it in place outside the shell", () => {
    onPalette.mockClear();
    const { rerender } = withData(<Shell />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Jobs$/);
    fireEvent.click(screen.getByRole("button", { name: /^Search everything/ }));
    expect(onPalette).toHaveBeenCalled();
    rerender(
      <DataProvider>
        <Shell>
          <ScreenHeader title="System check" meta="2 running">
            <button type="button">Extra</button>
          </ScreenHeader>
        </Shell>
      </DataProvider>,
    );
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 1 })).toHaveTextContent("System check2 running");
    expect(within(bar).getByTitle("2 running")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Extra" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("button")).toBeNull();
    cleanup();
    render(
      <ScreenHeader title="Alone" meta="m">
        <button type="button">Here</button>
      </ScreenHeader>,
    );
    expect(screen.getAllByRole("heading", { name: /Alone/ })[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Here" })).toBeInTheDocument();
  });

  it("puts the screen's trail after its title, each crumb after a chevron and named in full (design-gaps point 25)", () => {
    withData(
      <Shell>
        <ScreenHeader title="Documents" crumbs={["SOSIE_211_D401-1_3 · Traction"]} meta="2 documents" />
      </Shell>,
    );
    const h1 = within(screen.getByRole("banner")).getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("DocumentsSOSIE_211_D401-1_3 · Traction2 documents");
    const crumb = within(h1).getByTitle("SOSIE_211_D401-1_3 · Traction");
    expect(crumb.querySelector("svg")).not.toBeNull();
  });

  it("a screen down a level puts its way back before the title, and a crumb that is a place goes there", () => {
    const up = vi.fn();
    const away = vi.fn();
    const { rerender } = withData(
      <Shell>
        <ScreenHeader
          title="Run"
          back={{ to: "the run", onClick: up }}
          crumbs={[{ label: "Recette J5", onClick: up }, "Test 2 of 3"]}
        />
      </Shell>,
    );
    const bar = screen.getByRole("banner");
    const h1 = within(bar).getByRole("heading", { level: 1 });
    const back = within(bar).getByRole("button", { name: "Back to the run" });
    expect(h1).not.toContainElement(back);
    expect(back.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back).not.toHaveTextContent("Back to the run");
    expect(h1).toHaveTextContent("RunRecette J5Test 2 of 3");
    fireEvent.click(back);
    fireEvent.click(within(h1).getByRole("button", { name: "Recette J5" }));
    expect(up).toHaveBeenCalledTimes(2);
    expect(within(h1).queryByRole("button", { name: "Test 2 of 3" })).toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("button")).toBeNull();
    rerender(
      <DataProvider>
        <Shell>
          <ScreenHeader title="Documents" back={{ to: "LFRPS12-1420", away: true, onClick: away }} />
        </Shell>
      </DataProvider>,
    );
    const leave = within(screen.getByRole("banner")).getByRole("button", { name: "Back to LFRPS12-1420" });
    expect(leave).toHaveTextContent("Back to LFRPS12-1420");
    fireEvent.click(leave);
    expect(away).toHaveBeenCalled();
    rerender(
      <DataProvider>
        <Shell>
          <ScreenHeader title="Documents" />
        </Shell>
      </DataProvider>,
    );
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: /^Back/ })).toBeNull();
  });
});

describe("Rail memory", () => {
  it("reopens what was open on a screen, and its own entry goes to its start", () => {
    net.routes["system.doctor"] = () => [];
    net.routes["project.list"] = () => [];
    const { state, rerenderWith } = withData(<Rail counts={{}} />, { route: { screen: "tests", arg: "T-7" } });
    rerenderWith({ route: { screen: "documents", arg: "SPEC" } });
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("tests", "T-7");
    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("documents", undefined);
    rerenderWith({ route: { screen: "tests" } });
    rerenderWith({ route: { screen: "documents" } });
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("tests", undefined);
  });
});
