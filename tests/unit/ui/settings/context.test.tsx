// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextSection } from "../../../../src/ui/screens/settings/ContextSection.tsx";
import { entriesOf, heldChars, matches, slots, tokens } from "../../../../src/ui/screens/settings/given.ts";
import { choose } from "../../helpers/select.ts";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, DIR, Fail, fakeNet, info, inputs, mountSettings, net, reset } from "./helpers.tsx";

const TAKES = {
  overview: true,
  documents: true,
  contexts: "The contexts of what the run is about, unless the user picks others for the run",
  tools: ["tests_list", "tests_save", "rag_search", "docs_show"],
  files: ["Read", "Glob", "Grep", "Skill"],
};

const GENERATE =
  'Use the generate-tests skill.\n\nRequest: {request}\n{ "tests": [] } { id, page }\n{given}\nReply with a gen-report block.';

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
    text: GENERATE,
    kind: "generate",
    answers: "The tests, saved with tests_save, and a gen-report block: what was written and what was left out.",
    takes: TAKES,
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
    id: "sign-in",
    name: "Sign-in probe",
    group: "System check",
    origin: "built",
    usedBy: ["System check"],
    text: "Reply {word}.",
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
  {
    id: "context:house",
    name: "House style",
    group: "Every run",
    origin: "context",
    path: "C:/lib/contexts/house/context.md",
    file: "C:\\lib\\contexts\\house\\context.md",
    usedBy: ["A default of the project"],
    text: "Imperative mood, one action per step.",
  },
];

const piece = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  kind,
  name,
  why: `why ${id}`,
  how: "inline",
  locked: false,
  on: true,
  chars: 0,
  ...over,
});

const PIECES = [
  piece("instruction", "instruction", "Generation request", {
    why: "What Testimus asks of this run, with your request",
    locked: true,
    chars: 800,
    text: GENERATE,
  }),
  piece("skill:generate-tests", "skill", "Generate tests", {
    why: "The method of the job: the instruction names it",
    how: "auto",
    locked: true,
    chars: 2400,
    path: ".claude/skills/generate-tests/SKILL.md",
    text: "# Generate tests\n\nEvery expected result has a source.",
  }),
  piece("rules", "rules", "Project rules", {
    why: "CLAUDE.md of the project folder",
    how: "auto",
    locked: true,
    chars: 1200,
    path: "CLAUDE.md",
    text: "# Project rules\n\nAnswer in French.",
  }),
  piece("tools", "tools", "4 tools of the app", { how: "auto", locked: true, detail: "Read, tests_list" }),
  piece("context:house", "context", "House style", {
    why: "A default of the project",
    chars: 400,
    path: "C:/lib/contexts/house/context.md",
    detail: "1 file",
    text: "Imperative mood, one action per step.",
  }),
  piece("context:gloss", "context", "Untitled context", {
    why: "Saved, not attached",
    how: "pointer",
    on: false,
    chars: 90,
  }),
  piece("doc:D401", "document", "Traction", {
    why: "Converted: Claude may search it",
    how: "search",
    chars: 120000,
    detail: "version 3",
  }),
];

type Saved = { id: string; name: string; notes: string; paths: string[]; files: string[]; shared?: boolean };

let project = info();
let saved: Saved[] = [];
let byTests: string[] = [];

const defaults = () => (project.project.claude as { contexts: string[] }).contexts;

const summary = (c: Saved) => ({
  id: c.id,
  name: c.name,
  paths: c.paths,
  files: c.files,
  hasNotes: !!c.notes,
  ...(c.shared ? { shared: true } : {}),
});
const detail = (c: Saved) => ({ ...summary(c), notes: c.notes, mtime: 1 });
const find = (id: unknown) => {
  const c = saved.find((x) => x.id === id);
  if (!c) throw new Fail(`No context ${id}`);
  return c;
};

const HOUSE: Saved = {
  id: "house",
  name: "House style",
  notes: "Imperative mood, one action per step.",
  paths: [],
  files: [],
  shared: true,
};
const GLOSS: Saved = { id: "gloss", name: "", notes: "", paths: [], files: ["plan.pdf"] };

