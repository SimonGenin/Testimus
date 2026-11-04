// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../../../src/core/types.ts";
import { AccessSection, fileState } from "../../../../src/ui/screens/settings/AccessSection.tsx";
import {
  ConnectAtlassian,
  jiraWords,
  savedAs,
  siteRoot,
  xrayWords,
} from "../../../../src/ui/screens/settings/ConnectAtlassian.tsx";
import { iconsIn } from "../../helpers/icon-names.tsx";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, Fail, fakeNet, hold, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

const check = (id: string, state: DoctorCheck["state"], detail = "", fix?: string) =>
  ({ id, label: id, state, detail, fix }) as DoctorCheck;

const creds = (jira: Record<string, unknown> = {}, xray: Record<string, unknown> = {}) => ({
  jira: { file: "C:\\Users\\me\\.atlassian\\credentials.json", exists: true, complete: true, ...jira },
  xray: { file: "C:\\Users\\me\\.atlassian\\xray_credentials.json", exists: true, complete: true, ...xray },
});

const verdict = (status: ReturnType<typeof creds>, more: Record<string, unknown> = {}) => ({
  status,
  checks: [],
  ok: false,
  ...more,
});

beforeEach(() => {
  fakeNet();
  net.routes["system.secrets"] = () => ({ token: "", clientId: "", clientSecret: "" });
  net.routes["system.doctor"] = () => ({ ok: true, checks: [] });
});

afterEach(reset);

const field = (name: string) => screen.getByLabelText(label(name));

describe("ConnectAtlassian helpers", () => {
  it("siteRoot reads what people paste", () => {
    expect(siteRoot("  ")).toBe("");
    expect(siteRoot("transurb")).toBe("https://transurb.atlassian.net");
    expect(siteRoot(" transurb.atlassian.net ")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("transurb.atlassian.net/browse/LFRPS12-1")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("https://transurb.atlassian.net/browse/X-1?focus=1")).toBe("https://transurb.atlassian.net");
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
    expect(jiraWords(undefined).text).toBe("Fill in the site, the email and the API token first.");
    expect(jiraWords(check("jira", "fail", "Missing token")).ok).toBe(false);
    expect(jiraWords(check("jira", "fail", "~/.atlassian/credentials.json needs baseUrl, email and token.")).ok).toBe(
      false,
    );
    expect(jiraWords(check("jira", "ok", "Sébastien Genin on transurb.atlassian.net"))).toEqual({
      ok: true,
      text: "Connected as Sébastien Genin",
    });
    expect(jiraWords(check("jira", "fail", "Jira 401 — check")).text).toMatch(
      /refused this email and token.*scopes does not work/,
    );
    expect(jiraWords(check("jira", "fail", "Jira 404 at x")).text).toMatch(/^No Jira Cloud site at that address/);
    expect(jiraWords(check("jira", "fail", "x unreachable: getaddrinfo ENOTFOUND")).text).toMatch(/^No Jira Cloud/);
    expect(jiraWords(check("jira", "fail", "odd")).text).toBe("odd");
    expect(xrayWords(undefined).text).toMatch(/Client ID/);
    expect(xrayWords(check("xray", "fail", "Missing ~/.atlassian/xray_credentials.json.")).text).toBe(
      "Fill in the Client ID and the Client Secret first.",
    );
    expect(xrayWords(check("xray", "ok"))).toEqual({ ok: true, text: "Key accepted" });
    expect(xrayWords(check("xray", "fail", "authentication failed (401)")).text).toMatch(/refused this Client ID/);
    expect(xrayWords(check("xray", "fail", "Xray 401 — check")).text).toMatch(/secret is shown only once/);
    expect(xrayWords(check("xray", "fail", "Xray unreachable")).text).toMatch(/did not answer/);
    expect(xrayWords(check("xray", "fail", "weird")).text).toBe("weird");
  });

  it("fileState reads the shared files", () => {
    expect(fileState({ file: "f", exists: false, complete: false })).toBe("missing");
    expect(fileState({ file: "f", exists: true, complete: true, invalid: true })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: false })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: true })).toBe("found");
  });
});

