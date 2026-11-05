// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DoctorScreen } from "../../../../src/ui/screens/doctor/DoctorScreen.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status, withApp } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

const c = (o: Partial<DoctorCheck>): DoctorCheck => ({ id: "x", label: "X", state: "ok", detail: "d", ...o });
const answer = (checks: DoctorCheck[]) => ({ ok: !checks.some((x) => x.state === "fail"), checks });
const row = (text: string) => screen.getAllByRole("row").find((r) => r.textContent?.includes(text)) as HTMLElement;
const titles = (fn: typeof toasts.toast) => fn.mock.calls.map((a) => (a.length > 1 ? a[1] : a[0].title));

beforeEach(() => {
  fakeNet();
  fakeEvents();
  toasts.toast.mockClear();
  toasts.errorToast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
});

describe("System check screen", () => {
  it("shows info, skipped and open checks, re-runs, and reports a failed run", async () => {
    let fail = false;
    net.routes["system.doctor"] = () => {
      if (fail) throw new Fail("core down");
      return answer([
        c({ id: "proxy", label: "Proxy", detail: "none" }),
        c({ id: "ollama", label: "Ollama", state: "skip", detail: "not used", fix: "install it" }),
        c({ id: "skipped", label: "Other", state: "skip", detail: "n/a" }),
        c({ id: "jira", label: "Jira", state: "fail", detail: "401" }),
        c({ id: "claudeLogin", label: "Claude signed in", state: "ok", detail: "yes" }),
      ]);
    };
    withApp(<DoctorScreen />);
    expect(screen.getByRole("region", { name: "Checks" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "Claude" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "This project" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Checking…" })).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.getByText("Proxy")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Check again" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("region", { name: "Checks" })).toHaveAttribute("aria-busy", "false");
    expect(within(row("Proxy")).getByText("Info")).toBeInTheDocument();
    expect(screen.getByText("not used — install it")).toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.queryByText(/What to do/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Check Claude sign-in" })).toBeNull();
    expect(screen.getByText(/Last checked at/)).toBeInTheDocument();
    expect(screen.getByText("1 Failed")).toBeInTheDocument();
    expect(screen.getByText("2 Not checked")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Jira and Xray" })).toHaveTextContent("Failed");
    expect(screen.getByRole("table", { name: "Claude" })).toHaveTextContent("Claude signed in");
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    expect(await screen.findByText("The check could not run: core down")).toBeInTheDocument();
    fail = false;
    const runs = callsOf("system.doctor").length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(callsOf("system.doctor").length).toBeGreaterThan(runs));
    await waitFor(() => expect(screen.queryByText(/The check could not run/)).toBeNull());
  });

  it("one fix at a time: the others wait with a reason; the Claude program path opens its field", async () => {
    net.routes["models.pull"] = () => ({ jobId: "models-pull-1" });
    net.routes["jobs.show"] = (i) => ({
      job: job({ id: String(i.id), kind: "models-pull", status: "running" }),
      events: [],
    });
    net.routes["system.doctor"] = () =>
      answer([
        c({
          id: "model.embedding",
          label: "Embedding model",
          state: "warn",
          action: { label: "Download it", command: "models.pull" },
        }),
        c({
          id: "model.reranker",
          label: "Reranker",
          state: "warn",
          action: { label: "Download the reranker", command: "models.pull" },
        }),
        c({
          id: "claude",
          label: "Claude",
          state: "fail",
          action: { label: "Set the Claude program path", command: "system.set" },
        }),
      ]);
    const { state } = withApp(<DoctorScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Download it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download the reranker" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Download the reranker" })).toHaveAccessibleDescription(
      "Wait for « Download it » to finish",
    );
    expect(screen.getByRole("button", { name: "Download it" })).toHaveAttribute("aria-busy", "true");
    expect(callsOf("models.pull")).toHaveLength(1);
    cleanup();
    net.routes["system.doctor"] = () =>
      answer([
        c({
          id: "claude",
          label: "Claude",
          state: "fail",
          action: { label: "Set the Claude program path", command: "system.set" },
        }),
      ]);
    const again = withApp(<DoctorScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Set the Claude program path" }));
    expect(again.state.navigate).toHaveBeenCalledWith("settings", "claude-exe");
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("shows each check as an icon and a word, with what to do, and checks the sign-in on demand", async () => {
    net.routes["system.doctor"] = (i) =>
      answer([
        { id: "claude", label: "Claude Code CLI", state: "ok", detail: "claude 2.1.0" },
        i.claude
          ? { id: "claudeLogin", label: "Claude signed in", state: "ok", detail: "a minimal claude -p run answered" }
          : {
              id: "claudeLogin",
              label: "Claude signed in",
              state: "warn",
              detail: "Claude is installed but not signed in.",
              fix: "Type claude, then /login.",
              action: { label: "Check Claude sign-in", command: "system.doctor", input: { claude: true } },
            },
        { id: "jira", label: "Jira reachable", state: "fail", detail: "401", fix: "Check the token." },
      ]);
    withApp(<DoctorScreen />);
    await screen.findByText("Claude Code CLI");
    const words = ["Claude Code CLI", "Claude signed in", "Jira reachable"].map((l) => row(l));
    expect(words.map((r) => within(r).getByText(/^(OK|To do|Failed)$/).textContent)).toEqual(["OK", "To do", "Failed"]);
    for (const r of words) expect(r.querySelector("svg")).not.toBeNull();
    expect(row("Claude signed in")).toHaveTextContent("What to do: Type claude, then /login.");
    expect(row("Jira reachable")).toHaveTextContent("What to do: Check the token.");
    expect(callsOf("system.doctor").every((x) => !x.input.claude)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check Claude sign-in" }));
    await waitFor(() => expect(callsOf("system.doctor").some((x) => x.input.claude === true)).toBe(true));
    await waitFor(() => expect(row("Claude signed in")).toHaveTextContent("a minimal claude -p run answered"));
  });

  it("keeps the last sign-in answer when a plain run says not checked", async () => {
    net.routes["system.doctor"] = (i) =>
      answer([
        i.claude
          ? c({ id: "claudeLogin", label: "Claude signed in", state: "fail", detail: "not logged in" })
          : c({
              id: "claudeLogin",
              label: "Claude signed in",
              state: "skip",
              detail: "not checked",
              action: { label: "Check Claude sign-in", command: "system.doctor", input: { claude: true } },
            }),
      ]);
    withApp(<DoctorScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Check Claude sign-in" }));
    await waitFor(() => expect(row("Claude signed in")).toHaveTextContent("not logged in"));
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(callsOf("system.doctor").filter((x) => !x.input.claude)).toHaveLength(2));
    expect(row("Claude signed in")).toHaveTextContent("not logged in");
  });

  it("turns each fix into a button: runs the command, opens the settings or the folder dialog", async () => {
    let verifyFails = false;
    net.routes["models.verify"] = () => {
      if (verifyFails) throw new Fail("broken model");
      return { ok: true };
    };
    net.routes["models.add"] = () => ({ model: "m" });
    net.routes["models.hardware"] = () => ({ drives: [] });
    net.routes["system.doctor"] = () =>
      answer([
        c({
          id: "model.embedding",
          label: "Embedding model",
          state: "warn",
          detail: "not verified",
          fix: "testimus models verify m",
          action: { label: "Verify", command: "models.verify", input: { model: "m" } },
        }),
        c({
          id: "jira",
          state: "fail",
          detail: "401",
          action: { label: "Connect Atlassian", command: "system.setCredentials" },
        }),
        c({ id: "model.fit", state: "warn", action: { label: "Choose a lighter pack", command: "models.usePack" } }),
        c({
          id: "models.dir",
          state: "warn",
          action: { label: "Choose the models folder…", command: "models.setDir" },
        }),
        c({
          id: "model.reranker",
          state: "warn",
          action: { label: "Add from a folder…", command: "models.add", input: { kind: "x" } },
        }),
      ]);
    const { state } = withApp(<DoctorScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    expect(screen.queryByText(/What to do/)).toBeNull();
    await waitFor(() => expect(callsOf("models.verify")[0]?.input).toEqual({ model: "m" }));
    await waitFor(() => expect(titles(toasts.toast)).toContain("Embedding model: done"));
    verifyFails = true;
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    await waitFor(() => expect(titles(toasts.errorToast)).toContain("Verify failed"));
    fireEvent.click(screen.getByRole("button", { name: "Connect Atlassian" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
    fireEvent.click(screen.getByRole("button", { name: "Choose a lighter pack" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "models");
    noDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Add from a folder…" }));
    expect(state.navigate).toHaveBeenCalledTimes(3);
    const d = fakeDesktop({ folder: "E:\\share\\model" });
    fireEvent.click(screen.getByRole("button", { name: "Add from a folder…" }));
    await waitFor(() => expect(callsOf("models.add")[0]?.input).toEqual({ kind: "x", path: "E:\\share\\model" }));
    expect(d.pickFolder).toHaveBeenCalled();
    d.pickFolder.mockResolvedValueOnce(null);
    fireEvent.click(await screen.findByRole("button", { name: "Add from a folder…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(callsOf("models.add")).toHaveLength(1);
    noDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Choose the models folder…" }));
    expect(
      await screen.findByRole("dialog", { name: /^(Where should models be stored\?|Change the models folder)$/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("draws each fix with the icon of what it does: a download, a folder, an index (audit icons 95–97)", async () => {
    const fix = (id: string, label: string, command: string) =>
      c({ id, label: id, state: "warn", action: { label, command } });
    net.routes["system.doctor"] = () =>
      answer([
        fix("llamacpp", "Download llama.cpp", "models.pullRuntime"),
        fix("model.embedding", "Download Qwen3 Embedding 0.6B", "models.pull"),
        fix("models.dir", "Choose the models folder…", "models.setDir"),
        fix("index.space", "Index now", "rag.index"),
        fix("model.fit", "Choose a lighter pack", "models.usePack"),
        fix("jira", "Connect Atlassian", "system.setCredentials"),
      ]);
    withApp(<DoctorScreen />);
    const icons = async (name: string) => iconsIn(await screen.findByRole("button", { name }));
    expect(await icons("Download llama.cpp")).toEqual(["download"]);
    expect(await icons("Download Qwen3 Embedding 0.6B")).toEqual(["download"]);
    expect(await icons("Choose the models folder…")).toEqual(["folder"]);
    expect(await icons("Index now")).toEqual(["refresh"]);
    expect(await icons("Choose a lighter pack")).toEqual([]);
    expect(await icons("Connect Atlassian")).toEqual([]);
  });

  it("follows a fix that is a job until it ends, then checks again", async () => {
    let state: "running" | "done" | "failed" = "running";
    let n = 0;
    net.routes["models.pull"] = () => ({ jobId: `models-pull-${++n}` });
    net.routes["jobs.show"] = (i) => ({
      job: job({ id: String(i.id), kind: "models-pull", status: state, error: "disk full" }),
      events: [],
    });
    net.routes["system.doctor"] = () =>
      answer([
        c({
          id: "model.embedding",
          label: "Embedding model",
          state: "warn",
          action: { label: "Download it", command: "models.pull", input: { model: "m" } },
        }),
      ]);
    withApp(<DoctorScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Download it" }));
    await waitFor(() => expect(callsOf("jobs.show")).not.toHaveLength(0));
    expect(screen.getByRole("button", { name: "Download it" })).toHaveAttribute("aria-busy", "true");
    expect(toasts.toast).not.toHaveBeenCalled();
    const before = callsOf("system.doctor").length;
    state = "done";
    act(() => FakeES.emit(status(job({ id: "models-pull-1", kind: "models-pull", status: "done" }))));
    await waitFor(() => expect(titles(toasts.toast)).toContain("Embedding model: done"));
    await waitFor(() => expect(callsOf("system.doctor").length).toBeGreaterThan(before));
    state = "running";
    fireEvent.click(screen.getByRole("button", { name: "Download it" }));
    await waitFor(() => expect(callsOf("models.pull")).toHaveLength(2));
    state = "failed";
    act(() => FakeES.emit(status(job({ id: "models-pull-2", kind: "models-pull", status: "failed" }))));
    await waitFor(() => expect(titles(toasts.errorToast)).toContain("Download it failed"));
  });

  it("draws the paths in a check's words in the mono face, nothing else", async () => {
    net.routes["system.doctor"] = () =>
      answer([
        c({ id: "models.dir", label: "Models folder", detail: "D:\\Testimus\\models — 640 GB free" }),
        c({ id: "disk.index", label: "Disk", detail: "21.0 GB free at /home/ana/p." }),
        c({ id: "node", label: "Node", detail: "v26.1 · 3.1 / 3.9 GB" }),
      ]);
    withApp(<DoctorScreen />);
    await waitFor(() => expect(screen.getByText("Models folder")).toBeInTheDocument());
    const mono = (text: string) => [...row(text).querySelectorAll("[class*='code']")].map((e) => e.textContent);
    expect(mono("Models folder")).toEqual(["D:\\Testimus\\models"]);
    expect(row("Models folder")).toHaveTextContent("D:\\Testimus\\models — 640 GB free");
    expect(mono("Disk")).toEqual(["/home/ana/p"]);
    expect(row("Disk")).toHaveTextContent("21.0 GB free at /home/ana/p.");
    expect(mono("Node")).toEqual([]);
  });

  it("an open check, not Claude's own, can be asked to Claude: the problem goes to the dock with Testimus's advice", async () => {
    net.routes["system.doctor"] = () =>
      answer([
        c({ id: "jira", label: "Jira reachable", detail: "Simon on transurb" }),
        c({
          id: "xray",
          label: "Xray reachable",
          state: "fail",
          detail: "fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)",
          fix: "Check the network or the proxy (HTTPS_PROXY).",
        }),
        c({ id: "claudeLogin", label: "Claude signed in", state: "fail", detail: "logged out" }),
      ]);
    const { state, rerenderWith } = withApp(<DoctorScreen />);
    await screen.findByText("Xray reachable");
    const ask = within(row("Xray reachable")).getByRole("button", { name: "Ask Claude" });
    expect(screen.getAllByRole("button", { name: "Ask Claude" })).toHaveLength(1);
    fireEvent.click(ask);
    expect(state.askAbout).toHaveBeenCalledWith(
      {
        where: "check:xray",
        text: "System check « Xray reachable »: fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)\nTestimus says: Check the network or the proxy (HTTPS_PROXY).",
      },
      "Xray reachable",
    );
    rerenderWith({ info: null });
    expect(screen.getByRole("button", { name: "Ask Claude" })).toHaveAccessibleDescription(
      "Open a project to ask Claude",
    );
  });

  it("a tight fit offers Use anyway beside the lighter pack; accepted, the row is OK with a small Used anyway mark", async () => {
    let accepted = false;
    net.routes["models.acceptFit"] = () => {
      accepted = true;
      return { models: ["a", "b"], verdict: "tight", accepted: true };
    };
    const tight = "Tight: A + B need about 11.7 GB";
    net.routes["system.doctor"] = () =>
      answer([
        accepted
          ? c({ id: "model.fit", label: "Models fit this PC", detail: tight, caution: "Used anyway" })
          : c({
              id: "model.fit",
              label: "Models fit this PC",
              state: "warn",
              detail: tight,
              fix: "Choose a lighter pack.",
              action: { label: "Choose a lighter pack", command: "models.usePack" },
              also: { label: "Use anyway", command: "models.acceptFit" },
            }),
      ]);
    withApp(<DoctorScreen />);
    expect(await screen.findByRole("button", { name: "Choose a lighter pack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use anyway" }));
    await waitFor(() => expect(callsOf("models.acceptFit")).toHaveLength(1));
    await waitFor(() => expect(within(row("Models fit this PC")).getByText("Used anyway")).toBeInTheDocument());
    const r = row("Models fit this PC");
    expect(within(r).getByText("OK")).toBeInTheDocument();
    expect(within(r).queryByRole("button")).toBeNull();
    expect(iconsIn(within(r).getByText("Used anyway"))).toEqual(["alert-triangle"]);
    expect(screen.getByText("1 OK")).toBeInTheDocument();
  });
});
