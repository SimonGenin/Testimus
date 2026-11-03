// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { resetDoctor, runDoctor } from "../../src/ui/lib/doctor.ts";
import { AccessSection, fileState } from "../../src/ui/screens/settings/AccessSection.tsx";
import { AppearanceSection } from "../../src/ui/screens/settings/AppearanceSection.tsx";
import { ClaudeSection, exeLine } from "../../src/ui/screens/settings/ClaudeSection.tsx";
import { ColumnsSection } from "../../src/ui/screens/settings/ColumnsSection.tsx";
import {
  ConnectAtlassian,
  jiraWords,
  savedAs,
  siteRoot,
  xrayWords,
} from "../../src/ui/screens/settings/ConnectAtlassian.tsx";
import { ProjectSection } from "../../src/ui/screens/settings/ProjectSection.tsx";
import { SettingsScreen } from "../../src/ui/screens/settings/SettingsScreen.tsx";
import { AccessStep } from "../../src/ui/screens/setup/AccessStep.tsx";
import { clearToasts, failing, models, modelsFetch, mount, modelsNamed as named } from "./cov-uiscreens-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/settings/ModelsSection.tsx", () => ({
  ModelsSection: () => <section id="settings-models">Models stub</section>,
}));

vi.mock("../../src/ui/components/claude/ContextsDialog.tsx", () => ({
  CONTEXTS_EVENT: "testimus:contexts",
  ContextsDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Contexts stub">
      <button type="button" onClick={onClose}>
        Close contexts
      </button>
    </div>
  ),
}));

