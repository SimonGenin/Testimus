// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { ProjectSection } from "../../../../src/ui/screens/settings/ProjectSection.tsx";
import { choose, openList } from "../../helpers/select.ts";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, DIR, Fail, fakeNet, info, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

let project = info();

beforeEach(() => {
  fakeNet();
  project = info();
  net.routes["project.info"] = () => project;
  net.routes["project.set"] = (i) => {
    project = { ...project, project: { ...project.project, ...i } };
    return project.project;
  };
  net.routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "# Notes", mtime: 100 });
  net.routes["project.setNotes"] = (i) => ({ file: "C:\\p\\CLAUDE.md", bytes: String(i.text).length, mtime: 200 });
});

afterEach(reset);

const box = (name: string) => screen.getByRole("textbox", { name: label(name) });

describe("Settings › Project", () => {
  it("saves the Jira key upper-cased and the prefix by themselves, only when changed and not empty", async () => {
    mountSettings(<ProjectSection />);
    const key = await waitFor(() => box("Jira project key"));
    expect(key).toHaveValue("LFRPS12");
    fireEvent.blur(key);
    fireEvent.change(key, { target: { value: "   " } });
    fireEvent.blur(key);
    await new Promise((r) => setTimeout(r, 450));
    expect(calls("project.set")).toHaveLength(0);
    fireEvent.change(key, { target: { value: " bhptcc " } });
    await waitFor(() => expect(inputs("project.set")).toEqual([{ jiraProject: "BHPTCC" }]), { timeout: 1500 });
    await waitFor(() => expect(box("Jira project key")).toHaveValue("BHPTCC"));
    expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);

    const prefix = box("Review label prefix");
    fireEvent.change(prefix, { target: { value: "  " } });
    fireEvent.blur(prefix);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls("project.set")).toHaveLength(1);
    fireEvent.change(prefix, { target: { value: "tm-" } });
    fireEvent.blur(prefix);
    await waitFor(() => expect(inputs("project.set")[1]).toEqual({ labelPrefix: "tm-" }));
    await waitFor(() => expect(screen.getByText(/tm-validated, tm-to-fix/)).toBeInTheDocument());
  });

  it("names the project, saved by the field", async () => {
    mountSettings(<ProjectSection />);
    const name = await waitFor(() => box("Name"));
    expect(name).toHaveValue("RATP Sosie");
    fireEvent.change(name, { target: { value: "Sosie" } });
    fireEvent.blur(name);
    await waitFor(() => expect(inputs("project.set")).toEqual([{ name: "Sosie" }]));
  });

  it("a name emptied to type another keeps the empty box and says why nothing is saved", async () => {
    mountSettings(<ProjectSection />);
    const name = await waitFor(() => box("Name"));
    fireEvent.change(name, { target: { value: "" } });
    await new Promise((r) => setTimeout(r, 500));
    expect(box("Name")).toHaveValue("");
    expect(calls("project.set")).toHaveLength(0);
    expect(screen.getByText(/A project needs a name/)).toBeInTheDocument();
    fireEvent.change(box("Name"), { target: { value: "N" } });
    expect(box("Name")).toHaveValue("N");
    expect(screen.queryByText(/A project needs a name/)).not.toBeInTheDocument();
    await waitFor(() => expect(inputs("project.set")).toEqual([{ name: "N" }]), { timeout: 1500 });
    await waitFor(() => expect(box("Name")).toHaveValue("N"));
  });

  it("a Jira project key and a label prefix typed but not blurred are saved when Settings goes, once", async () => {
    const r = mountSettings(<ProjectSection />);
    fireEvent.change(await waitFor(() => box("Jira project key")), { target: { value: "bhptcc" } });
    fireEvent.change(box("Review label prefix"), { target: { value: "tm-" } });
    expect(calls("project.set")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(calls("project.set")).toHaveLength(2));
    expect(inputs("project.set")).toEqual([{ jiraProject: "BHPTCC" }, { labelPrefix: "tm-" }]);
    await new Promise((res) => setTimeout(res, 450));
    expect(calls("project.set")).toHaveLength(2);
  });

  it("saves the language at once and shows a language outside the list", async () => {
    project = info({ language: "de" });
    mountSettings(<ProjectSection />);
    const lang = await waitFor(() => screen.getByRole("combobox", { name: "Language of the tests" }));
    expect(lang).toHaveTextContent("de");
    expect(within(openList(lang)).getByRole("option", { name: "de" })).toHaveAttribute("aria-selected", "true");
    choose(lang, "English");
    await waitFor(() => expect(inputs("project.set")).toEqual([{ language: "en" }]));
    expect(lang).toHaveTextContent("English");
  });

  it("a refused language is put back and said", async () => {
    net.routes["project.set"] = () => {
      throw new Fail("Refused.");
    };
    mountSettings(<ProjectSection />);
    const lang = await waitFor(() => screen.getByRole("combobox", { name: "Language of the tests" }));
    choose(lang, "English");
    expect(await screen.findByText("Could not save the language")).toBeInTheDocument();
    await waitFor(() => expect(lang).toHaveTextContent("Français"));
  });

  it("falls back on empty values; without a project nothing is asked", async () => {
    project = info({ jiraProject: undefined, labelPrefix: undefined });
    mountSettings(<ProjectSection />);
    await waitFor(() => expect(box("Jira project key")).toHaveValue(""));
    expect(box("Review label prefix")).toHaveValue("testimus-");
    reset();
    fakeNet();
    mountSettings(<ProjectSection />, { info: null });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(calls("project.info")).toHaveLength(0);
  });

  it("shows the project folder, revealed in Explorer by the desktop app only", async () => {
    mountSettings(<ProjectSection />);
    expect(await screen.findByText(DIR)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
    reset();
    fakeNet();
    net.routes["project.info"] = () => info();
    const d = fakeDesktop();
    mountSettings(<ProjectSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith(DIR));
  });
});

