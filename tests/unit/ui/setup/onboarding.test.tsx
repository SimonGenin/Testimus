// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPref, writePref } from "../../../../src/ui/lib/prefs.ts";
import { adminRequest } from "../../../../src/ui/screens/settings/ConnectAtlassian.tsx";
import { ClaudeStep } from "../../../../src/ui/screens/setup/ClaudeStep.tsx";
import { stepOf } from "../../../../src/ui/screens/setup/FirstRunScreen.tsx";
import { PackStep } from "../../../../src/ui/screens/setup/PackStep.tsx";
import { ProjectStep } from "../../../../src/ui/screens/setup/ProjectStep.tsx";
import { ReadyStep } from "../../../../src/ui/screens/setup/ReadyStep.tsx";
import { WelcomeStep } from "../../../../src/ui/screens/setup/WelcomeStep.tsx";
import { choose } from "../../helpers/select.ts";
import { callsOf, fakeEvents, fakeNet, net, withApp } from "../../helpers/ui-data.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn(), jobToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

let settings: Record<string, unknown>;

beforeEach(() => {
  fakeNet();
  fakeEvents();
  settings = { projects: [], lastProject: "", claude: { exe: "" }, models: { allowRemote: true } };
  net.routes["system.settings"] = () => settings;
  net.routes["system.set"] = (i) => {
    const { skipJira, skipXray } = i as { skipJira?: boolean; skipXray?: boolean };
    settings = {
      ...settings,
      atlassian: {
        ...(settings.atlassian as object),
        ...(skipJira === undefined ? {} : { skipJira }),
        ...(skipXray === undefined ? {} : { skipXray }),
      },
    };
    return settings;
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("First launch › the step of a route", () => {
  it("an unknown or empty argument is the welcome", () => {
    expect(stepOf(undefined)).toBe("welcome");
    expect(stepOf("nope")).toBe("welcome");
    expect(stepOf("claude")).toBe("claude");
    expect(stepOf("access")).toBe("access");
    expect(stepOf("ready")).toBe("ready");
  });
});

describe("First launch › Welcome", () => {
  it("says how Testimus works, picks Jira by default and starts without saving anything", async () => {
    const onStart = vi.fn();
    withApp(<WelcomeStep onStart={onStart} />);
    expect(screen.getByRole("list", { name: "How it works" })).toHaveTextContent("Add documents");
    expect(screen.getByRole("list", { name: "How it works" })).toHaveTextContent("Push to Xray");
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    expect(screen.getByRole("radio", { name: /With Jira and Xray/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(false));
    expect(callsOf("system.set")).toHaveLength(0);
  });

  it("On this PC only leaves Jira out on this PC; a colleague's project goes to the project", async () => {
    const onStart = vi.fn();
    withApp(<WelcomeStep onStart={onStart} />);
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    fireEvent.click(screen.getByRole("radio", { name: /On this PC only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(false));
    expect(callsOf("system.set").map((c) => c.input)).toEqual([{ skipJira: true }]);
    fireEvent.click(screen.getByRole("radio", { name: /Join a colleague's project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onStart).toHaveBeenLastCalledWith(true));
    expect(callsOf("system.set")).toHaveLength(1);
  });

  it("a PC already without Jira starts on that choice, and Jira chosen again is saved", async () => {
    settings = { ...settings, atlassian: { skipJira: true } };
    withApp(<WelcomeStep onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /On this PC only/ })).toBeChecked());
    fireEvent.click(screen.getByRole("radio", { name: /With Jira and Xray/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(callsOf("system.set").map((c) => c.input)).toEqual([{ skipJira: false }]));
  });

  it("offers the theme, System by default", () => {
    withApp(<WelcomeStep onStart={vi.fn()} />);
    const theme = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(theme).getByRole("radio", { name: "System" })).toBeChecked();
    fireEvent.click(within(theme).getByRole("radio", { name: "Dark" }));
    expect(readPref("theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(within(theme).getByRole("radio", { name: "Dark" })).toBeChecked();
    fireEvent.click(within(theme).getByRole("radio", { name: "System" }));
    expect(readPref("theme")).toBe("system");
  });

  it("keeps a theme chosen before", () => {
    writePref("theme", "light");
    withApp(<WelcomeStep onStart={vi.fn()} />);
    expect(
      within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name: "Light" }),
    ).toBeChecked();
  });
});

describe("First launch › Claude", () => {
  const claude = (signedIn: boolean | "missing") => {
    net.routes["claude.status"] = (i) =>
      signedIn === "missing"
        ? { installed: false, signedIn: false, detail: "claude: not found" }
        : i.signIn
          ? {
              installed: true,
              version: "2.1.0",
              signedIn,
              detail: signedIn ? "ok" : "Invalid API key · Please run /login",
            }
          : { installed: true, version: "2.1.0", signedIn: null, detail: "2.1.0 (Claude Code)" };
  };

  it("proves the sign-in once on arrival, then Continue", async () => {
    claude(true);
    const onContinue = vi.fn();
    withApp(<ClaudeStep onBack={vi.fn()} onContinue={onContinue} />);
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText("Claude Code is installed")).toBeInTheDocument();
    expect(screen.getByText("2.1.0")).toBeInTheDocument();
    expect(callsOf("claude.status").map((c) => c.input)).toEqual([{}, { signIn: true }]);
    expect(screen.queryByRole("button", { name: "Continue without Claude" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/primary/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("signed out: how to sign in, check again, or continue without Claude", async () => {
    claude(false);
    const onContinue = vi.fn();
    withApp(<ClaudeStep onBack={vi.fn()} onContinue={onContinue} />);
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("Claude is installed but not signed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAccessibleDescription(
      "Claude is not signed in yet — or continue without it",
    );
    claude(true);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(callsOf("claude.status").map((c) => c.input)).toContainEqual({ refresh: true });
    expect(callsOf("claude.status").filter((c) => c.input.signIn)).toHaveLength(2);
    expect(screen.queryByText("Claude is installed but not signed in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("not installed: how to install it, no sign-in run, and the way on without it", async () => {
    claude("missing");
    const onContinue = vi.fn();
    const onBack = vi.fn();
    withApp(<ClaudeStep onBack={onBack} onContinue={onContinue} />);
    expect(await screen.findByText("Claude Code is not installed")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    expect(callsOf("claude.status").filter((c) => c.input.signIn)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Continue without Claude" }));
    expect(onContinue).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("a sign-in check that fails is shown as signed out", async () => {
    net.routes["claude.status"] = (i) => {
      if (i.signIn) throw new Error("claude -p timed out");
      return { installed: true, version: "2.1.0", signedIn: null };
    };
    withApp(<ClaudeStep onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
  });
});

describe("First launch › Project with Jira", () => {
  beforeEach(() => {
    net.routes["project.list"] = () => ({ projects: [], root: "D:\\Testimus\\Projects", last: "" });
  });

  const jiraAccess = () => {
    net.routes["system.credentials"] = () => ({
      status: {
        jira: { file: "f", exists: true, complete: true, baseUrl: "https://acme.atlassian.net", email: "me@a" },
        xray: { file: "x", exists: true, complete: true },
      },
    });
  };

  it("picks the Jira project from Jira's own list; its name becomes the project's", async () => {
    jiraAccess();
    net.routes["xray.projects"] = () => [
      { key: "BHPTCC", name: "BHP TCC" },
      { key: "LFRPS12", name: "RATP Sosie" },
    ];
    net.routes["project.init"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<ProjectStep onBack={vi.fn()} />, { info: null });
    const pick = await screen.findByRole("combobox", { name: "Jira project" });
    expect(screen.queryByLabelText("Jira project key")).toBeNull();
    choose(pick, "LFRPS12 — RATP Sosie");
    expect(screen.getByLabelText("Name")).toHaveValue("RATP Sosie");
    choose(screen.getByRole("combobox", { name: "Jira project" }), "BHPTCC — BHP TCC");
    expect(screen.getByLabelText("Name")).toHaveValue("BHP TCC");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mine" } });
    choose(screen.getByRole("combobox", { name: "Jira project" }), "LFRPS12 — RATP Sosie");
    expect(screen.getByLabelText("Name")).toHaveValue("Mine");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create the project" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create the project" }));
    await waitFor(() =>
      expect(callsOf("project.init")[0]?.input).toEqual({
        dir: "D:\\Testimus\\Projects\\Mine",
        jiraProject: "LFRPS12",
        name: "Mine",
        language: "fr",
      }),
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
  });

  it("No Jira project is a choice of its own", async () => {
    jiraAccess();
    net.routes["xray.projects"] = () => [{ key: "LFRPS12", name: "RATP Sosie" }];
    withApp(<ProjectStep onBack={vi.fn()} />, { info: null });
    choose(await screen.findByRole("combobox", { name: "Jira project" }), "LFRPS12 — RATP Sosie");
    choose(screen.getByRole("combobox", { name: "Jira project" }), "No Jira project");
    expect(screen.getByRole("combobox", { name: "Jira project" })).toHaveTextContent("No Jira project");
  });

  it("Jira left out on this PC: no Jira field, and Jira is never asked", async () => {
    settings = { ...settings, atlassian: { skipJira: true } };
    jiraAccess();
    withApp(<ProjectStep onBack={vi.fn()} />, { info: null });
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("combobox", { name: "Jira project" })).toBeNull();
    expect(screen.queryByLabelText("Jira project key")).toBeNull();
    expect(callsOf("xray.projects")).toHaveLength(0);
  });

  it("without a list from Jira, the key is typed", async () => {
    jiraAccess();
    net.routes["xray.projects"] = () => {
      throw new Error("Jira 503");
    };
    withApp(<ProjectStep onBack={vi.fn()} />, { info: null });
    expect(await screen.findByLabelText("Jira project key")).toBeInTheDocument();
  });
});

describe("First launch › Search, keeping the pack in use", () => {
  it("names the pack in use on the way out", async () => {
    net.routes["models.packs"] = () => [
      {
        id: "light",
        label: "Light",
        intent: "Small",
        active: true,
        chosen: true,
        available: true,
        variant: 0,
        embedding: "e1",
        reranker: null,
        models: [{ id: "e1", label: "Embed One", kind: "embedding", installed: true }],
        device: "cpu",
        installed: "all",
        notes: [],
        downloadMB: 0,
        quality: "",
      },
    ];
    net.routes["models.catalog"] = () => [];
    net.routes["models.hardware"] = () => ({ ramTotalMB: 8192, ramFreeMB: 4096, cpu: {}, gpus: [], drives: [] });
    const onDone = vi.fn();
    withApp(<PackStep onBack={vi.fn()} onDone={onDone} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep Light for now" }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("First launch › Ready", () => {
  it("sums up what is set and what was left out, then the first document", async () => {
    settings = { ...settings, atlassian: { skipXray: true } };
    net.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null });
    net.routes["system.credentials"] = () => ({
      status: {
        jira: { file: "f", exists: true, complete: true },
        xray: { file: "x", exists: false, complete: false },
      },
    });
    net.routes["models.packs"] = () => [{ id: "light", label: "Light", active: true }];
    const { state } = withApp(<ReadyStep />);
    expect(screen.getByRole("heading", { level: 1, name: "RATP Sosie is ready" })).toBeInTheDocument();
    const sum = screen.getByRole("list", { name: "Setup summary" });
    await waitFor(() => expect(sum).toHaveTextContent("Claude Code 2.1.0"));
    await waitFor(() => expect(sum).toHaveTextContent("No key yet: tests are read, not pushed"));
    expect(sum).toHaveTextContent("LFRPS12 · its tests in Tests › Jira");
    await waitFor(() => expect(sum).toHaveTextContent("Light, on this PC"));
    expect(within(sum).getAllByText("Ready")).toHaveLength(3);
    expect(within(sum).getByText("Not used")).toBeInTheDocument();
    fireEvent.click(within(sum).getByRole("button", { name: "Add the key" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    expect(state.navigate).toHaveBeenCalledWith("documents");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    expect(state.navigate).toHaveBeenLastCalledWith("documents");
  });

  it("Claude left for later and Jira left out, without a project", async () => {
    settings = { ...settings, atlassian: { skipJira: true } };
    net.routes["claude.status"] = () => ({ installed: false, signedIn: false });
    net.routes["system.credentials"] = () => ({
      status: {
        jira: { file: "f", exists: false, complete: false },
        xray: { file: "x", exists: false, complete: false },
      },
    });
    const { state } = withApp(<ReadyStep />, { info: null });
    const sum = screen.getByRole("list", { name: "Setup summary" });
    await waitFor(() => expect(sum).toHaveTextContent("Not installed: writing and checking wait for it"));
    await waitFor(() => expect(sum).toHaveTextContent("Left out: tests stay on this PC"));
    expect(within(sum).getAllByText("Not used")).toHaveLength(2);
    expect(within(sum).getByText("Later")).toBeInTheDocument();
    expect(screen.queryByText("Next: your first specification")).toBeNull();
    fireEvent.click(within(sum).getByRole("button", { name: "Set it up" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "claude");
    fireEvent.click(within(sum).getByRole("button", { name: "Connect" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
  });
});

describe("Xray admin request", () => {
  it("names the user and the site when known", () => {
    expect(adminRequest("me@a.com", "https://a.atlassian.net")).toContain(
      "for my Jira user (me@a.com) on https://a.atlassian.net?",
    );
    expect(adminRequest("", "")).toContain("for my Jira user?");
  });
});
