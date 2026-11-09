// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("Settings › Project and CLAUDE.md", () => {
  it("the page edits no CLAUDE.md and does not read it: the Context page shows it", async () => {
    mountSettings(<ProjectSection />);
    await screen.findByRole("textbox", { name: label("Name") });
    expect(screen.queryByRole("textbox", { name: label("Project notes") })).not.toBeInTheDocument();
    expect(screen.queryByText("CLAUDE.md")).not.toBeInTheDocument();
    expect(calls("project.notes")).toHaveLength(0);
  });
});