describe("ConnectAtlassian", () => {
  it("fills the found access, shows how it is saved, saves only what changed, then shows what was saved", async () => {
    let st = creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme" });
    let secrets = { token: "", clientId: "", clientSecret: "" };
    net.routes["system.credentials"] = () => verdict(st);
    net.routes["system.secrets"] = () => secrets;
    net.routes["system.setCredentials"] = (i) => {
      st = creds({ baseUrl: "https://beta.atlassian.net", email: "me@beta" });
      secrets = { token: String(i.token), clientId: String(i.clientId), clientSecret: String(i.clientSecret) };
      return verdict(st, {
        saved: ["baseUrl", "email", "token", "clientId", "clientSecret"],
        ok: true,
        checks: [check("jira", "ok", "me@beta on https://beta"), check("xray", "fail", "Xray 403")],
      });
    };
    const onStatus = vi.fn();
    const onResult = vi.fn();
    mountSettings(<ConnectAtlassian lead="Lead text" onStatus={onStatus} onResult={onResult} />);
    const site = await screen.findByRole("textbox", { name: label("Jira site") });
    expect(site).toHaveValue("https://acme.atlassian.net/wiki");
    expect(screen.getByText("Lead text")).toBeInTheDocument();
    expect(onStatus).toHaveBeenCalledWith(st);
    expect(screen.getByText(/The address in your browser/)).toBeInTheDocument();
    fireEvent.change(site, { target: { value: "beta" } });
    expect(screen.getByText("https://beta.atlassian.net")).toBeInTheDocument();
    expect(screen.getByText(/Will be saved as/)).toBeInTheDocument();
    fireEvent.change(field("Email"), { target: { value: " me@beta " } });
    fireEvent.change(field("API token"), { target: { value: " tok " } });
    fireEvent.change(field("Client ID"), { target: { value: " cid " } });
    fireEvent.change(field("Client secret"), { target: { value: " sec " } });
    expect(field("API token")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show secrets" }));
    expect(field("API token")).toHaveAttribute("type", "text");
    expect(field("Client secret")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide secrets" }));
    const save = screen.getByRole("button", { name: "Save and test the connection" });
    expect(iconsIn(save), "audit icons 113").toEqual(["plug"]);
    expect(iconsIn(screen.getByText(/^Settings → Apps → Xray/).parentElement)[0], "audit icons 114").toBe("settings");
    fireEvent.click(save);
    expect(await screen.findByText("Connected as me@beta")).toBeInTheDocument();
    expect(screen.getByText(/Xray refused this Client ID/)).toBeInTheDocument();
    const said = screen.getByText("Connected as me@beta").closest('[role="status"]');
    expect(iconsIn(within(said as HTMLElement).getByText("Connected"))).toEqual(["check-circle"]);
    expect(iconsIn(within(said as HTMLElement).getByText("Failed")), "audit icons 115").toEqual(["x-circle"]);
    expect(inputs("system.setCredentials")[0]).toEqual({
      site: "https://beta.atlassian.net",
      email: "me@beta",
      token: "tok",
      clientId: "cid",
      clientSecret: "sec",
    });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    await waitFor(() => expect(calls("system.doctor")).toHaveLength(1));
    await waitFor(() => expect(field("API token")).toHaveValue("tok"));
    expect(field("Jira site")).toHaveValue("https://beta.atlassian.net");
    fireEvent.change(field("Client ID"), { target: { value: "x" } });
    expect(screen.queryByText("Connected as me@beta")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(field("Client ID")).toHaveValue("x"));
    expect(inputs("system.setCredentials")[1]).toEqual({ clientId: "x" });
  });

  it("an unchanged form sends the check only; Enter submits; nothing saved, no doctor", async () => {
    net.routes["system.credentials"] = () => verdict(creds({ complete: false }, { exists: false, complete: false }));
    net.routes["system.setCredentials"] = () => verdict(creds(), { saved: [] });
    mountSettings(<ConnectAtlassian />);
    const site = await screen.findByRole("textbox", { name: label("Jira site") });
    expect(field("API token")).toHaveAttribute("placeholder", "");
    expect(field("Client ID")).toHaveAttribute("placeholder", "");
    expect(screen.queryByRole("button", { name: "Open Jira apps" })).toBeNull();
    fireEvent.submit(site.closest("form") as HTMLFormElement);
    expect(await screen.findByText(/Fill in the site, the email/)).toBeInTheDocument();
    expect(inputs("system.setCredentials")[0]).toEqual({});
    expect(calls("system.doctor")).toHaveLength(0);
  });

  it("says a saved secret is kept when its field is left empty", async () => {
    net.routes["system.credentials"] = () => verdict(creds());
    mountSettings(<ConnectAtlassian />);
    await screen.findByRole("textbox", { name: label("Jira site") });
    expect(field("API token")).toHaveAttribute("placeholder", "Saved — leave empty to keep it");
    expect(field("Client ID")).toHaveAttribute("placeholder", "Saved — leave empty to keep it");
  });

  it("opens the token and app pages in a browser tab, the folder as plain text", async () => {
    net.routes["system.credentials"] = () => verdict(creds({ baseUrl: "https://acme.atlassian.net/wiki" }));
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mountSettings(<ConnectAtlassian />);
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
    expect(screen.queryByRole("button", { name: /Saved in/ })).toBeNull();
    expect(screen.getByText(/Create API token/)).toBeInTheDocument();
    expect(screen.getByText(/Create API token/).closest("li")).toHaveTextContent("not “with scopes”");
    expect(document.querySelector("em, i")).toBeNull();
    expect(screen.getByText(/only a Jira admin sees that page/i)).toBeInTheDocument();
  });

  it("through the desktop app: the pages open outside, the folder is revealed", async () => {
    net.routes["system.credentials"] = () => verdict(creds({ baseUrl: "https://transurb.atlassian.net/wiki" }));
    const d = fakeDesktop();
    mountSettings(<ConnectAtlassian />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith("https://id.atlassian.com/manage-profile/security/api-tokens");
    fireEvent.click(screen.getByRole("button", { name: "Open Jira apps" }));
    expect(d.openExternal).toHaveBeenLastCalledWith("https://transurb.atlassian.net/plugins/servlet/upm");
    fireEvent.click(screen.getByRole("button", { name: /Saved in/ }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\Users\\me\\.atlassian"));
  });

  it("shows why the access cannot be read and why a save failed", async () => {
    mountSettings(<ConnectAtlassian />);
    expect(await screen.findByText("The access could not be read")).toBeInTheDocument();
    expect(screen.getByText("Unknown command system.credentials")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and test the connection" })).toBeNull();
    reset();
    fakeNet();
    net.routes["system.credentials"] = () => verdict(creds());
    net.routes["system.setCredentials"] = () => {
      throw new Fail("disk locked");
    };
    mountSettings(<ConnectAtlassian />);
    fireEvent.click(await screen.findByRole("button", { name: "Save and test the connection" }));
    expect(await screen.findByText("disk locked")).toBeInTheDocument();
  });

  it("shows Testing… while it runs", async () => {
    net.routes["system.credentials"] = () => verdict(creds());
    net.routes["system.setCredentials"] = () => verdict(creds(), { saved: [], ok: true });
    mountSettings(<ConnectAtlassian />);
    const save = await screen.findByRole("button", { name: "Save and test the connection" });
    const release = hold();
    fireEvent.click(save);
    expect(await screen.findByRole("button", { name: "Testing…" })).toHaveAttribute("aria-busy", "true");
    release();
    expect(await screen.findByRole("button", { name: "Save and test the connection" })).toBeEnabled();
  });

  it("erases a saved secret the user empties", async () => {
    net.routes["system.credentials"] = () =>
      verdict(creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }));
    net.routes["system.setCredentials"] = () => verdict(creds(), { saved: [], ok: true });
    net.routes["system.secrets"] = () => ({ token: "tok-1", clientId: "cid-1", clientSecret: "sec-1" });
    mountSettings(<ConnectAtlassian />);
    await waitFor(() => expect(field("Client ID")).toHaveValue("cid-1"));
    fireEvent.change(field("Client ID"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(calls("system.setCredentials")).toHaveLength(1));
    expect(inputs("system.setCredentials")[0]).toEqual({ clear: ["clientId"] });
  });

  it("saves a site outside atlassian.net as given, as Xray Editor does", async () => {
    net.routes["system.credentials"] = () =>
      verdict(creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }));
    net.routes["system.setCredentials"] = () =>
      verdict(creds({ baseUrl: "https://jira.acme.com" }), { saved: ["baseUrl"] });
    mountSettings(<ConnectAtlassian />);
    fireEvent.change(await screen.findByRole("textbox", { name: label("Jira site") }), {
      target: { value: "https://jira.acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(calls("system.setCredentials")).toHaveLength(1));
    expect(inputs("system.setCredentials")[0]).toMatchObject({ site: "https://jira.acme.com", otherHost: true });
  });
});

describe("Settings › Access", () => {
  it("lists each file with its state and the doctor's verdict", async () => {
    net.routes["system.doctor"] = () => ({
      ok: false,
      checks: [check("jira", "fail", "Jira 401 Unauthorized — token rejected", "New token"), check("xray", "ok")],
    });
    net.routes["system.credentials"] = () => verdict(creds());
    mountSettings(<AccessSection />);
    const files = await screen.findByRole("list", { name: "Credential files" });
    expect(within(files).getAllByText("Found · valid")).toHaveLength(2);
    expect(within(files).getByText("C:\\Users\\me\\.atlassian\\xray_credentials.json")).toBeInTheDocument();
    expect(
      await within(within(files).getByRole("listitem", { name: "Xray" })).findByText("Connected"),
    ).toBeInTheDocument();
    expect(within(files).getByText(/Jira 401 Unauthorized/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Connect to Jira and Xray" })).toBeInTheDocument();
  });

  it("a missing file, an invalid one with its problem, an incomplete one", async () => {
    net.routes["system.doctor"] = () => ({ ok: true, checks: [check("jira", "skip")] });
    net.routes["system.credentials"] = () =>
      verdict(creds({ exists: false }, { invalid: true, problem: "not valid JSON" }));
    mountSettings(<AccessSection />);
    expect(await screen.findByText("Missing")).toBeInTheDocument();
    expect(iconsIn(screen.getByText("Missing")), "audit icons 116").toEqual(["circle-dashed"]);
    expect(screen.getByText("Invalid — not valid JSON")).toBeInTheDocument();
    reset();
    fakeNet();
    net.routes["system.secrets"] = () => ({ token: "", clientId: "", clientSecret: "" });
    net.routes["system.credentials"] = () => verdict(creds({}, { complete: false }));
    mountSettings(<AccessSection />);
    expect(await screen.findByText("Invalid")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("works without a project", async () => {
    net.routes["system.credentials"] = () => verdict(creds());
    mountSettings(<AccessSection />, { info: null });
    expect(await screen.findByRole("list", { name: "Credential files" })).toBeInTheDocument();
    expect(calls("project.info")).toHaveLength(0);
  });
});
