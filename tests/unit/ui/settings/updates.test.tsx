// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice } from "../../../../src/ui/components/shell/UpdateNotice.tsx";
import { restartHint } from "../../../../src/ui/lib/updates.ts";
import { ChangelogSection, markOf } from "../../../../src/ui/screens/settings/ChangelogSection.tsx";
import { sourceLine, stateBadge, UpdatesSection } from "../../../../src/ui/screens/settings/UpdatesSection.tsx";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, Fail, fakeNet, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

type U = Parameters<typeof stateBadge>[0];

const latest = { version: "0.4.0", folder: "\\\\srv\\t\\0.4.0", notes: "Two panes.\nAnd more.", built: "" };
const state = (o: Partial<U> = {}): U => ({
  current: "0.3.0",
  installed: true,
  pending: "",
  source: "\\\\srv\\t",
  sourceFrom: "install",
  reachable: true,
  problem: "",
  latest,
  available: true,
  newer: [{ version: "0.4.0", items: ["Two panes.", "And more."] }],
  ...o,
});

let updates = state();
let settings: Record<string, unknown> = {};

beforeEach(() => {
  fakeNet();
  updates = state();
  settings = { claude: { exe: "" }, models: { allowRemote: true }, projects: [], lastProject: "" };
  net.routes["system.updates"] = () => updates;
  net.routes["system.settings"] = () => settings;
  net.routes["system.set"] = (i) => {
    settings = { ...settings, ...(i.updatesFrom ? { updates: { from: i.updatesFrom } } : { updates: undefined }) };
    return settings;
  };
  net.routes["system.update"] = () => ({ jobId: "update-1" });
});
afterEach(reset);

describe("updates: words", () => {
  it("the badge, the source line and the restart hint", () => {
    expect(stateBadge(state())).toEqual({ label: "0.4.0 available", tone: "info" });
    expect(stateBadge(state({ pending: "0.4.0", available: false }))).toMatchObject({ tone: "success" });
    expect(stateBadge(state({ available: false, latest: null, problem: "x", reachable: false }))).toEqual({
      label: "Folder not reachable",
      tone: "warning",
    });
    expect(stateBadge(state({ available: false, latest: null, problem: "x" })).label).toBe("No release found");
    expect(stateBadge(state({ available: false })).label).toBe("Up to date");
    expect(sourceLine(state())).toContain("the folder Testimus was installed from");
    expect(sourceLine(state({ sourceFrom: "settings" }))).toBe("Looking in \\\\srv\\t.");
    expect(sourceLine(state({ sourceFrom: "none" }))).toBe("No folder to look in yet.");
    expect(restartHint("0.4.0")).toContain("Close Testimus and start it again");
    fakeDesktop();
    expect(restartHint("0.4.0")).toBe("Restart Testimus to use 0.4.0.");
  });
});