const writeText = vi.fn(async (_s: string) => {});

beforeEach(() => {
  fakeNet();
  project = info({ claude: { model: "sonnet", effort: "medium", presets: [], contexts: ["house"] } });
  saved = [{ ...HOUSE }, { ...GLOSS }];
  byTests = [];
  net.routes["claude.prompts"] = () => PROMPTS;
  net.routes["claude.preview"] = (i) => ({
    use: i.use,
    kind: "generate",
    name: "Generation request",
    answers: "",
    pieces: PIECES,
  });
  net.routes["project.info"] = () => project;
  net.routes["project.set"] = (i) => {
    const c = (i.claude ?? {}) as Record<string, unknown>;
    project = { ...project, project: { ...project.project, claude: { ...(project.project.claude as object), ...c } } };
    return project.project;
  };
  net.routes["contexts.list"] = () => saved.map(summary);
  net.routes["contexts.ofProject"] = () => ({ effective: [...new Set([...defaults(), ...byTests])] });
  net.routes["contexts.show"] = (i) => detail(find(i.id));
  net.routes["contexts.set"] = (i) => {
    const c = find(i.id);
    if (typeof i.name === "string") c.name = i.name;
    if (typeof i.notes === "string") c.notes = i.notes;
    return detail(c);
  };
  net.routes["contexts.create"] = (i) => {
    const c: Saved = { id: "new-1", name: "", notes: "", paths: [], files: [], shared: i.shared === true };
    saved.push(c);
    return detail(c);
  };
  net.routes["contexts.remove"] = (i) => {
    saved = saved.filter((c) => c.id !== i.id);
    return null;
  };
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  reset();
  noDesktop();
});

const list = () => screen.getByRole("tree", { name: "What Claude is given" });
const row = (name: RegExp) => within(list()).getByRole("treeitem", { name });
// ponytail: the list's lines as they read — a group's head (level 1, open or folded, its count) and the rows under it
const lines = () =>
  within(list())
    .getAllByRole("treeitem")
    .map((r) => `${r.getAttribute("aria-level")} ${r.getAttribute("aria-expanded") ?? "-"} ${r.textContent}`);
const items = () =>
  within(list())
    .getAllByRole("treeitem")
    .filter((r) => r.getAttribute("aria-level") === "2");
const head = (label: string) => within(list()).getByRole("treeitem", { name: new RegExp(`^${label}\\s*\\d+$`) });
const card = (name: string) => screen.getByRole("region", { name });
const group = (name: RegExp) => screen.getByRole("region", { name });
const TOUCH = /^What it may touch, what it gives back$/;
// ponytail: a table's rows as they read — the piece and its kind, why, how, the weight — without the words of a tooltip
const rowsOf = (table: string) =>
  within(screen.getByRole("table", { name: table }))
    .getAllByRole("row")
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole("cell")
        .map((c) => {
          const words = c.cloneNode(true) as HTMLElement;
          for (const tip of words.querySelectorAll('[role="tooltip"]')) tip.remove();
          return words.textContent;
        })
        .join(" | "),
    );

async function mount() {
  const r = mountSettings(<ContextSection />);
  await within(list()).findAllByRole("treeitem");
  return r;
}