beforeEach(() => {
  modelsFetch();
  resetDoctor();
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const info = (project: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const a = app();
  return { ...a.info, ...extra, project: { ...a.info?.project, ...project } } as NonNullable<
    ReturnType<typeof app>["info"]
  >;
};

const check = (id: string, state: DoctorCheck["state"], detail = "", fix?: string) =>
  ({ id, label: id, state, detail, fix }) as DoctorCheck;

const creds = (jira: Record<string, unknown> = {}, xray: Record<string, unknown> = {}) => ({
  jira: { file: "C:\\Users\\me\\.atlassian\\jira.json", exists: true, complete: true, ...jira },
  xray: { file: "C:\\Users\\me\\.atlassian\\xray.json", exists: true, complete: true, ...xray },
});

describe("ConnectAtlassian helpers", () => {
  it("siteRoot reads what people paste", () => {
    expect(siteRoot("  ")).toBe("");
    expect(siteRoot("transurb")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("transurb.atlassian.net/browse/LFRPS12-1")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("HTTP://x.atlassian.net/wiki/spaces/A")).toBe("https://x.atlassian.net/wiki");
    expect(siteRoot("https://x.atlassian.net/wikis")).toBe("https://x.atlassian.net");
    expect(siteRoot("http://[bad")).toBe("http://[bad");
  });

  it("savedAs keeps the saved form, else the root as typed (as Xray Editor)", () => {
    expect(savedAs("")).toBe("");
    expect(savedAs("https://x.atlassian.net", " https://x.atlassian.net/wiki/ ")).toBe("https://x.atlassian.net/wiki/");
    expect(savedAs("https://x.atlassian.net", "https://y.atlassian.net/wiki")).toBe("https://x.atlassian.net");
    expect(savedAs("https://jira.acme.com")).toBe("https://jira.acme.com");
  });

  it("jiraWords and xrayWords say what to do", () => {
    expect(jiraWords(undefined).text).toMatch(/Fill in the site/);
    expect(jiraWords(check("jira", "fail", "Missing token")).ok).toBe(false);
    expect(jiraWords(check("jira", "ok", "me@acme on https://x"))).toEqual({ ok: true, text: "Connected as me@acme" });
    expect(jiraWords(check("jira", "fail", "Jira 401")).text).toMatch(/refused this email/);
    expect(jiraWords(check("jira", "fail", "Jira 404 at x")).text).toMatch(/No Jira Cloud site/);
    expect(jiraWords(check("jira", "fail", "odd")).text).toBe("odd");
    expect(xrayWords(undefined).text).toMatch(/Client ID/);
    expect(xrayWords(check("xray", "ok"))).toEqual({ ok: true, text: "Key accepted" });
    expect(xrayWords(check("xray", "fail", "authentication failed (401)")).text).toMatch(/refused this Client ID/);
    expect(xrayWords(check("xray", "fail", "Xray unreachable")).text).toMatch(/did not answer/);
    expect(xrayWords(check("xray", "fail", "weird")).text).toBe("weird");
  });
});

describe("ConnectAtlassian", () => {
  it("fills the found access, shows how it is saved, and saves only what changed", async () => {
    let n = 0;
    models.routes["system.setup"] = () =>
      n++ === 0
        ? { status: creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme" }) }
        : {
            status: creds({ baseUrl: "https://beta.atlassian.net/wiki" }),
            saved: ["jira"],
            ok: true,
            checks: [check("jira", "ok", "me@beta on https://beta"), check("xray", "fail", "Xray 403")],
          };
    models.routes["system.doctor"] = () => ({ checks: [] });
    const onStatus = vi.fn();
    const onResult = vi.fn();
    const { container } = mount(<ConnectAtlassian lead="Lead text" onStatus={onStatus} onResult={onResult} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    const site = await screen.findByLabelText("Jira site");
    expect(site).toHaveValue("https://acme.atlassian.net/wiki");
    expect(screen.getByText("Lead text")).toBeInTheDocument();
    expect(onStatus).toHaveBeenCalled();
    expect(screen.getByText(/The address in your browser/)).toBeInTheDocument();
    fireEvent.change(site, { target: { value: "beta" } });
    expect(screen.getByText("https://beta.atlassian.net")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " me@beta " } });
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: " tok " } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: " cid " } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: " sec " } });
    expect(screen.getByLabelText("API token")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show secrets" }));
    expect(screen.getByLabelText("API token")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide secrets" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    expect(await screen.findByText("Connected as me@beta")).toBeInTheDocument();
    expect(screen.getByText(/Xray refused this Client ID/)).toBeInTheDocument();
    expect(named("system.setup")[1].input).toEqual({
      check: true,
      site: "https://beta.atlassian.net",
      email: "me@beta",
      token: "tok",
      clientId: "cid",
      clientSecret: "sec",
    });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    await waitFor(() => expect(named("system.doctor")).toHaveLength(1));
    expect(screen.getByLabelText("API token")).toHaveValue(" tok ");
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "x" } });
    expect(screen.queryByText("Connected as me@beta")).toBeNull();
  });

  it("an unchanged form sends the check only; Enter submits; nothing saved, no doctor", async () => {
    let n = 0;
    models.routes["system.setup"] = () =>
      n++ === 0
        ? { status: creds({ complete: false }, { exists: false, complete: false }) }
        : { status: creds(), saved: [], ok: false, checks: [] };
    const { container } = mount(<ConnectAtlassian />);
    await screen.findByLabelText("Jira site");
    expect(screen.getByLabelText("API token")).toHaveAttribute("placeholder", "");
    expect(screen.getByLabelText("Client ID")).toHaveAttribute("placeholder", "");
    expect(screen.queryByRole("button", { name: "Open Jira apps" })).toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText(/Fill in the site, the email/)).toBeInTheDocument();
    expect(named("system.setup")[1].input).toEqual({ check: true });
    expect(named("system.doctor")).toHaveLength(0);
  });

  it("opens the token and app pages in a browser tab, or through the desktop", async () => {
    models.routes["system.setup"] = () => ({ status: creds({ baseUrl: "https://acme.atlassian.net/wiki" }) });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mount(<ConnectAtlassian />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(open).toHaveBeenCalledWith(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Jira apps" }));
    expect(open).toHaveBeenLastCalledWith(
      "https://acme.atlassian.net/plugins/servlet/upm",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.getByText("C:\\Users\\me\\.atlassian")).toBeInTheDocument();
    cleanup();
    const d = fakeDesktop();
    mount(<ConnectAtlassian />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Saved in/ }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\Users\\me\\.atlassian"));
  });

  it("shows why the access cannot be read and why a save failed", async () => {
    mount(<ConnectAtlassian />);
    expect(await screen.findByText("Unknown command system.setup")).toBeInTheDocument();
    expect(screen.getByText("~/.atlassian")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and test the connection" })).toBeDisabled();
    cleanup();
    let n = 0;
    models.routes["system.setup"] = () => (n++ === 0 ? { status: creds() } : failing("disk locked"));
    mount(<ConnectAtlassian />);
    fireEvent.click(await screen.findByRole("button", { name: "Save and test the connection" }));
    expect(await screen.findByText("disk locked")).toBeInTheDocument();
  });

  it("shows Testing… while it runs", async () => {
    models.routes["system.setup"] = () => ({ status: creds(), saved: [], ok: true, checks: [] });
    mount(<ConnectAtlassian />);
    const save = await screen.findByRole("button", { name: "Save and test the connection" });
    let release = () => {};
    models.gate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(save);
    expect(await screen.findByRole("button", { name: "Testing…" })).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: "Save and test the connection" })).toBeEnabled();
  });
});

