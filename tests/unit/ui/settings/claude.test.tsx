// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { exeLine } from "../../../../src/ui/screens/settings/ClaudeProgram.tsx";
import { ClaudeSection } from "../../../../src/ui/screens/settings/ClaudeSection.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { choose } from "../../helpers/select.ts";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, Fail, fakeJob, fakeNet, info, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

const base = { claude: { exe: "" }, models: { allowRemote: true }, projects: [], lastProject: "" };
let settings: Record<string, unknown> = base;
let project = info();

const claude = (c: Record<string, unknown> = {}) =>
  info({ claude: { model: "sonnet", effort: "medium", presets: [], contexts: [], ...c } });

beforeEach(() => {
  fakeNet();
  settings = { ...base };
  project = claude();
  net.routes["project.info"] = () => project;
  net.routes["project.set"] = (i) => {
    const c = (i.claude ?? {}) as Record<string, unknown>;
    project = { ...project, project: { ...project.project, claude: { ...(project.project.claude as object), ...c } } };
    return project.project;
  };
  net.routes["system.settings"] = () => settings;
  net.routes["system.set"] = (i) => {
    settings = {
      ...settings,
      ...(i.claudeExe !== undefined ? { claude: { exe: i.claudeExe } } : {}),
      agents: {
        ...((settings.agents ?? {}) as object),
        ...(i.agentsMax !== undefined ? { max: i.agentsMax } : {}),
        ...(i.agentsAdaptive !== undefined ? { adaptive: i.agentsAdaptive } : {}),
      },
    };
    return settings;
  };
  net.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" });
});

afterEach(reset);

const exeField = () => screen.getByLabelText(label("Claude program"));

