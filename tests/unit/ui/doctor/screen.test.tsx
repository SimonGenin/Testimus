// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DoctorScreen } from "../../../../src/ui/screens/doctor/DoctorScreen.tsx";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status, withApp } from "../../cov-uishell-helpers.tsx";
import { fakeDesktop, noDesktop } from "../../ui-desktop-helpers.tsx";

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
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Proxy")).toBeInTheDocument());
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
});