describe("Settings › Access and First launch › Access", () => {
  it("fileState reads the shared files", () => {
    expect(fileState({ file: "f", exists: false, complete: false })).toBe("missing");
    expect(fileState({ file: "f", exists: true, complete: true, invalid: true })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: false })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: true })).toBe("found");
  });

  it("lists each file with its state and the doctor's verdict", async () => {
    models.routes["system.doctor"] = () => ({
      checks: [check("jira", "fail", "Jira 401 Unauthorized — token rejected", "New token"), check("xray", "ok")],
    });
    await runDoctor();
    models.routes["system.setup"] = () => ({ status: creds() });
    mount(<AccessSection />);
    expect(await screen.findAllByText("found · valid")).toHaveLength(2);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Jira 401 Unauthorized/).closest("[title]")).toHaveAttribute("title", "New token");
    cleanup();
    models.routes["system.doctor"] = () => ({ checks: [check("jira", "skip")] });
    await runDoctor();
    models.routes["system.setup"] = () => ({
      status: creds({ exists: false }, { invalid: true, problem: "not valid JSON" }),
    });
    mount(<AccessSection />);
    expect(await screen.findByText("missing")).toBeInTheDocument();
    expect(screen.getByText("invalid — not valid JSON")).toBeInTheDocument();
    cleanup();
    models.routes["system.setup"] = () => ({ status: creds({}, { complete: false }) });
    mount(<AccessSection />);
    expect(await screen.findByText("invalid")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("first launch: the found banner, Continue and Skip, and the banner gone once all is ok", async () => {
    let n = 0;
    models.routes["system.setup"] = () =>
      n++ === 0 ? { status: creds() } : { status: creds(), saved: [], ok: true, checks: [] };
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    mount(<AccessStep onContinue={onContinue} onSkip={onSkip} />);
    expect(await screen.findByText(/We found the access you already use/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass("btn-primary");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onContinue).toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(screen.queryByText(/We found the access/)).toBeNull());
  });

  it("first launch without access: no banner, a secondary Continue", async () => {
    models.routes["system.setup"] = () => ({ status: creds({ complete: false }) });
    mount(<AccessStep onContinue={vi.fn()} onSkip={vi.fn()} />);
    await screen.findByLabelText("Jira site");
    expect(screen.queryByText(/We found the access/)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).not.toHaveClass("btn-primary");
  });
});

describe("Settings › Smart columns › plain text", () => {
  const col = (name: string, builtin = false) => ({ name, origin: "xray", builtin, status: "ok", description: "" });

  it("a column is a name and what Claude writes in it — no kind of content, no pattern", () => {
    mount(<ColumnsSection />, { info: info({}, { columns: [col("Action", true), col("Exigence")] }) });
    const rows = within(screen.getByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByLabelText("What Claude writes in Exigence")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Exigence: kind of content" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Coverage" })).toBeNull();
  });
});