describe("Settings › Project notes (CLAUDE.md)", () => {
  it("loads the notes, saves them 400 ms after typing against the version read, flushes on blur", async () => {
    let answer = () => {};
    net.routes["project.notes"] = () =>
      new Promise((r) => {
        answer = () => r({ file: "C:\\p\\CLAUDE.md", text: "# Notes", mtime: 100 });
      });
    mountSettings(<ProjectSection />);
    const notes = await screen.findByRole("textbox", { name: label("Project notes") });
    expect(notes).toBeDisabled();
    answer();
    await waitFor(() => expect(notes).toHaveValue("# Notes"));
    expect(notes).toBeEnabled();
    expect(screen.getByText("C:\\p\\CLAUDE.md")).toBeInTheDocument();
    fireEvent.change(notes, { target: { value: "# Notes\nPCC" } });
    expect(calls("project.setNotes")).toHaveLength(0);
    await waitFor(() => expect(calls("project.setNotes")).toHaveLength(1), { timeout: 1500 });
    expect(inputs("project.setNotes")[0]).toEqual({ text: "# Notes\nPCC", ifMtime: 100 });
    fireEvent.change(notes, { target: { value: "# Notes\nPCC\nSAE" } });
    fireEvent.blur(notes);
    await waitFor(() => expect(calls("project.setNotes")).toHaveLength(2));
    expect(inputs("project.setNotes")[1]).toEqual({ text: "# Notes\nPCC\nSAE", ifMtime: 200 });
  });

  it("a change on disk meanwhile is a conflict: Keep mine sends it without the version", async () => {
    net.routes["project.setNotes"] = (i) => {
      if (i.ifMtime !== undefined) throw new Fail("CLAUDE.md changed on disk.", { status: 409, code: "conflict" });
      return { file: "C:\\p\\CLAUDE.md", bytes: 1, mtime: 300 };
    };
    mountSettings(<ProjectSection />);
    const notes = await screen.findByRole("textbox", { name: label("Project notes") });
    await waitFor(() => expect(notes).toBeEnabled());
    fireEvent.change(notes, { target: { value: "mine" } });
    fireEvent.blur(notes);
    expect(await screen.findByText("This file changed on disk while you were editing it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(inputs("project.setNotes").at(-1)).toEqual({ text: "mine" }));
  });

  it("a failed save says so and offers Retry; a failed load leaves an empty field", async () => {
    net.routes["project.setNotes"] = () => {
      throw new Fail("Disk full.");
    };
    mountSettings(<ProjectSection />);
    const notes = await screen.findByRole("textbox", { name: label("Project notes") });
    await waitFor(() => expect(notes).toBeEnabled());
    fireEvent.change(notes, { target: { value: "x" } });
    fireEvent.blur(notes);
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    net.routes["project.setNotes"] = () => ({ file: "C:\\p\\CLAUDE.md", bytes: 1, mtime: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls("project.setNotes")).toHaveLength(2));
    reset();
    fakeNet();
    net.routes["project.info"] = () => info();
    mountSettings(<ProjectSection />);
    const again = await screen.findByRole("textbox", { name: label("Project notes") });
    await waitFor(() => expect(again).toBeEnabled());
    expect(again).toHaveValue("");
    expect(screen.getByText("CLAUDE.md", { selector: "span span" })).toBeInTheDocument();
  });

  it("notes typed in one project are written to that project, never to the next one", async () => {
    const r = mountSettings(<ProjectSection />);
    const notes = await screen.findByRole("textbox", { name: label("Project notes") });
    await waitFor(() => expect(notes).toBeEnabled());
    fireEvent.change(notes, { target: { value: "for p" } });
    setProject("C:\\other");
    r.unmount();
    await waitFor(() => expect(calls("project.setNotes")).toHaveLength(1));
    expect(calls("project.setNotes")[0].project).toBe(DIR);
  });
});
