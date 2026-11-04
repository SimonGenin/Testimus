// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { Rail } from "../../../../src/ui/components/shell/Rail.tsx";
import { ScreenHeader } from "../../../../src/ui/components/shell/ScreenHeader.tsx";
import { SystemStatus } from "../../../../src/ui/components/shell/SystemStatus.tsx";
import { ThemeToggle } from "../../../../src/ui/components/shell/ThemeToggle.tsx";
import { TopBar, TopBarContext, useTopBarSlots } from "../../../../src/ui/components/shell/TopBar.tsx";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { resetDoctor } from "../../../../src/ui/lib/doctor.ts";
import { setThemeEverywhere } from "../../../../src/ui/lib/theme.ts";
import { deferred, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";
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
  beforeEach(() => resetDoctor());

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
    const sys = await screen.findByRole("button", { name: "System: Needs you. Open the system check" });
    expect(sys).toHaveAttribute("aria-current", "page");
    fireEvent.click(sys);
    expect(state.navigate).toHaveBeenCalledWith("doctor", undefined);
    cleanup();
    withData(<Rail counts={{}} />, { route: { screen: "review" } });
    expect(screen.getByRole("button", { name: /Review/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Generate/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /Tests/ })).not.toHaveAttribute("aria-current");
  });

  it("shows Checking until the first answer, then the worst state", async () => {
    const gate = deferred();
    net.routes["system.doctor"] = async () => {
      await gate.promise;
      return [{ id: "a", label: "A", state: "warn", detail: "" }];
    };
    render(<SystemStatus onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /System: Checking/ })).not.toHaveAttribute("aria-current");
    await act(async () => gate.resolve(null));
    expect(await screen.findByRole("button", { name: /System: Check\./ })).toHaveTextContent("Check");
  });

  it("follows a theme set elsewhere", () => {
    render(<ThemeToggle />);
    act(() => setThemeEverywhere("dark"));
    expect(screen.getByRole("button", { name: "Theme: Dark. Switch to System" })).toBeInTheDocument();
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