describe("Settings › Appearance", () => {
  it("theme, layout and downloads are saved; a failed save is reported", async () => {
    models.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: false } });
    models.routes["system.saveSettings"] = (i) => ({
      claude: { exe: "" },
      models: { allowRemote: i.allowRemote ?? false },
    });
    mount(<AppearanceSection />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    fireEvent.click(within(screen.getByRole("group", { name: "Theme" })).getByRole("button", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Step layout" })).getByRole("button", { name: "Side by side" }),
    );
    expect(localStorage.getItem("testimus.stepLayout")).toBe("split");
    await waitFor(() => expect(named("system.saveSettings")).toHaveLength(3));
    act(() => {
      window.dispatchEvent(new CustomEvent("testimus:theme", { detail: "light" }));
    });
    expect(within(screen.getByRole("group", { name: "Theme" })).getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    delete models.routes["system.saveSettings"];
    fireEvent.click(box);
    expect(await screen.findByText("Could not save the settings")).toBeInTheDocument();
    expect(box).toBeChecked();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("the window switch on the desktop keeps the window on top", async () => {
    const d = fakeDesktop() as ReturnType<typeof fakeDesktop> & { setAlwaysOnTop?: (on: boolean) => Promise<boolean> };
    d.setAlwaysOnTop = vi.fn(async () => true);
    mount(<AppearanceSection />);
    const sw = screen.getByRole("switch", { name: /Always on top/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(d.setAlwaysOnTop).toHaveBeenCalledWith(true);
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
  });
});

describe("Settings › Claude", () => {
  const claude = (c: Record<string, unknown> = {}) =>
    info({ claude: { model: "sonnet", effort: "medium", presets: [], contexts: [], ...c } });

  it("exeLine says found or not found", () => {
    expect(exeLine({ installed: true, version: "2.1.0", signedIn: true })).toBe("✓ 2.1.0 · found");
    expect(exeLine({ installed: true, signedIn: true })).toBe("✓ Claude Code · found");
    expect(exeLine({ installed: false, signedIn: false, detail: "spawn ENOENT\nmore" })).toBe(
      "✕ spawn ENOENT · not found · Claude is optional",
    );
    expect(exeLine({ installed: false, signedIn: false })).toMatch(/claude did not answer/);
  });

  it("without a project: the Claude program only, checked on Enter; a failed check shows how to connect", async () => {
    models.routes["system.settings"] = () => ({ claude: { exe: "C:/c.exe" }, models: { allowRemote: true } });
    models.routes["system.saveSettings"] = (i) => ({ claude: { exe: i.claudeExe }, models: { allowRemote: true } });
    models.routes["claude.status"] = (i) =>
      i.refresh ? failing("spawn failed") : { installed: true, version: "2.0", signedIn: true };
    const { app: a } = mount(<ClaudeSection />, { info: null });
    expect(screen.queryByLabelText("Default model")).toBeNull();
    expect(await screen.findByText("✓ 2.0 · found")).toBeInTheDocument();
    const exe = screen.getByLabelText("Claude program");
    await waitFor(() => expect(exe).toHaveValue("C:/c.exe"));
    fireEvent.blur(exe);
    expect(named("system.saveSettings")).toHaveLength(0);
    fireEvent.change(exe, { target: { value: "D:/claude.cmd" } });
    fireEvent.keyDown(exe, { key: "a" });
    fireEvent.keyDown(exe, { key: "Enter" });
    expect(await screen.findByText(/spawn failed · not found/)).toBeInTheDocument();
    expect(named("system.saveSettings")[0].input).toEqual({ claudeExe: "D:/claude.cmd" });
    fireEvent.click(screen.getByRole("button", { name: "Open system check" }));
    expect(a.navigate).toHaveBeenCalledWith("doctor");
    models.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("✓ Claude Code · found")).toBeInTheDocument();
  });

  it("a check whose save fails clears the status; Check shows Checking… meanwhile", async () => {
    models.routes["system.settings"] = () => ({ claude: { exe: "X:/old.exe" }, models: { allowRemote: true } });
    mount(<ClaudeSection />, { info: null });
    const exe = screen.getByLabelText("Claude program");
    await waitFor(() => expect(exe).toHaveValue("X:/old.exe"));
    fireEvent.change(exe, { target: { value: "X:/c.exe" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Could not save the settings")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(exe, { target: { value: "" } });
    let release = () => {};
    models.gate = new Promise<void>((r) => {
      release = r;
    });
    models.routes["system.saveSettings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    models.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByText("Running claude --version…")).toBeInTheDocument();
    release();
    models.gate = null;
    expect(await screen.findByText("✓ Claude Code · found")).toBeInTheDocument();
  });

  it("Browse… on the desktop picks the program and checks it; a cancel does nothing", async () => {
    const d = fakeDesktop({ files: [] });
    models.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    mount(<ClaudeSection />, { info: null });
    const browse = screen.getByRole("button", { name: "Browse for the Claude program" });
    await waitFor(() => expect(browse).toBeEnabled());
    expect(screen.getByLabelText("Claude program")).toHaveValue("");
    fireEvent.click(browse);
    await waitFor(() => expect(d.pickFiles).toHaveBeenCalledTimes(1));
    expect(named("system.saveSettings")).toHaveLength(0);
    d.pickFiles.mockResolvedValue(["E:/claude.exe"]);
    models.routes["system.saveSettings"] = () => ({ claude: { exe: "E:/claude.exe" }, models: { allowRemote: true } });
    models.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    fireEvent.click(browse);
    await waitFor(() => expect(named("system.saveSettings")[0]?.input).toEqual({ claudeExe: "E:/claude.exe" }));
    expect(screen.getByLabelText("Claude program")).toHaveValue("E:/claude.exe");
  });

  it("model, effort and quick asks: edit, blur, remove, add", async () => {
    models.routes["project.set"] = () => ({});
    models.routes["contexts.list"] = () => null;
    mount(<ClaudeSection />, { info: claude({ presets: [{ label: "Check", prompt: "Check it" }] }) });
    expect(await screen.findByText("No context yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "opus" } });
    await waitFor(() => expect(named("project.set")[0]?.input).toEqual({ claude: { model: "opus" } }));
    fireEvent.change(screen.getByLabelText("Default effort"), { target: { value: "max" } });
    await waitFor(() => expect(named("project.set")[1]?.input).toEqual({ claude: { effort: "max" } }));
    const label = screen.getByLabelText("Quick ask 1 label");
    fireEvent.blur(label);
    expect(named("project.set")).toHaveLength(2);
    fireEvent.change(label, { target: { value: "  " } });
    fireEvent.blur(label);
    expect(named("project.set")).toHaveLength(2);
    fireEvent.change(label, { target: { value: " Verify " } });
    fireEvent.change(screen.getByLabelText("Quick ask 1 prompt"), { target: { value: " Verify it " } });
    fireEvent.blur(screen.getByLabelText("Quick ask 1 prompt"));
    await waitFor(() =>
      expect(named("project.set")[2]?.input).toEqual({
        claude: { presets: [{ label: "Verify", prompt: "Verify it" }] },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove quick ask 1" }));
    await waitFor(() => expect(named("project.set")[3]?.input).toEqual({ claude: { presets: [] } }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const addIt = screen.getByRole("button", { name: "Add the quick request" });
    expect(addIt).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Quick request name"), { target: { value: " New " } });
    fireEvent.change(screen.getByLabelText("What Claude is asked"), { target: { value: " Do " } });
    fireEvent.click(addIt);
    await waitFor(() =>
      expect(named("project.set")[4]?.input).toEqual({
        claude: {
          presets: [
            { label: "Check", prompt: "Check it" },
            { label: "New", prompt: "Do" },
          ],
        },
      }),
    );
  });

  it("default contexts: toggle on and off, manage, reload on change; no presets reads as none", async () => {
    models.routes["project.set"] = () => ({});
    models.routes["contexts.list"] = () => [
      { id: "house", name: "House style", paths: [], files: [], hasNotes: true },
      { id: "gloss", name: "", paths: [], files: [], hasNotes: false },
    ];
    mount(<ClaudeSection />, { info: claude({ contexts: ["house"], presets: undefined }) });
    expect(await screen.findByText("No quick ask yet.")).toBeInTheDocument();
    const house = await screen.findByRole("button", { name: "House style" });
    expect(house).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(house);
    await waitFor(() => expect(named("project.set")[0]?.input).toEqual({ claude: { contexts: [] } }));
    fireEvent.click(screen.getByRole("button", { name: "gloss" }));
    await waitFor(() => expect(named("project.set")[1]?.input).toEqual({ claude: { contexts: ["house", "gloss"] } }));
    const before = named("contexts.list").length;
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    fireEvent.click(screen.getByRole("button", { name: "Close contexts" }));
    await waitFor(() => expect(named("contexts.list").length).toBe(before + 1));
    act(() => {
      window.dispatchEvent(new Event("testimus:contexts"));
    });
    await waitFor(() => expect(named("contexts.list").length).toBe(before + 2));
    cleanup();
    delete models.routes["contexts.list"];
    mount(<ClaudeSection />, { info: claude() });
    expect(await screen.findByText("No context yet.")).toBeInTheDocument();
  });
});

describe("Settings › Project notes and the screen", () => {
  it("loads the notes, saves them after a pause and on blur", async () => {
    setProject("C:\\p");
    models.routes["project.notes"] = () => ({ file: "AGENTS.md", text: "old" });
    models.routes["project.setNotes"] = () => ({});
    mount(<ProjectSection />);
    const notes = screen.getByLabelText("Project notes");
    expect(notes).toBeDisabled();
    await waitFor(() => expect(notes).toHaveValue("old"));
    expect(screen.getByText("AGENTS.md")).toBeInTheDocument();
    fireEvent.change(notes, { target: { value: "new" } });
    await waitFor(() => expect(named("project.setNotes")[0]?.input).toEqual({ text: "new" }), { timeout: 2000 });
    fireEvent.blur(notes);
    expect(named("project.setNotes")).toHaveLength(1);
    fireEvent.change(notes, { target: { value: "newer" } });
    fireEvent.blur(notes);
    await waitFor(() => expect(named("project.setNotes")[1]?.input).toEqual({ text: "newer" }));
  });

  it("an empty answer, a failed load and a failed save; notes typed in another project are dropped", async () => {
    setProject("C:\\p");
    models.routes["project.notes"] = () => null;
    mount(<ProjectSection />);
    const notes = screen.getByLabelText("Project notes");
    await waitFor(() => expect(notes).toBeEnabled());
    expect(screen.getByText("CLAUDE.md")).toBeInTheDocument();
    fireEvent.change(notes, { target: { value: "x" } });
    fireEvent.blur(notes);
    expect(await screen.findByText("Could not save the project notes")).toBeInTheDocument();
    cleanup();
    delete models.routes["project.notes"];
    models.routes["project.setNotes"] = () => ({});
    const { unmount } = mount(<ProjectSection />);
    const again = screen.getByLabelText("Project notes");
    const sent = named("project.setNotes").length;
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.change(again, { target: { value: "for p" } });
    setProject("C:\\other");
    unmount();
    expect(named("project.setNotes")).toHaveLength(sent);
  });

  it("the screen opens a sub-section and focuses a field it points at", async () => {
    const focus = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(focus);
    models.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    mount(<SettingsScreen />, { route: { screen: "settings", arg: "claude-exe" } });
    expect(screen.getByRole("button", { name: "Claude" })).toHaveAttribute("aria-current", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(focus).toHaveBeenCalled();
  });
});
