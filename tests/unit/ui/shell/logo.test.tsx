// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rail } from "../../../../src/ui/components/shell/Rail.tsx";
import { FirstRunScreen } from "../../../../src/ui/screens/setup/FirstRunScreen.tsx";
import { fakeEvents, fakeNet, net, withApp } from "../../cov-uishell-helpers.tsx";
import { withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the app logo (SPEC §13 « The app logo », audit M-J1)", () => {
  it("sits at the top of the main navigation, named Testimus", () => {
    withData(<Rail counts={{}} />, { route: { screen: "tests" } });
    const nav = screen.getByRole("navigation", { name: "Main" });
    const logo = within(nav).getByRole("img", { name: "Testimus" });
    expect(logo).toHaveAttribute("src", "/logo.png");
    for (const b of within(nav).getAllByRole("button"))
      expect(logo.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sits beside the name Testimus on the first-launch screen", () => {
    withApp(<FirstRunScreen />, { route: { screen: "setup" }, info: null });
    const brand = screen.getByText("Testimus");
    const logo = within(brand).getByRole("presentation");
    expect(logo).toHaveAttribute("src", "/logo.png");
  });
});
