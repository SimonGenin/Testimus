// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePref } from "../../../../src/ui/lib/prefs.ts";
import { AppearanceSection } from "../../../../src/ui/screens/settings/AppearanceSection.tsx";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, Fail, fakeNet, inputs, mountSettings, net, reset } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  net.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: false }, projects: [] });
  net.routes["system.set"] = (i) => ({ claude: { exe: "" }, models: { allowRemote: i.allowRemote ?? false } });
});

afterEach(() => {
  reset();
  delete document.documentElement.dataset.theme;
});

const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

describe("Settings › Appearance", () => {
  it("theme and step layout are this browser's; a theme chosen elsewhere (the rail) shows here", () => {
    mountSettings(<AppearanceSection />, { info: null });
    expect(radio("Theme", "System")).toBeChecked();
    fireEvent.click(radio("Theme", "Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(radio("Theme", "Dark")).toBeChecked();
    expect(localStorage.getItem("testimus.theme")).toBe("dark");
    fireEvent.click(radio("Step layout", "Action | Expected"));
    expect(localStorage.getItem("testimus.stepLayout")).toBe("split");
    expect(radio("Step layout", "Action | Expected")).toBeChecked();
    act(() => writePref("theme", "light"));
    expect(radio("Theme", "Light")).toBeChecked();
    expect(screen.getByText(/kept on this PC across restarts/)).toBeInTheDocument();
  });

  it("model downloads are this PC's setting, saved at once; a failed save is said and put back", async () => {
    mountSettings(<AppearanceSection />, { info: null });
    const sw = screen.getByRole("switch", { name: "Allow downloads from Hugging Face" });
    expect(sw).toBeDisabled();
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toBeChecked());
    expect(inputs("system.set")).toEqual([{ allowRemote: true }]);
    net.routes["system.set"] = () => {
      throw new Fail("Not writable.");
    };
    fireEvent.click(sw);
    expect(await screen.findByText("Could not save the settings")).toBeInTheDocument();
    expect(sw).toBeChecked();
    expect(calls("system.set")).toHaveLength(2);
  });

  it("always on top: hidden in the browser; on the desktop a switch that keeps the window on top, remembered", async () => {
    const r = mountSettings(<AppearanceSection />, { info: null });
    expect(screen.queryByRole("switch", { name: "Always on top" })).toBeNull();
    r.unmount();
    const d = fakeDesktop() as ReturnType<typeof fakeDesktop> & { setAlwaysOnTop?: (on: boolean) => Promise<boolean> };
    d.setAlwaysOnTop = vi.fn(async (on: boolean) => on);
    mountSettings(<AppearanceSection />, { info: null });
    expect(screen.getByText("Desktop app")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Always on top" });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toBeChecked());
    expect(d.setAlwaysOnTop).toHaveBeenCalledWith(true);
    fireEvent.click(sw);
    await waitFor(() => expect(sw).not.toBeChecked());
    expect(d.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });
});
