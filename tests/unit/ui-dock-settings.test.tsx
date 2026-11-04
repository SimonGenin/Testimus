// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredsStatus, DoctorCheck } from "../../src/core/types.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { AccessSection, fileState } from "../../src/ui/screens/settings/AccessSection.tsx";
import { ClaudeSection, exeLine } from "../../src/ui/screens/settings/ClaudeSection.tsx";
import { jiraWords, savedAs, siteRoot, xrayWords } from "../../src/ui/screens/settings/ConnectAtlassian.tsx";
import { ProjectSection } from "../../src/ui/screens/settings/ProjectSection.tsx";
import { SettingsScreen } from "../../src/ui/screens/settings/SettingsScreen.tsx";
import { renderWithData } from "./cov-uishell-helpers.tsx";
import { app } from "./ui-desktop-helpers.tsx";

type Handler = (input: Record<string, unknown>) => unknown;
let calls: { name: string; input: Record<string, unknown> }[] = [];
let routes: Record<string, Handler> = {};
const callsOf = (n: string) => calls.filter((c) => c.name === n);

class FakeES {
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  calls = [];
  routes = { "claude.status": () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" }) };
  resetDoctor();
  localStorage.clear();
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (!m) return new Response("", { status: 404 });
      const name = `${m[1]}.${m[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      try {
        return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.testimusDesktop;
});

const withClaude = (
  claude: Partial<NonNullable<AppState["info"]>["project"]["claude"]>,
  over: Partial<AppState> = {},
) => {
  const base = app().info as NonNullable<AppState["info"]>;
  return app({
    info: { ...base, project: { ...base.project, claude: { ...base.project.claude, ...claude } } },
    ...over,
  });
};

const wrap = (state: AppState, ui: ReactNode) => <AppContext.Provider value={state}>{ui}</AppContext.Provider>;
const ctxList = [
  { id: "ctx-a", name: "House style", paths: [], files: ["g.pdf"], hasNotes: true },
  { id: "ctx-b", name: "Glossary", paths: ["D:\\Specs"], files: [], hasNotes: false },
];
const desktop = (more: Record<string, unknown> = {}) => {
  const d = {
    openExternal: vi.fn(async () => true),
    reveal: vi.fn(async () => true),
    pickFolder: vi.fn(async () => "D:\\Picked"),
    pickFiles: vi.fn(async () => []),
    setAlwaysOnTop: vi.fn(async (on: boolean) => on),
    ...more,
  };
  window.testimusDesktop = d as never;
  return d;
};

describe("settings › Claude", () => {
  it("agents at the same time: saves the maximum and the adapting, tests the PC's limits and shows the last test", async () => {
    const base = { claude: { exe: "" }, models: { allowRemote: true } };
    let agents: Record<string, unknown> = {};
    routes["system.settings"] = () => ({ ...base, agents });
    routes["system.set"] = (i) => {
      agents = {
        ...agents,
        ...(i.agentsMax !== undefined ? { max: i.agentsMax } : {}),
        ...(i.agentsAdaptive !== undefined ? { adaptive: i.agentsAdaptive } : {}),
      };
      return { ...base, agents };
    };
    const measured = {
      limit: 10,
      at: "2026-11-03T16:00:00.000Z",
      reason: "With 12 agents the CPU is at 96 %",
      levels: [],
    };
    routes["system.testAgents"] = () => ({ jobId: "j-agents" });
    routes["jobs.show"] = () => {
      agents = { ...agents, max: 10, measured };
      return { job: { id: "j-agents", status: "done", result: { ...measured, applied: true } } };
    };
    renderWithData(wrap(app(), <ClaudeSection />));
    const max = (await screen.findByRole("spinbutton", { name: "Agents at the same time" })) as HTMLInputElement;
    await waitFor(() => expect(max.value).toBe("5"));
    fireEvent.change(max, { target: { value: "40" } });
    fireEvent.blur(max);
    expect(max.value).toBe("5");
    expect(callsOf("system.set")).toHaveLength(0);
    fireEvent.change(max, { target: { value: "8" } });
    fireEvent.keyDown(max, { key: "Enter" });
    await waitFor(() => expect(callsOf("system.set")[0]?.input).toEqual({ agentsMax: 8 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Adapt to the PC's load" }));
    await waitFor(() => expect(callsOf("system.set")[1]?.input).toEqual({ agentsAdaptive: false }));
    expect(screen.getByRole("checkbox", { name: "Adapt to the PC's load" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Test this PC's limits" }));
    expect(
      await screen.findByText("Last test: 10 agents on 03/11/2026 — With 12 agents the CPU is at 96 %"),
    ).toBeVisible();
    await waitFor(() => expect(max.value).toBe("10"));
    expect(screen.getByRole("button", { name: "Test this PC's limits" })).toBeEnabled();
  });

  it("toggles default contexts by name, edits quick asks in place, removes by index", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["project.set"] = (i) => i;
    const presets = [
      { label: "Same", prompt: "one" },
      { label: "Same", prompt: "two" },
    ];
    renderWithData(wrap(withClaude({ presets, contexts: ["ctx-a"] }), <ClaudeSection />));
    const group = await screen.findByRole("group", { name: "Default contexts" });
    expect(within(group).getByRole("button", { name: "House style" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Glossary" }));
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(1));
    expect(callsOf("project.set")[0].input).toEqual({ claude: { contexts: ["ctx-a", "ctx-b"] } });
    const label = screen.getByRole("textbox", { name: "Quick ask 2 label" });
    fireEvent.change(label, { target: { value: "Other" } });
    fireEvent.blur(label);
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(2));
    expect(callsOf("project.set")[1].input).toEqual({
      claude: {
        presets: [
          { label: "Same", prompt: "one" },
          { label: "Other", prompt: "two" },
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove quick ask 1" }));
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(3));
    expect(callsOf("project.set")[2].input).toEqual({ claude: { presets: [{ label: "Same", prompt: "two" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    expect(await screen.findByRole("dialog", { name: "Contexts" })).toBeInTheDocument();
  });

  it("the model can be a custom one", async () => {
    routes["project.set"] = (i) => i;
    renderWithData(wrap(withClaude({ model: "claude-opus-4-1" }), <ClaudeSection />));
    expect(screen.getByLabelText("Default model")).toHaveValue("custom");
    expect(screen.getByRole("textbox", { name: "Custom model" })).toHaveValue("claude-opus-4-1");
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "fable" } });
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(1));
    expect(callsOf("project.set")[0].input).toEqual({ claude: { model: "fable" } });
  });

  it("checks the Claude program and shows how to connect it when not found", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    routes["system.set"] = (i) => ({ claude: { exe: i.claudeExe }, models: { allowRemote: true } });
    renderWithData(wrap(app({ info: null }), <ClaudeSection />));
    expect(await screen.findByText("✓ 2.1.0 · found")).toBeInTheDocument();
    routes["claude.status"] = (i) => {
      expect(i).toEqual({ refresh: true });
      return { installed: false, signedIn: false, exe: "C:\\x\\claude.cmd", detail: "spawn ENOENT" };
    };
    const field = screen.getByLabelText("Claude program");
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    fireEvent.change(field, { target: { value: "C:\\x\\claude.cmd" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("✕ spawn ENOENT · not found · Claude is optional")).toBeInTheDocument();
    expect(callsOf("system.set")[0].input).toEqual({ claudeExe: "C:\\x\\claude.cmd" });
    expect(screen.getByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    expect(exeLine({ installed: true, signedIn: null })).toBe("✓ Claude Code · found");
  });

  it("a Claude program path typed but not blurred is saved when Settings goes, once, as in Xray Editor", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    routes["system.set"] = (i) => ({ claude: { exe: i.claudeExe }, models: { allowRemote: true } });
    const r = renderWithData(wrap(app({ info: null }), <ClaudeSection />));
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    await screen.findByText("✓ 2.1.0 · found");
    fireEvent.change(screen.getByLabelText("Claude program"), { target: { value: "D:\\tools\\claude.cmd" } });
    expect(callsOf("system.set")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(callsOf("system.set")).toHaveLength(1));
    expect(callsOf("system.set")[0].input).toEqual({ claudeExe: "D:\\tools\\claude.cmd" });
    const again = renderWithData(wrap(app({ info: null }), <ClaudeSection />));
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(2));
    again.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(callsOf("system.set")).toHaveLength(1);
  });
});

describe("settings screen, notes, appearance", () => {
  it("shows the version beside the title, and opens on the Claude program field", () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    renderWithData(wrap(app({ info: null, route: { screen: "settings", arg: "claude-exe" } }), <SettingsScreen />));
    expect(screen.getByText(`v${__VERSION__}`)).toHaveClass("version-pill");
    expect(screen.getByLabelText("Claude program")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Claude" })).toHaveAttribute("aria-current", "true");
  });

  it("project notes: read, saved 400 ms after typing, flushed on blur", async () => {
    routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "# Notes" });
    routes["project.setNotes"] = (i) => ({ file: "C:\\p\\CLAUDE.md", bytes: String(i.text).length });
    renderWithData(wrap(app(), <ProjectSection />));
    const area = screen.getByLabelText("Project notes");
    await waitFor(() => expect(area).toHaveValue("# Notes"));
    expect(screen.getByText("C:\\p\\CLAUDE.md")).toBeInTheDocument();
    fireEvent.change(area, { target: { value: "# Notes\nPCC" } });
    expect(callsOf("project.setNotes")).toHaveLength(0);
    await waitFor(() => expect(callsOf("project.setNotes")).toHaveLength(1), { timeout: 1500 });
    expect(callsOf("project.setNotes")[0].input).toEqual({ text: "# Notes\nPCC" });
    fireEvent.change(area, { target: { value: "# Notes\nPCC\nSAE" } });
    fireEvent.blur(area);
    await waitFor(() => expect(callsOf("project.setNotes")).toHaveLength(2));
    expect(callsOf("project.setNotes")[1].input).toEqual({ text: "# Notes\nPCC\nSAE" });
  });

  it("a Jira project key and a label prefix typed but not blurred are saved when Settings goes", async () => {
    routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "" });
    routes["project.set"] = (i) => i;
    const state = app();
    const r = renderWithData(wrap(state, <ProjectSection />));
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "bhptcc" } });
    fireEvent.change(screen.getByLabelText("Review label prefix"), { target: { value: "tm-" } });
    expect(callsOf("project.set")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(2));
    expect(callsOf("project.set").map((c) => c.input)).toEqual([{ jiraProject: "BHPTCC" }, { labelPrefix: "tm-" }]);
    const again = renderWithData(wrap(state, <ProjectSection />));
    fireEvent.blur(screen.getByLabelText("Jira project"));
    again.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(callsOf("project.set")).toHaveLength(2);
  });
});

const creds = (jira: Partial<CredsStatus["jira"]> = {}, xray: Partial<CredsStatus["xray"]> = {}): CredsStatus => ({
  jira: { file: "C:\\Users\\me\\.atlassian\\credentials.json", exists: true, complete: true, ...jira },
  xray: { file: "C:\\Users\\me\\.atlassian\\xray_credentials.json", exists: true, complete: true, ...xray },
});
const check = (id: string, state: DoctorCheck["state"], detail: string): DoctorCheck => ({
  id,
  label: id,
  state,
  detail,
});

describe("access: files and the guided connection", () => {
  it("reduces what people paste to the site root and previews what is saved", () => {
    expect(siteRoot("transurb")).toBe("https://transurb.atlassian.net");
    expect(siteRoot(" transurb.atlassian.net ")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("https://transurb.atlassian.net/browse/X-1?focus=1")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("https://transurb.atlassian.net/wiki/spaces/A")).toBe("https://transurb.atlassian.net/wiki");
    expect(siteRoot("")).toBe("");
    expect(savedAs("https://transurb.atlassian.net")).toBe("https://transurb.atlassian.net");
    expect(savedAs("https://transurb.atlassian.net", "https://transurb.atlassian.net/wiki")).toBe(
      "https://transurb.atlassian.net/wiki",
    );
    expect(savedAs("https://jira.example.com")).toBe("https://jira.example.com");
    expect(fileState({ file: "f", exists: false, complete: false })).toBe("missing");
    expect(fileState({ file: "f", exists: true, complete: false, invalid: true })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: true })).toBe("found");
  });

  it("answers in words per service", () => {
    expect(jiraWords(check("jira", "ok", "Sébastien Genin on transurb.atlassian.net"))).toEqual({
      ok: true,
      text: "Connected as Sébastien Genin",
    });
    expect(jiraWords(check("jira", "fail", "Jira 401 — check ~/.atlassian/credentials.json")).text).toMatch(
      /refused this email and token.*scopes does not work/,
    );
    expect(jiraWords(check("jira", "fail", "Jira 404 on x.atlassian.net")).text).toMatch(
      /^No Jira Cloud site at that address/,
    );
    expect(jiraWords(check("jira", "fail", "x.atlassian.net unreachable: getaddrinfo ENOTFOUND")).text).toMatch(
      /^No Jira Cloud site/,
    );
    expect(jiraWords(undefined).text).toBe("Fill in the site, the email and the API token first.");
    expect(jiraWords(check("jira", "fail", "~/.atlassian/credentials.json needs baseUrl, email and token.")).ok).toBe(
      false,
    );
    expect(xrayWords(check("xray", "ok", "authenticated"))).toEqual({ ok: true, text: "Key accepted" });
    expect(xrayWords(check("xray", "fail", "Xray 401 — check")).text).toMatch(/secret is shown only once/);
    expect(xrayWords(check("xray", "fail", "Missing ~/.atlassian/xray_credentials.json.")).text).toBe(
      "Fill in the Client ID and the Client Secret first.",
    );
    expect(xrayWords(check("xray", "fail", "xray.cloud.getxray.app unreachable: timeout")).text).toMatch(
      /did not answer/,
    );
  });

  it("lists both files, then saves and tests with words, secrets hidden by default", async () => {
    const d = desktop();
    let st = creds(
      { baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" },
      { complete: false, invalid: true, problem: "missing clientSecret" },
    );
    routes["system.credentials"] = routes["system.setCredentials"] = (i) => {
      if (Object.keys(i).length === 0) return { status: st, saved: [], checks: [], ok: false };
      st = creds({ baseUrl: "https://transurb.atlassian.net/wiki", email: "me@acme.fr" });
      return {
        status: st,
        saved: ["baseUrl", "clientSecret"],
        checks: [check("jira", "fail", "Jira 401 — check"), check("xray", "ok", "authenticated on xray")],
        ok: false,
      };
    };
    routes["system.doctor"] = () => ({ checks: [] });
    routes["system.secrets"] = () => ({ token: "tok-1", clientId: "cid-1", clientSecret: "" });
    renderWithData(wrap(app(), <AccessSection />));
    expect(await screen.findByText("found · valid")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("API token")).toHaveValue("tok-1"));
    expect(screen.getByLabelText("Client ID")).toHaveValue("cid-1");
    expect(screen.getByText("invalid — missing clientSecret")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\me\\.atlassian\\xray_credentials.json")).toBeInTheDocument();
    const site = screen.getByLabelText("Jira site");
    expect(site).toHaveValue("https://acme.atlassian.net/wiki");
    fireEvent.change(site, { target: { value: "https://transurb.atlassian.net/browse/LFRPS12-1" } });
    expect(screen.getByText("https://transurb.atlassian.net")).toBeInTheDocument();
    expect(screen.getByText(/Will be saved as/)).toBeInTheDocument();
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show secrets" }));
    expect(secret).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide secrets" }));
    fireEvent.click(screen.getByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith("https://id.atlassian.com/manage-profile/security/api-tokens");
    fireEvent.click(screen.getByRole("button", { name: "Open Jira apps" }));
    expect(d.openExternal).toHaveBeenLastCalledWith("https://transurb.atlassian.net/plugins/servlet/upm");
    expect(screen.getByText(/Create API token/)).toBeInTheDocument();
    expect(screen.getByText(/only a Jira admin sees that page/i)).toBeInTheDocument();
    fireEvent.change(secret, { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    expect(await screen.findByText(/Jira refused this email and token/)).toBeInTheDocument();
    expect(screen.getByText("Key accepted")).toBeInTheDocument();
    expect(callsOf("system.setCredentials")[0].input).toEqual({
      site: "https://transurb.atlassian.net",
      clientSecret: "s3cret",
    });
    expect(secret).toHaveValue("s3cret");
    expect(screen.getAllByText("found · valid")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Saved in/ }));
    expect(d.reveal).toHaveBeenCalledWith("C:\\Users\\me\\.atlassian");
  });

  it("erases a saved secret the user empties", async () => {
    routes["system.credentials"] = routes["system.setCredentials"] = () => ({
      status: creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }),
      saved: [],
      checks: [],
      ok: true,
    });
    routes["system.secrets"] = () => ({ token: "tok-1", clientId: "cid-1", clientSecret: "sec-1" });
    routes["system.doctor"] = () => ({ checks: [] });
    renderWithData(wrap(app(), <AccessSection />));
    await waitFor(() => expect(screen.getByLabelText("Client ID")).toHaveValue("cid-1"));
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(callsOf("system.setCredentials")).toHaveLength(1));
    expect(callsOf("system.setCredentials")[0].input).toEqual({ clear: ["clientId"] });
  });

  it("saves a site outside atlassian.net as given, as Xray Editor does", async () => {
    routes["system.credentials"] = routes["system.setCredentials"] = (i) =>
      Object.keys(i).length === 0
        ? {
            status: creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }),
            saved: [],
            checks: [],
            ok: true,
          }
        : {
            status: creds({ baseUrl: "https://jira.acme.com", email: "me@acme.fr" }),
            saved: ["baseUrl"],
            checks: [],
            ok: true,
          };
    routes["system.doctor"] = () => ({ checks: [] });
    renderWithData(wrap(app(), <AccessSection />));
    const site = await screen.findByLabelText("Jira site");
    fireEvent.change(site, { target: { value: "https://jira.acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(callsOf("system.setCredentials")).toHaveLength(1));
    expect(callsOf("system.setCredentials")[0].input).toMatchObject({ site: "https://jira.acme.com", otherHost: true });
  });

  it("without the desktop app the links open a new tab and the folder is plain text", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    routes["system.credentials"] = routes["system.setCredentials"] = () => ({
      status: creds({}, { exists: false, complete: false }),
      saved: [],
      checks: [],
      ok: false,
    });
    renderWithData(wrap(app(), <AccessSection />));
    expect(await screen.findByText("missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open API tokens" }));
    expect(open).toHaveBeenCalledWith(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("button", { name: /Saved in/ })).toBeNull();
    expect(screen.getByText(/Saved in/)).toBeInTheDocument();
  });
});
