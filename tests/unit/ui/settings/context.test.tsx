// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextSection } from "../../../../src/ui/screens/settings/ContextSection.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";
import { Fail, fakeNet, mountSettings, net, reset } from "./helpers.tsx";

const PROMPTS = [
  {
    id: "skill:generate-tests",
    name: "Generate tests",
    group: "Generation",
    origin: "skill",
    path: ".claude/skills/generate-tests/SKILL.md",
    file: "C:\\p\\.claude\\skills\\generate-tests\\SKILL.md",
    usedBy: ["Generate", "gen.tests"],
    text: "---\nname: generate-tests\n---\n\n# Generate tests\n\nEvery expected result has a source.",
  },
  {
    id: "generate",
    name: "Generation request",
    group: "Generation",
    origin: "built",
    usedBy: ["Generate", "gen.tests"],
    text: 'Use the generate-tests skill.\n\nRequest: {request}\n{ "tests": [] } { id, page }\n{contexts}',
  },
  {
    id: "skill:check-test",
    name: "Check test",
    group: "Check and fix",
    origin: "skill",
    path: ".claude/skills/check-test/SKILL.md",
    file: "C:\\p\\.claude\\skills\\check-test\\SKILL.md",
    usedBy: ["check.run"],
    text: "# Check a test\n\nReport only what the passages prove.",
  },
  {
    id: "file:CLAUDE.md",
    name: "Project rules",
    group: "Every run",
    origin: "file",
    path: "CLAUDE.md",
    file: "C:\\p\\CLAUDE.md",
    usedBy: ["Every Claude run in this project folder"],
    text: "# Project rules\n\nAnswer in French.",
  },
];

const writeText = vi.fn(async (_s: string) => {});

beforeEach(() => {
  fakeNet();
  net.routes["claude.prompts"] = () => PROMPTS;
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  reset();
  noDesktop();
});

const list = () => screen.getByRole("listbox", { name: "What Claude is given" });
const card = (name: string) => screen.getByRole("region", { name });

describe("Settings › Context", () => {
  it("lists everything Claude is given by use, with where it comes from, and shows the first in full", async () => {
    mountSettings(<ContextSection />);
    const rows = await within(list()).findAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Generate testsSkillgenerate-tests",
      "Generation requestBuilt by Testimusper run",
      "Check testSkillcheck-test",
      "Project rulesFileCLAUDE.md",
    ]);
    expect(within(list()).getByText("Generation")).toBeInTheDocument();
    expect(within(list()).getByText("Every run")).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Generate tests" })).toBeInTheDocument();
    expect(screen.getByText("Used by: Generate · gen.tests")).toBeInTheDocument();
    expect(screen.getByText(".claude/skills/generate-tests/SKILL.md")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Text of Generate tests" })).toHaveTextContent(
      "Every expected result has a source.",
    );
  });

  it("a built prompt shows its template and names the parts filled per run", async () => {
    mountSettings(<ContextSection />);
    fireEvent.click(await within(list()).findByRole("option", { name: /Generation request/ }));
    expect(screen.getByRole("group", { name: "Text of Generation request" })).toHaveTextContent("Request: {request}");
    expect(screen.getByText("Built per run — not a file")).toBeInTheDocument();
    expect(
      screen.getByText("Built by Testimus for each run: the parts in braces are filled then — {request}, {contexts}."),
    ).toBeInTheDocument();
  });

  it("filters by name and by a word of the text, accents and case aside; says when nothing matches", async () => {
    mountSettings(<ContextSection />);
    await within(list()).findAllByRole("option");
    const filter = screen.getByRole("searchbox", { name: "Filter prompts" });
    fireEvent.change(filter, { target: { value: "PASSAGES prove" } });
    await waitFor(() => expect(within(list()).getAllByRole("option")).toHaveLength(1));
    expect(within(list()).getByRole("option", { name: /Check test/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Check test" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "GÉNÉRATION réquest" } });
    await waitFor(() => expect(within(list()).getAllByRole("option")).toHaveLength(1));
    expect(within(list()).getByRole("option", { name: /Generation request/ })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "nowhere-at-all" } });
    expect(await screen.findByText("Nothing matches “nowhere-at-all”.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Text of / })).toBeNull();
  });

  it("copies the whole text; no Show in Explorer in the browser", async () => {
    mountSettings(<ContextSection />);
    await within(list()).findAllByRole("option");
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPTS[0].text));
    expect(await screen.findByText("“Generate tests” copied")).toBeInTheDocument();
  });

  it("in the desktop app, Show in Explorer opens the file; a prompt built per run has none", async () => {
    const d = fakeDesktop();
    mountSettings(<ContextSection />);
    fireEvent.click(await within(list()).findByRole("option", { name: /Project rules/ }));
    fireEvent.click(within(card("Project rules")).getByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p\\CLAUDE.md"));
    fireEvent.click(within(list()).getByRole("option", { name: /Generation request/ }));
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
  });

  it("says when the list cannot be read", async () => {
    net.routes["claude.prompts"] = () => {
      throw new Fail("No project is open.");
    };
    mountSettings(<ContextSection />);
    expect(await screen.findByText("What Claude is given could not be read")).toBeInTheDocument();
    expect(screen.getByText("No project is open.")).toBeInTheDocument();
  });
});