describe("Settings › Claude › Connection", () => {
  it("exeLine says found or not found", () => {
    const s = (o: Record<string, unknown>) => o as Parameters<typeof exeLine>[0];
    expect(exeLine(s({ installed: true, version: "2.1.0", signedIn: true }))).toBe("2.1.0");
    expect(exeLine(s({ installed: true, signedIn: null }))).toBe("Claude Code");
    expect(exeLine(s({ installed: false, signedIn: false, detail: "spawn ENOENT\nmore" }))).toBe(
      "spawn ENOENT · Claude is optional",
    );
    expect(exeLine(s({ installed: false, signedIn: false }))).toMatch(/claude did not answer/);
  });

  it("without a project: the Claude program only, saved when left, checked on Enter; a failed check shows how to connect", async () => {
    settings = { ...base, claude: { exe: "C:/c.exe" } };
    net.routes["claude.status"] = (i) => {
      if (i.refresh) throw new Fail("spawn failed");
      return { installed: true, version: "2.0", signedIn: true };
    };
    const { app } = mountSettings(<ClaudeSection />, { info: null });
    expect(await screen.findByText("2.0")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Found2.0");
    expect(iconsIn(screen.getByText("Found"))).toEqual(["check-circle"]);
    expect(screen.queryByText("Default model")).toBeNull();
    expect(calls("project.info")).toHaveLength(0);
    const exe = exeField();
    await waitFor(() => expect(exe).toHaveValue("C:/c.exe"));
    fireEvent.blur(exe);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("system.set")).toHaveLength(0);
    fireEvent.change(exe, { target: { value: "D:/claude.cmd" } });
    await new Promise((r) => setTimeout(r, 450));
    expect(calls("system.set")).toHaveLength(0);
    fireEvent.keyDown(exe, { key: "Enter" });
    expect(await screen.findByText(/spawn failed · Claude is optional/)).toBeInTheDocument();
    expect(inputs("system.set")[0]).toEqual({ claudeExe: "D:/claude.cmd" });
    fireEvent.click(screen.getByRole("button", { name: "Open the system check" }));
    expect(app.navigate).toHaveBeenCalledWith("doctor");
    net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
  });

  it("a check whose save fails checks nothing; Check spins while claude --version runs", async () => {
    settings = { ...base, claude: { exe: "X:/old.exe" } };
    net.routes["system.set"] = () => {
      throw new Fail("Not writable.");
    };
    mountSettings(<ClaudeSection />, { info: null });
    const exe = exeField();
    await waitFor(() => expect(exe).toHaveValue("X:/old.exe"));
    await screen.findByText("2.1.0");
    fireEvent.change(exe, { target: { value: "X:/c.exe" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(calls("claude.status").filter((c) => c.input.refresh)).toHaveLength(0);
    net.routes["system.set"] = () => ({ ...base, claude: { exe: "" } });
    let answer = (_v: unknown) => {};
    net.routes["claude.status"] = (i) =>
      i.refresh ? new Promise((r) => (answer = r)) : { installed: true, version: "2.1.0", signedIn: null };
    fireEvent.change(exe, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Running claude --version…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toHaveAttribute("aria-busy", "true");
    answer({ installed: true, signedIn: true });
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
  });

  it("checks the Claude program and shows how to connect it when not found", async () => {
    mountSettings(<ClaudeSection />, { info: null });
    expect(await screen.findByText("2.1.0")).toBeInTheDocument();
    net.routes["claude.status"] = (i) => {
      expect(i).toEqual({ refresh: true });
      return { installed: false, signedIn: false, exe: "C:\\x\\claude.cmd", detail: "spawn ENOENT" };
    };
    await waitFor(() => expect(calls("system.settings")).toHaveLength(1));
    fireEvent.change(exeField(), { target: { value: "C:\\x\\claude.cmd" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("spawn ENOENT · Claude is optional")).toBeInTheDocument();
    expect(inputs("system.set")[0]).toEqual({ claudeExe: "C:\\x\\claude.cmd" });
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
  });

  it("a Claude program path typed but not left is saved when Settings goes, once, as in Xray Editor", async () => {
    const r = mountSettings(<ClaudeSection />, { info: null });
    await waitFor(() => expect(calls("system.settings")).toHaveLength(1));
    await screen.findByText("2.1.0");
    fireEvent.change(exeField(), { target: { value: "D:\\tools\\claude.cmd" } });
    expect(calls("system.set")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(calls("system.set")).toHaveLength(1));
    expect(inputs("system.set")[0]).toEqual({ claudeExe: "D:\\tools\\claude.cmd" });
    const again = mountSettings(<ClaudeSection />, { info: null });
    await screen.findByText("2.1.0");
    again.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(calls("system.set")).toHaveLength(1);
  });

  it("Browse… picks claude.exe, saves it, then checks it; a cancel does nothing", async () => {
    const d = fakeDesktop({ files: [] });
    mountSettings(<ClaudeSection />, { info: null });
    const browse = await screen.findByRole("button", { name: "Browse…" });
    await waitFor(() => expect(browse).toBeEnabled());
    fireEvent.click(browse);
    await waitFor(() => expect(d.pickFiles).toHaveBeenCalledTimes(1));
    expect(calls("system.set")).toHaveLength(0);
    d.pickFiles.mockResolvedValue(["C:\\Users\\me\\.local\\bin\\claude.exe"]);
    fireEvent.click(browse);
    await waitFor(() =>
      expect(inputs("system.set")).toEqual([{ claudeExe: "C:\\Users\\me\\.local\\bin\\claude.exe" }]),
    );
    await waitFor(() => expect(calls("claude.status").at(-1)?.input).toEqual({ refresh: true }));
    expect(d.pickFiles).toHaveBeenLastCalledWith({
      title: "Choose the Claude program",
      filters: [],
      multiple: false,
    });
    await waitFor(() => expect(exeField()).toHaveValue("C:\\Users\\me\\.local\\bin\\claude.exe"));
  });

  it("without the bridge: the text field and Check only", async () => {
    mountSettings(<ClaudeSection />, { info: null });
    expect(exeField()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse/ })).toBeNull();
    await screen.findByText("2.1.0");
  });
});

describe("Settings › Claude › agents at once", () => {
  it("saves the maximum when left (refusing a number out of range) and the adapting at once", async () => {
    mountSettings(<ClaudeSection />);
    const max = screen.getByRole("textbox", { name: label("Agents at once") });
    await waitFor(() => expect(max).toBeEnabled());
    expect(max).toHaveValue("5");
    fireEvent.change(max, { target: { value: "40" } });
    expect(screen.getByText("A number from 1 to 32")).toBeInTheDocument();
    fireEvent.blur(max);
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(calls("system.set")).toHaveLength(0);
    fireEvent.change(max, { target: { value: "8" } });
    fireEvent.keyDown(max, { key: "Enter" });
    fireEvent.blur(max);
    await waitFor(() => expect(inputs("system.set")[0]).toEqual({ agentsMax: 8 }));
    const adapt = screen.getByRole("switch", { name: "Adapt to the PC's load" });
    expect(adapt).toBeChecked();
    fireEvent.click(adapt);
    await waitFor(() => expect(inputs("system.set")[1]).toEqual({ agentsAdaptive: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Adapt to the PC's load" })).not.toBeChecked());
  });

  it("tests the PC's limits in a job, says what it found and shows the last test", async () => {
    const measured = {
      limit: 10,
      at: "2026-11-03T16:00:00.000Z",
      reason: "With 12 agents the CPU is at 96 %",
      levels: [],
    };
    const j = fakeJob({ id: "agents-0000000a", kind: "agents-test" });
    net.routes["system.testAgents"] = () => ({ jobId: j.id });
    mountSettings(<ClaudeSection />);
    const test = await screen.findByRole("button", { name: "Test this PC's limits" });
    await waitFor(() => expect(test).toBeEnabled());
    fireEvent.click(test);
    expect(await screen.findByText("Measuring the PC at rest")).toBeInTheDocument();
    await j.progress("4 agents: CPU 60 %");
    expect(await screen.findByText("4 agents: CPU 60 %")).toBeInTheDocument();
    expect(iconsIn(screen.getByRole("button", { name: "Cancel" }))).toEqual(["stop"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: j.id }]));
    settings = { ...settings, agents: { max: 10, measured } };
    await j.finish({ status: "done", result: { ...measured, applied: true } });
    expect(await screen.findByText("Maximum set to 10 agents")).toBeInTheDocument();
    expect(
      await screen.findByText("Last test: 10 agents on 03/11/2026 — With 12 agents the CPU is at 96 %"),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByRole("textbox", { name: label("Agents at once") })).toHaveValue("10"));
    expect(screen.getByRole("button", { name: "Test this PC's limits" })).toBeEnabled();
  });

  it("a test refused at start, or failing, says so", async () => {
    net.routes["system.testAgents"] = () => {
      throw new Fail("The project has no index yet.");
    };
    mountSettings(<ClaudeSection />);
    const test = await screen.findByRole("button", { name: "Test this PC's limits" });
    await waitFor(() => expect(test).toBeEnabled());
    fireEvent.click(test);
    expect(await screen.findByText("The test of this PC's limits stopped")).toBeInTheDocument();
    const j = fakeJob({ id: "agents-0000000b", kind: "agents-test" });
    net.routes["system.testAgents"] = () => ({ jobId: j.id });
    fireEvent.click(screen.getByRole("button", { name: "Test this PC's limits" }));
    await screen.findByText("Measuring the PC at rest");
    await j.finish({ status: "failed", error: "The search server did not start." });
    expect(await screen.findByText("The search server did not start.")).toBeInTheDocument();
  });

  it("is off without a project", () => {
    mountSettings(<ClaudeSection />, { info: null });
    expect(screen.getByRole("button", { name: "Test this PC's limits" })).toBeDisabled();
  });

  it("finds a test still running when the section opens again, and cannot start a second one", async () => {
    const j = fakeJob({ id: "agents-0000000c", kind: "agents-test" });
    net.routes["system.testAgents"] = () => ({ jobId: j.id });
    const first = mountSettings(<ClaudeSection />);
    const test = await screen.findByRole("button", { name: "Test this PC's limits" });
    await waitFor(() => expect(test).toBeEnabled());
    fireEvent.click(test);
    await screen.findByText("Measuring the PC at rest");
    first.unmount();
    const again = mountSettings(<ClaudeSection />);
    expect(await screen.findByText("Measuring the PC at rest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Testing…" })).toBeDisabled();
    again.unmount();
    clearDrafts();
    net.routes["jobs.list"] = () => [{ id: j.id, kind: "agents-test", subject: "", status: "running", startedAt: "" }];
    mountSettings(<ClaudeSection />);
    expect(await screen.findByText("Measuring the PC at rest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Testing…" })).toBeDisabled();
    expect(calls("system.testAgents")).toHaveLength(1);
  });
});

describe("Settings › Claude › dock defaults, quick asks", () => {
  it("model and effort are saved at once", async () => {
    mountSettings(<ClaudeSection />);
    choose(await screen.findByLabelText("Default model"), "opus");
    await waitFor(() => expect(inputs("project.set")[0]).toEqual({ claude: { model: "opus" } }));
    choose(screen.getByRole("combobox", { name: "Default effort" }), "Max");
    await waitFor(() => expect(inputs("project.set")[1]).toEqual({ claude: { effort: "max" } }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Default effort" })).toHaveTextContent("Max"));
    const wrap = (el: HTMLElement) => el.parentElement?.getAttribute("class");
    expect(wrap(screen.getByLabelText("Default model"))).toBe(
      wrap(screen.getByRole("combobox", { name: "Default effort" })),
    );
  });

  it("a model saved before that the list does not know is shown as it is, with no field to type one", async () => {
    project = claude({ model: "claude-opus-4-1" });
    mountSettings(<ClaudeSection />);
    const model = await screen.findByLabelText("Default model");
    expect(model).toHaveTextContent("claude-opus-4-1");
    expect(screen.queryByRole("textbox", { name: "Custom model" })).toBeNull();
    choose(model, "fable");
    await waitFor(() => expect(inputs("project.set")).toEqual([{ claude: { model: "fable" } }]));
  });

  it("quick asks: edited in place (both a chip and a prompt), removed by place, added", async () => {
    project = claude({
      presets: [
        { label: "Same", prompt: "one" },
        { label: "Same", prompt: "two" },
      ],
    });
    mountSettings(<ClaudeSection />);
    const second = await screen.findByRole("group", { name: "Quick ask 2" });
    const chip = within(second).getByRole("textbox", { name: label("Chip") });
    fireEvent.change(chip, { target: { value: "  " } });
    fireEvent.blur(chip);
    expect(await within(second).findByText("Not saved")).toBeInTheDocument();
    expect(calls("project.set")).toHaveLength(0);
    fireEvent.change(chip, { target: { value: " Other " } });
    fireEvent.blur(chip);
    await waitFor(() =>
      expect(inputs("project.set")[0]).toEqual({
        claude: {
          presets: [
            { label: "Same", prompt: "one" },
            { label: "Other", prompt: "two" },
          ],
        },
      }),
    );
    const prompt = within(screen.getByRole("group", { name: "Quick ask 1" })).getByRole("textbox", {
      name: label("Prompt"),
    });
    fireEvent.change(prompt, { target: { value: " Do it " } });
    fireEvent.blur(prompt);
    await waitFor(() =>
      expect(inputs("project.set")[1]).toEqual({
        claude: {
          presets: [
            { label: "Same", prompt: "Do it" },
            { label: "Other", prompt: "two" },
          ],
        },
      }),
    );
    expect(iconsIn(screen.getByRole("button", { name: "Remove quick ask 1" }))).toEqual(["trash"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove quick ask 1" }));
    const sure = await screen.findByRole("alertdialog", { name: "Remove the quick ask « Same »?" });
    expect(sure).toHaveTextContent("Its prompt is lost");
    expect(calls("project.set")).toHaveLength(2);
    fireEvent.click(within(sure).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(inputs("project.set")[2]).toEqual({ claude: { presets: [{ label: "Other", prompt: "two" }] } }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add a quick ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a quick ask" }));
    const form = screen.getByRole("group", { name: "New quick ask" });
    const add = within(form).getByRole("button", { name: "Add the quick ask" });
    expect(add).toBeDisabled();
    fireEvent.change(within(form).getByRole("textbox", { name: label("Chip") }), { target: { value: " New " } });
    fireEvent.change(within(form).getByRole("textbox", { name: label("Prompt") }), { target: { value: " Do " } });
    fireEvent.click(add);
    await waitFor(() =>
      expect(inputs("project.set")[3]).toEqual({
        claude: {
          presets: [
            { label: "Other", prompt: "two" },
            { label: "New", prompt: "Do" },
          ],
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("group", { name: "New quick ask" })).toBeNull());
  });

  it("no quick ask reads as none; a refused change is said", async () => {
    project = claude({ presets: undefined });
    net.routes["project.set"] = () => {
      throw new Fail("Refused.");
    };
    mountSettings(<ClaudeSection />);
    expect(await screen.findByText("No quick ask yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a quick ask" }));
    const form = screen.getByRole("group", { name: "New quick ask" });
    fireEvent.change(within(form).getByRole("textbox", { name: label("Chip") }), { target: { value: "A" } });
    fireEvent.change(within(form).getByRole("textbox", { name: label("Prompt") }), { target: { value: "B" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add the quick ask" }));
    expect(await screen.findByText("Could not save the quick asks")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "New quick ask" })).toBeInTheDocument();
  });

  it("holds no default contexts any more: they are set in Settings › Context, and the saved contexts are not read here", async () => {
    project = claude({ contexts: ["house"] });
    mountSettings(<ClaudeSection />);
    expect(await screen.findByRole("region", { name: "Quick asks" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Contexts" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Default contexts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage contexts…" })).toBeNull();
    expect(calls("contexts.list")).toHaveLength(0);
  });
});

describe("Settings › Claude › How the documents fit together", () => {
  it("turns it on and off, and gives it to every run only while on", async () => {
    const { app } = mountSettings(<ClaudeSection />);
    const on = await screen.findByRole("switch", { name: /Claude writes it and updates it after each import/ });
    expect(on).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /Give it to every Claude run/ })).toBeDisabled();
    fireEvent.click(on);
    await waitFor(() =>
      expect(inputs("project.set").at(-1)).toEqual({ claude: { overview: { enabled: true, inEveryRun: true } } }),
    );
    await waitFor(() => expect(screen.getByRole("switch", { name: /Give it to every Claude run/ })).toBeChecked());
    fireEvent.click(screen.getByRole("switch", { name: /Give it to every Claude run/ }));
    await waitFor(() =>
      expect(inputs("project.set").at(-1)).toEqual({ claude: { overview: { enabled: true, inEveryRun: false } } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(app.navigate).toHaveBeenCalledWith("documents", "~overview");
  });
});