describe("Settings › Updates", () => {
  it("links to what is new and starts the update as a job", async () => {
    const { app } = mountSettings(<UpdatesSection />, { info: null });
    expect(await screen.findByText("0.4.0 available")).toBeInTheDocument();
    expect(screen.queryByText(/Two panes\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What's new in 0.4.0" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "changelog");
    expect(screen.getByText(/Running 0\.3\.0/)).toBeInTheDocument();
    expect(screen.getByLabelText(label("Folder"))).toHaveAttribute(
      "placeholder",
      "\\\\srv\\t (where Testimus was installed from)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Update to 0.4.0" }));
    await waitFor(() => expect(inputs("system.update")).toEqual([{ version: "0.4.0" }]));
    expect(await screen.findByText("Installing Testimus 0.4.0")).toBeInTheDocument();
  });

  it("saves a folder typed by hand and reads the updates again; a refusal is told", async () => {
    updates = state({ available: false, sourceFrom: "none", source: "", latest: null, problem: "No update folder." });
    mountSettings(<UpdatesSection />, { info: null });
    const field = await screen.findByLabelText(label("Folder"));
    expect(await screen.findByText("No update folder.")).toBeInTheDocument();
    updates = state({ sourceFrom: "settings", source: "D:\\share" });
    fireEvent.change(field, { target: { value: "D:\\share" } });
    fireEvent.blur(field);
    await waitFor(() => expect(inputs("system.set")).toEqual([{ updatesFrom: "D:\\share" }]));
    expect(await screen.findByText("Looking in D:\\share.")).toBeInTheDocument();
    net.routes["system.update"] = () => {
      throw new Fail("An update is already being installed.");
    };
    fireEvent.click(screen.getByRole("button", { name: "Update to 0.4.0" }));
    expect(await screen.findByText("Could not start the update")).toBeInTheDocument();
  });

  it("a copy that is not installed cannot update; Check now asks again", async () => {
    updates = state({ installed: false });
    mountSettings(<UpdatesSection />, { info: null });
    expect(await screen.findByText(/not an installed copy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update to 0.4.0" })).toBeDisabled();
    const before = calls("system.updates").length;
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(calls("system.updates").length).toBe(before + 1));
  });

  it("desktop: Browse picks the folder; an installed update offers Restart", async () => {
    const d = fakeDesktop({ folder: "\\\\new\\share" });
    updates = state({ pending: "0.4.0", available: false });
    mountSettings(<UpdatesSection />, { info: null });
    expect(await screen.findByText("Restart Testimus to use 0.4.0.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(inputs("system.set")).toEqual([{ updatesFrom: "\\\\new\\share" }]));
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("Settings › Changelog", () => {
  const log = {
    current: "0.3.0",
    entries: [
      { version: "Unreleased", items: ["Work in progress."] },
      { version: "0.3.0", items: ["Run screen."] },
      { version: "0.2.0", items: [] },
    ],
  };

  it("lists the versions newest first: the one waiting in the folder with Update, then this copy's", async () => {
    net.routes["system.changelog"] = () => log;
    mountSettings(<ChangelogSection />, { info: null });
    expect(await screen.findByText("Two panes.")).toBeInTheDocument();
    const titles = screen.getAllByText(/^(0\.\d\.0|Unreleased)$/).map((e) => e.textContent);
    expect(titles).toEqual(["0.4.0", "Unreleased", "0.3.0", "0.2.0"]);
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText("Not published yet")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("No notes for this version.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update to 0.4.0" }));
    await waitFor(() => expect(inputs("system.update")).toEqual([{ version: "0.4.0" }]));
  });

  it("an installed version waits for a restart, with no Update", async () => {
    net.routes["system.changelog"] = () => log;
    updates = state({ pending: "0.4.0", available: false });
    mountSettings(<ChangelogSection />, { info: null });
    expect(await screen.findByText("Installed — restart")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Update to/ })).toBeNull();
  });

  it("marks only what it knows", () => {
    const none = new Set<string>();
    expect(markOf("0.1.0", "0.3.0", "", none)).toBeNull();
    expect(markOf("0.4.0", "0.3.0", "", new Set(["0.4.0"]))).toEqual({ label: "Not installed", tone: "info" });
  });
});

describe("the update notice", () => {
  it("says once that a version is available, with a link to the changelog instead of its notes", async () => {
    const { rerender, app } = mountSettings(<UpdateNotice booted />, { info: null });
    expect(await screen.findByText("Testimus 0.4.0 is available")).toBeInTheDocument();
    expect(screen.getByText("You have 0.3.0.")).toBeInTheDocument();
    expect(screen.queryByText(/Two panes/)).toBeNull();
    rerender(<UpdateNotice booted />);
    expect(screen.getAllByText("Testimus 0.4.0 is available")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "changelog");
    expect(inputs("system.update")).toEqual([]);
  });

  it("in a browser, an installed version links to the changelog", async () => {
    updates = state({ pending: "0.4.0", available: false });
    const { app } = mountSettings(<UpdateNotice booted />, { info: null });
    expect(await screen.findByText("Testimus 0.4.0 is installed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "changelog");
  });

  it("says an installed version waits for a restart, with Restart in the desktop app", async () => {
    const d = fakeDesktop();
    updates = state({ pending: "0.4.0", available: false });
    mountSettings(<UpdateNotice booted />, { info: null });
    expect(await screen.findByText("Testimus 0.4.0 is installed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when not installed, before the boot, or with a folder that cannot be read", async () => {
    updates = state({ installed: false });
    const { rerender } = mountSettings(<UpdateNotice booted={false} />, { info: null });
    expect(calls("system.updates")).toHaveLength(0);
    rerender(<UpdateNotice booted />);
    await waitFor(() => expect(calls("system.updates")).toHaveLength(1));
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it("reads the folder again when the window comes back after an hour", async () => {
    updates = state({ available: false });
    const { client } = mountSettings(<UpdateNotice booted />, { info: null });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(calls("system.updates")).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls("system.updates")).toHaveLength(1);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60 * 60_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(calls("system.updates")).toHaveLength(2));
  });
});
