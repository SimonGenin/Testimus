// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { resetDoctor } from "../../../../src/ui/lib/doctor.ts";
import { SettingsScreen } from "../../../../src/ui/screens/settings/SettingsScreen.tsx";
import { clearToasts, mount } from "../../cov-uiscreens-helpers.tsx";
import { fakeFetch, noDesktop } from "../../ui-desktop-helpers.tsx";

vi.mock("../../../../src/ui/screens/settings/ModelsSection.tsx", () => ({
  ModelsSection: () => <section>Models stub</section>,
}));

const scrolled: Element[] = [];
const real = Element.prototype.scrollIntoView;

beforeEach(() => {
  fakeFetch();
  resetDoctor();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = real;
});

describe("Settings › Claude anchors: #/settings/claude-dock, -quickasks, -contexts (audit M-C3)", () => {
  for (const [arg, card] of [
    ["claude-dock", "Claude dock"],
    ["claude-quickasks", "Quick asks"],
    ["claude-contexts", "Contexts"],
  ] as const)
    it(`#/settings/${arg} opens the Claude section and scrolls to the « ${card} » card`, () => {
      mount(<SettingsScreen />, { route: { screen: "settings", arg } });
      const nav = screen.getByRole("navigation", { name: "Settings sections" });
      expect(within(nav).getByRole("button", { name: "Claude" })).toHaveAttribute("aria-current", "true");
      const region = screen.getByRole("region", { name: card });
      expect(within(region).getByRole("heading", { name: card })).toBeInTheDocument();
      expect(scrolled).toEqual([region]);
    });

  it("#/settings/claude scrolls to the Connection to Claude card", () => {
    mount(<SettingsScreen />, { route: { screen: "settings", arg: "claude" } });
    expect(scrolled).toEqual([screen.getByRole("region", { name: "Connection to Claude" })]);
  });
});