describe("Settings › Context", () => {
  it("lists this project's contexts first, then what goes with every run, then the runs by use; only the picked one's group is open", async () => {
    await mount();
    expect(lines()).toEqual([
      "1 true This project's contexts2",
      "2 - House styleDefaultShared library · notes",
      "2 - Untitled contextThis project · 1 file",
      "1 true Every run1",
      "2 - Project rulesCLAUDE.md",
      "1 true Generation2",
      "2 - Generate testsSkill",
      "2 - Generation requestRun",
      "1 false Check and fix1",
      "1 false System check1",
    ]);
    expect(within(list()).getAllByRole("treeitem", { name: /House style/ })).toHaveLength(1);
    expect(row(/Generation request/)).toHaveAttribute("aria-selected", "true");
    expect(card("Generation request")).toBeInTheDocument();
    expect(calls("claude.preview").map((c) => c.input)).toEqual([{ use: "generate" }]);
    fireEvent.click(head("Check and fix"));
    expect(head("Check and fix")).toHaveAttribute("aria-expanded", "true");
    expect(head("Generation")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(row(/Check test/));
    expect(card("Check test")).toBeInTheDocument();
    expect(head("Generation")).toHaveAttribute("aria-expanded", "false");
    expect(within(list()).queryByRole("treeitem", { name: /Generation request/ })).toBeNull();
    expect(head("Check and fix")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(head("Check and fix"));
    expect(within(list()).queryByRole("treeitem", { name: /Check test/ })).toBeNull();
    expect(head("This project's contexts")).toHaveAttribute("aria-expanded", "true");
  });

  it("a run's detail says when it is sent, what it weighs, what Claude is asked, what goes with it and why", async () => {
    await mount();
    const run = card("Generation request");
    expect(run).toHaveTextContent("Sent byGenerate · gen.tests");
    expect(run).toHaveTextContent("Kind of rungenerate — it decides the tools and what goes with the run");
    await screen.findByRole("button", { name: /Project rules/ });
    expect(run).toHaveTextContent(
      "WeightClaude holds ~1.2k tokens as the run starts: what is said, loaded or read first. 1 document more to search, never sent whole.",
    );
    expect(rowsOf("What Claude is asked")).toEqual([
      "Generation requestInstruction | What Testimus asks of this run, with your request | Said in full | ~200 tokens · 17 %",
      "Generate testsSkill | The method of the job: the instruction names it | Loaded by Claude Code | ~600 tokens · 50 %",
    ]);
    expect(rowsOf("What goes with it")).toEqual([
      "Project rulesProject file | CLAUDE.md of the project folder | Loaded by Claude Code | ~300 tokens · 25 %",
      "House styleSaved context | A default of the project | Said in full | ~100 tokens · 8 %",
      "Untitled contextSaved context | Saved, not attached | Not sent | ~23 tokens",
    ]);
    const more = screen.getByRole("button", { name: "1 more piece: 1 document" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(rowsOf("What goes with it")).toEqual([
      "Project rulesProject file | CLAUDE.md of the project folder | Loaded by Claude Code | ~300 tokens · 25 %",
      "House styleSaved context | A default of the project | Said in full | ~100 tokens · 8 %",
      "Untitled contextSaved context | Saved, not attached | Not sent | ~23 tokens",
      "TractionDocument | Converted: Claude may search it | Searched | ~30k tokens",
    ]);
    expect(screen.queryByRole("button", { name: /more piece/ })).toBeNull();
    const how = (name: string) =>
      within(screen.getByRole("table", { name: "What goes with it" }))
        .getByText(name)
        .closest("td") as HTMLElement;
    expect(within(how("Searched")).getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "Claude finds passages in it with the search tools: it is never sent whole.",
    );
    expect(within(how("Not sent")).getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "Saved, and not attached to this run.",
    );
    expect(screen.queryByText("4 tools of the app")).toBeNull();
    expect(group(/^What goes with it/)).toHaveTextContent(
      "With the project's defaults: a request may attach or leave out a piece.",
    );
    const rule = within(group(/^What goes with it/))
      .getByText("Saved contexts")
      .closest("dl") as HTMLElement;
    expect(rule).toHaveAccessibleName("What goes with every run of this kind");
    expect(rule).toHaveTextContent(TAKES.contexts);
    expect(rule).toHaveTextContent("Claude is told to read it first, while it is given to every run");
    expect(rule).toHaveTextContent(
      "Searched: every converted document is listed in a request, and one can be left out",
    );
  });

  it("a run's detail says what it may touch and what it gives back", async () => {
    await mount();
    const touch = group(TOUCH);
    expect(touch).toHaveTextContent("Commands of the app4 commands, as tools — nothing else of the app can be called");
    expect(touch).toHaveTextContent("Claude Code's own toolsReadGlobGrepSkill");
    expect(within(touch).queryByText("list · save")).toBeNull();
    fireEvent.click(within(touch).getByRole("button", { name: "The commands it may call · 4" }));
    const commands = within(touch).getByRole("region", { name: "The commands it may call" });
    expect(commands).toHaveTextContent("testslist · save");
    expect(commands).toHaveTextContent("ragsearch");
    expect(commands).toHaveTextContent("docsshow");
    expect(touch).toHaveTextContent(
      "Gives backThe tests, saved with tests_save, and a gen-report block: what was written and what was left out.",
    );
    expect(
      screen.getByText("Built by Testimus for each run: the parts in braces are filled then — {request}, {given}."),
    ).toBeInTheDocument();
    fireEvent.click(within(card("Generation request")).getByRole("button", { name: "Copy the prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GENERATE));
    expect(await screen.findByText("“Generation request” copied")).toBeInTheDocument();
  });

  it("a run that takes neither the documents nor their overview says so, and one that calls nothing has no command list", async () => {
    net.routes["claude.prompts"] = () =>
      PROMPTS.map((p) =>
        p.id === "generate"
          ? { ...p, answers: undefined, takes: { ...TAKES, overview: false, documents: false, tools: [], files: [] } }
          : p,
      );
    await mount();
    const rule = within(group(/^What goes with it/))
      .getByText("Saved contexts")
      .closest("dl") as HTMLElement;
    expect(rule).toHaveTextContent("Not given to this kind of run");
    expect(rule).toHaveTextContent("Not searched: the run works on the files of what it is about");
    const touch = group(TOUCH);
    expect(touch).toHaveTextContent("Commands of the appNone");
    expect(touch).toHaveTextContent("Claude Code's own toolsNone");
    expect(within(touch).queryByRole("button", { name: /The commands it may call/ })).toBeNull();
    expect(within(touch).queryByText("Gives back")).toBeNull();
  });

  it("the run's prompt is shown; a piece picked in a table takes its place and leads to its entry", async () => {
    const { app } = await mount();
    const prompt = group(/^The prompt/);
    expect(prompt).toHaveTextContent("What Testimus asks of this run, with your request");
    expect(prompt).toHaveTextContent("Built per run — not a file");
    expect(screen.getByRole("group", { name: "Text of Generation request" })).toHaveTextContent("Request: {request}");
    expect(within(prompt).queryByRole("button", { name: "Open it in the list" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "1 more piece: 1 document" }));
    fireEvent.click(screen.getByRole("button", { name: /Traction/ }));
    expect(screen.queryByRole("region", { name: /^The prompt/ })).toBeNull();
    const traction = group(/^Traction/);
    expect(traction).toHaveTextContent("Converted: Claude may search it");
    expect(traction).toHaveTextContent("version 3");
    expect(traction).toHaveTextContent("Claude searches it and reads the passages it finds: it is never sent whole.");
    fireEvent.click(within(traction).getByRole("button", { name: "Open the document" }));
    expect(app.navigate).toHaveBeenCalledWith("documents", "D401");
    fireEvent.click(screen.getByRole("button", { name: /Untitled context/ }));
    expect(group(/^Untitled context/)).toHaveTextContent("It has no text of its own.");
    fireEvent.click(screen.getByRole("button", { name: /Project rules/ }));
    expect(screen.getByRole("row", { current: true })).toHaveTextContent("Project rules");
    const rules = group(/^Project rules/);
    expect(rules).toHaveTextContent("CLAUDE.md");
    expect(screen.getByRole("group", { name: "Text of Project rules" })).toHaveTextContent("Answer in French.");
    fireEvent.click(within(rules).getByRole("button", { name: "Open it in the list" }));
    expect(row(/Project rules/)).toHaveAttribute("aria-selected", "true");
    expect(card("Project rules")).toHaveTextContent("Used byEvery Claude run in this project folder");
    fireEvent.click(head("Generation"));
    fireEvent.click(row(/Generation request/));
    fireEvent.click(await screen.findByRole("button", { name: /House style/ }));
    fireEvent.click(within(group(/^House style/)).getByRole("button", { name: "Open it in the list" }));
    expect(row(/House style/)).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("switch", { name: "Default of the project" })).toBeChecked();
  });

  it("a long prompt shows its first lines, and all of it on demand", async () => {
    const long = Array.from({ length: 12 }, (_, n) => `Line ${n + 1} {request}`).join("\n");
    net.routes["claude.prompts"] = () => PROMPTS.map((p) => (p.id === "generate" ? { ...p, text: long } : p));
    const preview = net.routes["claude.preview"];
    net.routes["claude.preview"] = (i) => {
      const r = preview(i) as { pieces: { id: string }[] };
      return { ...r, pieces: r.pieces.map((x) => (x.id === "instruction" ? { ...x, text: long } : x)) };
    };
    await mount();
    await screen.findByRole("table", { name: "What Claude is asked" });
    await screen.findByText(/^Claude holds/);
    const text = () => screen.getByRole("group", { name: "Text of Generation request" });
    expect(text()).toHaveTextContent("Line 8 {request}");
    expect(text()).not.toHaveTextContent("Line 9");
    const all = within(group(/^The prompt/)).getByRole("button", { name: "Show all of it, 12 lines" });
    expect(all).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(all);
    expect(text().textContent).toBe(long);
    expect(screen.queryByRole("button", { name: /Show all of it/ })).toBeNull();
  });

  it("says when a run's pieces cannot be read, and keeps what the list already knows of the run", async () => {
    net.routes["claude.preview"] = () => {
      throw new Fail("No run sends « generate ».");
    };
    await mount();
    expect(await screen.findByText("What this run is given could not be read")).toBeInTheDocument();
    expect(screen.getByText("No run sends « generate ».")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "What Claude is asked" })).toBeNull();
    expect(screen.queryByRole("region", { name: /^What goes with it/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Text of Generation request" })).toHaveTextContent("Request: {request}");
    expect(group(TOUCH)).toHaveTextContent("4 commands");
  });

  it("while a run's pieces are read, its tables wait and the instruction's template is already there", async () => {
    net.routes["claude.preview"] = () => new Promise(() => {});
    await mount();
    expect(screen.getByRole("table", { name: "What Claude is asked" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "What goes with it" })).toHaveAttribute("aria-busy", "true");
    expect(card("Generation request")).not.toHaveTextContent("Claude holds");
    expect(screen.getByRole("group", { name: "Text of Generation request" })).toHaveTextContent("Request: {request}");
    expect(within(group(TOUCH)).getByText("Gives back")).toBeInTheDocument();
  });

  it("a skill or a project file is read only: who uses it, where it is, its weight and its whole text", async () => {
    await mount();
    fireEvent.click(row(/Generate tests/));
    const skill = card("Generate tests");
    expect(skill).toHaveTextContent("Used byGenerate · gen.tests");
    expect(within(skill).getByText(".claude/skills/generate-tests/SKILL.md")).toBeInTheDocument();
    expect(within(skill).getByText(tokens(PROMPTS[0].text.length))).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Text of Generate tests" })).toHaveTextContent(
      "Every expected result has a source.",
    );
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(within(skill).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPTS[0].text));
    expect(await screen.findByText("“Generate tests” copied")).toBeInTheDocument();
  });

  it("a prompt Testimus builds that no run sends shows its template and names the parts filled per run", async () => {
    await mount();
    fireEvent.click(head("System check"));
    fireEvent.click(row(/Sign-in probe/));
    expect(screen.getByRole("group", { name: "Text of Sign-in probe" })).toHaveTextContent("Reply {word}.");
    expect(screen.getByText("Built per run — not a file")).toBeInTheDocument();
    expect(
      screen.getByText("Built by Testimus for each run: the parts in braces are filled then — {word}."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: TOUCH })).toBeNull();
    expect(calls("claude.preview").map((c) => c.input)).toEqual([{ use: "generate" }]);
  });

  it("in the desktop app, Show in Explorer opens the file; a prompt built per run has none", async () => {
    const d = fakeDesktop();
    await mount();
    fireEvent.click(row(/Project rules/));
    fireEvent.click(within(card("Project rules")).getByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p\\CLAUDE.md"));
    fireEvent.click(head("System check"));
    fireEvent.click(row(/Sign-in probe/));
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
  });

  it("filters by name, kind and a word of the text, accents and case aside, opening the groups it matches; says when nothing matches", async () => {
    await mount();
    const filter = screen.getByRole("searchbox", { name: "Filter what Claude is given" });
    fireEvent.change(filter, { target: { value: "PASSAGES prove" } });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(lines()).toEqual(["1 true Check and fix1", "2 - Check testSkill"]);
    expect(row(/Check test/)).toHaveAttribute("aria-selected", "true");
    expect(card("Check test")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "GÉNÉRATION réquest" } });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(row(/Generation request/)).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "run generate" } });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(row(/Generation request/)).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "imperative MOOD" } });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(row(/House style/)).toHaveAttribute("aria-selected", "true");
    fireEvent.change(filter, { target: { value: "default" } });
    await waitFor(() => expect(row(/House style/)).toBeInTheDocument());
    expect(within(list()).queryByRole("treeitem", { name: /Untitled context/ })).toBeNull();
    fireEvent.change(filter, { target: { value: "plan.pdf" } });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(row(/Untitled context/)).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "sign-in" } });
    await waitFor(() => expect(row(/Sign-in probe/)).toBeInTheDocument());
    expect(head("System check")).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(filter, { target: { value: "nowhere-at-all" } });
    expect(await screen.findByText("Nothing matches “nowhere-at-all”.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Text of / })).toBeNull();
  });

  it("« Default of the project » writes project.set, and the detail says where else the context is attached", async () => {
    byTests = ["gloss"];
    await mount();
    fireEvent.click(row(/House style/));
    const house = card("House style");
    const on = await within(house).findByRole("switch", { name: "Default of the project" });
    expect(on).toBeChecked();
    expect(on).toHaveAccessibleDescription(
      /Goes with every run on a test or a document that has no contexts of its own/,
    );
    expect(house).toHaveTextContent("A test or a document with a list of its own takes that list instead.");
    expect(await within(house).findByLabelText(/^Name/)).toHaveValue("House style");
    expect(house).toHaveTextContent(/In the shared library\s*· notes · ~9 tokens/);
    fireEvent.click(on);
    await waitFor(() => expect(inputs("project.set")).toEqual([{ claude: { contexts: [] } }]));
    await waitFor(() =>
      expect(within(house).getByRole("switch", { name: "Default of the project" })).not.toBeChecked(),
    );
    await waitFor(() => expect(row(/House style/)).not.toHaveTextContent("Default"));
    expect(house).toHaveTextContent(
      "Not attached: it goes with a run only when it is ticked in the request, or put in a test's or a document's own list.",
    );
    fireEvent.click(row(/Untitled context/));
    const gloss = card("Untitled context");
    expect(await within(gloss).findByRole("switch", { name: "Default of the project" })).not.toBeChecked();
    expect(gloss).toHaveTextContent(
      "A test also attaches it in its own list: it goes with the runs on that test, and with a request on the whole project.",
    );
    expect(gloss).toHaveTextContent(/In this project\s*· 1 file$/);
    fireEvent.click(within(gloss).getByRole("switch", { name: "Default of the project" }));
    await waitFor(() => expect(inputs("project.set")[1]).toEqual({ claude: { contexts: ["gloss"] } }));
    await waitFor(() => expect(row(/Untitled context/)).toHaveTextContent("Default"));
  });

  it("a default the project cannot save is said and put back", async () => {
    net.routes["project.set"] = () => {
      throw new Fail("Refused.");
    };
    await mount();
    fireEvent.click(row(/House style/));
    fireEvent.click(await screen.findByRole("switch", { name: "Default of the project" }));
    expect(await screen.findByText("Could not save the default contexts")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Default of the project" })).toBeChecked());
  });

  it("« New context » creates one in the shared library and opens it, ready to be named", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New context" }));
    await waitFor(() => expect(inputs("contexts.create")).toEqual([{ shared: true }]));
    await waitFor(() => expect(within(list()).getAllByRole("treeitem", { name: /Untitled context/ })).toHaveLength(2));
    const added = within(list()).getAllByRole("treeitem", { name: /Untitled context/ })[1];
    expect(added).toHaveAttribute("aria-selected", "true");
    expect(added).toHaveTextContent("Shared library · empty");
    expect(await screen.findByRole("switch", { name: "Default of the project" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Shared with every project" })).toBeChecked();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
  });

  it("a context that cannot be created says so", async () => {
    net.routes["contexts.create"] = () => {
      throw new Fail("The library is read only.");
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New context" }));
    expect(await screen.findByText("Could not create the context")).toBeInTheDocument();
    expect(row(/Generation request/)).toHaveAttribute("aria-selected", "true");
  });

  it("a saved context is edited here: its new name is saved when the field is left, and the detail and the list say it", async () => {
    await mount();
    fireEvent.click(row(/Untitled context/));
    const name = await within(card("Untitled context")).findByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "Glossaire SOSIE" } });
    expect(card("Glossaire SOSIE")).toBeInTheDocument();
    fireEvent.blur(name);
    await waitFor(() =>
      expect(inputs("contexts.set")).toEqual([{ id: "gloss", name: "Glossaire SOSIE", notes: "", ifMtime: 1 }]),
    );
    await waitFor(() => expect(row(/Glossaire SOSIE/)).toHaveAttribute("aria-selected", "true"));
    expect(within(list()).queryByRole("treeitem", { name: /Untitled context/ })).toBeNull();
  });

  it("« Copy from a project… » brings a context over and opens the copy", async () => {
    net.routes["project.list"] = () => ({
      projects: [
        { dir: DIR, name: "RATP Sosie", exists: true },
        { dir: "D:\\other", name: "BHP", exists: true },
      ],
    });
    const theirs = { id: "screens", name: "Screens of the simulator", paths: [], files: ["hmi.png"], hasNotes: false };
    const all = net.routes["contexts.list"];
    net.routes["contexts.list"] = (i) => (i.from ? [theirs] : all(i));
    net.routes["contexts.copy"] = (i) => {
      saved.push({ id: String(i.id), name: theirs.name, notes: "", paths: [], files: theirs.files });
      return detail(find(i.id));
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy from a project…" }));
    choose(await screen.findByRole("combobox", { name: "Project to copy from" }), "BHP");
    expect(await screen.findByRole("combobox", { name: "Context to copy" })).toHaveTextContent(
      "Screens of the simulator",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy into this project" }));
    await waitFor(() => expect(inputs("contexts.copy")).toEqual([{ from: "D:\\other", id: "screens" }]));
    await waitFor(() => expect(row(/Screens of the simulator/)).toHaveAttribute("aria-selected", "true"));
    expect(row(/Screens of the simulator/)).toHaveTextContent("This project · 1 file");
    expect(await screen.findByRole("switch", { name: "Default of the project" })).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Project to copy from" })).toBeNull();
  });

  it("« Delete context… » asks first, says what a shared one costs, then removes it and goes back to the first run", async () => {
    await mount();
    fireEvent.click(row(/House style/));
    fireEvent.click(within(card("House style")).getByRole("button", { name: "Delete context…" }));
    const sure = screen.getByRole("alertdialog", { name: "Delete the context?" });
    expect(sure).toHaveTextContent("« House style » — its notes, files and paths.");
    expect(sure).toHaveTextContent("It is shared: it is deleted for every project, not only this one.");
    expect(sure).toHaveTextContent(
      "The tests, documents and project defaults that named it stop taking it. This cannot be undone.",
    );
    fireEvent.click(within(sure).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("contexts.remove")).toHaveLength(0);
    fireEvent.click(within(card("House style")).getByRole("button", { name: "Delete context…" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Delete the context?" })).getByRole("button", {
        name: "Delete the context",
      }),
    );
    await waitFor(() => expect(inputs("contexts.remove")).toEqual([{ id: "house" }]));
    await waitFor(() => expect(within(list()).queryByRole("treeitem", { name: /House style/ })).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(row(/Generation request/)).toHaveAttribute("aria-selected", "true");
  });

  it("a context of the project is deleted from the project only; a refused delete stays in the dialog", async () => {
    net.routes["contexts.remove"] = () => {
      throw new Fail("A test still names it.");
    };
    await mount();
    fireEvent.click(row(/Untitled context/));
    fireEvent.click(within(card("Untitled context")).getByRole("button", { name: "Delete context…" }));
    const sure = screen.getByRole("alertdialog", { name: "Delete the context?" });
    expect(sure).toHaveTextContent("It is deleted from this project.");
    fireEvent.click(within(sure).getByRole("button", { name: "Delete the context" }));
    expect(await within(sure).findByText(/Could not delete the context: A test still names it\./)).toBeInTheDocument();
    expect(row(/Untitled context/)).toBeInTheDocument();
  });

  it("no saved context yet: the list says what one is and how to make one, and still shows the runs", async () => {
    saved = [];
    project = info({ claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] } });
    await mount();
    expect(
      screen.getByText(/^Notes, files and folders Claude reads before it works: a glossary, house rules/),
    ).toBeInTheDocument();
    expect(within(list()).queryByRole("treeitem", { name: /^This project's contexts/ })).toBeNull();
    expect(row(/Generation request/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: "New context" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Copy from a project…" }));
    expect(await screen.findByRole("button", { name: "Copy into this project" })).toBeInTheDocument();
    expect(screen.queryByText(/^Notes, files and folders Claude reads/)).toBeNull();
  });

  it("says when the list cannot be read, and when the saved contexts cannot", async () => {
    net.routes["contexts.list"] = () => {
      throw new Fail("The library is not reachable.");
    };
    const first = await mount();
    expect(await screen.findByText("Could not list the saved contexts")).toBeInTheDocument();
    expect(row(/Generation request/)).toBeInTheDocument();
    first.unmount();
    net.routes["claude.prompts"] = () => {
      throw new Fail("No project is open.");
    };
    mountSettings(<ContextSection />);
    expect(await screen.findByText("What Claude is given could not be read")).toBeInTheDocument();
    expect(screen.getByText("No project is open.")).toBeInTheDocument();
  });
});

describe("Settings › Context › what the section works out", () => {
  const prompts = PROMPTS as unknown as Parameters<typeof entriesOf>[0];
  const contexts = [summary(HOUSE), summary(GLOSS)];

  it("a weight is said in tokens, four characters to one", () => {
    expect(tokens(0)).toBe("~0 tokens");
    expect(tokens(4800)).toBe("~1.2k tokens");
    expect(tokens(120000)).toBe("~30k tokens");
  });

  it("what Claude holds as a run starts leaves out what is off and what is only searched", () => {
    const pieces = PIECES as unknown as Parameters<typeof heldChars>[0];
    expect(heldChars(pieces)).toBe(800 + 2400 + 1200 + 400);
  });

  it("the parts filled per run are the {placeholders}, once each, never a JSON example or a tool's input", () => {
    expect(slots(`${GENERATE} {request}`)).toEqual(["{request}", "{given}"]);
    expect(slots("nothing to fill")).toEqual([]);
  });

  it("entries: every saved context, a default or not, then what goes with every run, then the core's list without its own context rows", () => {
    const entries = entriesOf(prompts, contexts, ["house"]);
    expect(entries.map((e) => [e.key, e.kind, e.group])).toEqual([
      ["context:house", "context", "This project's contexts"],
      ["context:gloss", "context", "This project's contexts"],
      ["file:CLAUDE.md", "piece", "Every run"],
      ["skill:generate-tests", "piece", "Generation"],
      ["generate", "run", "Generation"],
      ["skill:check-test", "piece", "Check and fix"],
      ["sign-in", "piece", "System check"],
    ]);
    expect(entries[0]).toMatchObject({ isDefault: true, notes: "Imperative mood, one action per step." });
    expect(entries[1]).toMatchObject({ isDefault: false, notes: "" });
  });

  it("the filter reads a context's name, place, files, paths and notes, and a run's kind and what it gives back", () => {
    const [house, gloss, , , run] = entriesOf(prompts, contexts, ["house"]);
    expect(matches(house, ["shared", "library"])).toBe(true);
    expect(matches(house, ["imperative"])).toBe(true);
    expect(matches(gloss, ["plan.pdf"])).toBe(true);
    expect(matches(gloss, ["default"])).toBe(false);
    expect(matches(run, ["run", "generate"])).toBe(true);
    expect(matches(run, ["gen-report"])).toBe(true);
    expect(matches(run, ["house"])).toBe(false);
    expect(matches(run, [])).toBe(true);
  });
});
