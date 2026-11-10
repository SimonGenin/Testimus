// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeScope } from "../../../../src/core/types.ts";
import type { Standing } from "../../../../src/ui/components/claude/ContextDialog.tsx";
import { SaveContext } from "../../../../src/ui/components/claude/SaveContext.tsx";
import { useRunContext } from "../../../../src/ui/components/claude/useRunContext.tsx";
import { ClaudeBlock } from "../../../../src/ui/components/ui/ClaudeBlock.tsx";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import type { Key } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { type Piece, piece, previewOf } from "../../helpers/fake-preview.ts";
import { choose, openList } from "../../helpers/select.ts";
import { callsOf, dataWrapper, Fail, fakeNet, net } from "../../helpers/ui-data.tsx";

let toasts: number[] = [];
function Toasts() {
  toasts = useToasts().map((t) => t.id);
  return <Toaster />;
}

let base: Piece[] = [];

const BASE = (): Piece[] => [
  piece("instruction", "Ask Claude on a test", { why: "What Testimus asks of this run", chars: 400, text: "Use it." }),
  piece("skill:edit-test", "Edit test", { chars: 4000, path: ".claude/skills/edit-test/SKILL.md" }),
  piece("rules", "Project rules", { chars: 800, path: "CLAUDE.md" }),
  piece("tools", "14 tools of the app", { detail: "Read, Edit, tests_show" }),
  piece("overview", "How the documents fit together", { path: "docs/OVERVIEW.md" }),
  piece("context:glossary", "Glossary", { why: "A default of the project", chars: 1200, text: "PCC = poste" }),
  piece("context:old", "Old notes", { on: false, how: "pointer", chars: 2000, detail: "1 file: plan.pdf" }),
  piece("doc:D401", "Spécifications J5", { why: "A document of this run", chars: 192000, detail: "D401 · v3" }),
  piece("docnote:D401", "What the team knows about D401", { parent: "doc:D401", chars: 240, text: "J5 replaces it." }),
  piece("doc:SIG", "Signalisation", { why: "A document of the project: Claude may search it", chars: 48000 }),
];

beforeEach(() => {
  fakeNet();
  setProject("D:/p");
  base = BASE();
  net.routes["claude.preview"] = (i) => previewOf(base, i);
});

afterEach(() => {
  act(() => {
    for (const id of toasts) closeToast(id, true);
  });
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
  setProject(null);
});

type Sent = { prompt: string; contexts?: string[]; without?: string[] };

function Block({
  onRun,
  scope = { kind: "test", testId: "t1" },
  draftKey,
  standing,
  enabled,
  start = "",
}: {
  onRun: (sent: Sent) => void;
  scope?: ClaudeScope;
  draftKey?: Key;
  standing?: Standing;
  enabled?: boolean;
  start?: string;
}) {
  const [text, setText] = useState(start);
  const ctx = useRunContext({
    use: "ask-test",
    scope,
    note: text,
    draftKey,
    standing,
    enabled,
    onSaved: () => setText(""),
  });
  return (
    <>
      <Toasts />
      <ClaudeBlock
        ariaLabel="Ask Claude"
        value={text}
        onChange={setText}
        context={ctx.context}
        allowEmpty
        onSubmit={(prompt) => onRun({ prompt, ...ctx.run })}
      />
      {ctx.dialog}
    </>
  );
}

const mount = (props: Partial<Parameters<typeof Block>[0]> = {}) => {
  const onRun = vi.fn<(sent: Sent) => void>();
  const r = render(<Block onRun={onRun} {...props} />, { wrapper: dataWrapper() });
  return { ...r, onRun };
};

const button = () => screen.getByRole("button", { name: /^Context/ });
const counted = (text: RegExp) => waitFor(() => expect(button()).toHaveTextContent(text));
const dialog = () => screen.getByRole("dialog", { name: "Context" });
const open = async () => {
  fireEvent.click(button());
  await within(dialog()).findByRole("listbox", { name: "Always given" });
  return dialog();
};
const box = (name: string) => within(dialog()).getByRole("checkbox", { name });
const row = (name: string) => within(dialog()).getByText(name, { selector: "li *" }).closest("li") as HTMLElement;
const group = (name: string) => within(dialog()).getAllByRole("region", { name })[0];
const read = (name: string) => {
  fireEvent.click(within(row(name)).getByText(name));
  return within(dialog()).getByRole("article", { name });
};
const ticks = () =>
  within(dialog())
    .queryAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label"));
const total = () => within(dialog()).getByRole("status");
const done = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send" }));
const asked = () => callsOf("claude.preview").map((c) => c.input);
const ASKED = { use: "ask-test", scope: { kind: "test", testId: "t1" } };

describe("the Context of a Claude block", () => {
  it("the button counts what goes with the run; what is typed is counted, never asked again", async () => {
    const { onRun } = mount();
    expect(button()).toHaveTextContent(/^Context$/);
    await counted(/^Context9$/);
    expect(asked()).toEqual([ASKED]);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Claude" }), { target: { value: "Raccourcis" } });
    expect(button()).toHaveTextContent(/^Context10$/);
    expect(asked()).toHaveLength(1);
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "Raccourcis" });
  });

  it("lists what claude.preview says the run is given — what can be changed first, what always goes last — with the user's own words and the tokens Claude starts with", async () => {
    mount({ start: "Raccourcis" });
    await counted(/^Context10$/);
    const d = await open();
    expect(d).toHaveAccessibleDescription(/Everything Claude is given with this request/);
    await waitFor(() => expect(group("Your words")).toBeInTheDocument());
    expect(
      within(d)
        .getAllByRole("listbox")
        .map((l) => l.getAttribute("aria-label")),
    ).toEqual(["Your contexts", "Documents", "Background", "Your words", "Always given"]);
    expect(asked().at(-1)).toEqual({ ...ASKED, note: "Raccourcis" });
    expect(group("Your contexts")).toHaveTextContent("1 of 2 ticked");
    expect(group("Always given")).not.toHaveTextContent("ticked");
    expect(group("Your words")).toHaveTextContent("Your note for this run");
    expect(total()).toHaveTextContent(/^Claude starts with ~1\.7k tokens$/);
    expect(d).toHaveTextContent("and searches 2 documents (~60k tokens), never sent whole");
    expect(d).toHaveTextContent("Your choice holds for this run only. The defaults are set in Settings › Context.");
    expect(row("Glossary")).toHaveTextContent("A default of the project");
    expect(row("Glossary")).toHaveTextContent("~300");
    expect(row("Old notes")).toHaveTextContent("pointed at~500");
    expect(row("Spécifications J5")).toHaveTextContent("searched~48k");
    expect(row("Edit test")).toHaveTextContent("loaded~1.0k");
    done();
    expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
  });

  it("the piece picked is read beside the list: why it is there, how it reaches Claude, its file and what it says", async () => {
    mount();
    await counted(/^Context9$/);
    const d = await open();
    const first = within(d).getByRole("article", { name: "Glossary" });
    expect(first).toHaveTextContent("A default of the project");
    expect(first).toHaveTextContent("GivenSaid in full · ~300 tokens");
    expect(within(first).getByLabelText("Glossary, in full")).toHaveTextContent("PCC = poste");
    expect(within(d).getByRole("option", { selected: true })).toHaveTextContent("Glossary");
    const skill = read("Edit test");
    expect(skill).toHaveTextContent("GivenLoaded by Claude Code · ~1.0k tokens");
    expect(skill).toHaveTextContent("Loaded from.claude/skills/edit-test/SKILL.md");
    expect(within(d).queryByRole("button", { name: "Edit" })).toBeNull();
    const tools = read("14 tools of the app");
    expect(
      within(within(tools).getByRole("list", { name: "The tools" }))
        .getAllByRole("listitem")
        .map((t) => t.textContent),
    ).toEqual(["Read", "Edit", "tests_show"]);
    const doc = read("Spécifications J5");
    expect(doc).toHaveTextContent("DetailsD401 · v3");
    expect(doc).toHaveTextContent("It is never sent whole.");
    expect(read("Old notes")).toHaveTextContent("This runLeft out");
  });

  it("a locked piece cannot be unticked: the request's own pieces and the user's words have no checkbox", async () => {
    mount({ start: "Raccourcis" });
    await counted(/^Context10$/);
    const d = await open();
    await within(d).findByRole("listbox", { name: "Your words" });
    for (const name of ["Ask Claude on a test", "Edit test", "Project rules", "14 tools of the app"])
      expect(within(d).queryByRole("checkbox", { name })).toBeNull();
    expect(within(d).queryByRole("checkbox", { name: "Your note for this run" })).toBeNull();
    expect(ticks()).toEqual([
      "Glossary",
      "Old notes",
      "Spécifications J5",
      "What the team knows about D401",
      "Signalisation",
      "How the documents fit together",
    ]);
  });

  it("unticking an attached context leaves it out of this run: the command is sent `without`, never `contexts`", async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    fireEvent.click(box("Glossary"));
    await waitFor(() => expect(box("Glossary")).not.toBeChecked());
    expect(asked().at(-1)).toEqual({ ...ASKED, without: ["context:glossary"] });
    expect(total()).toHaveTextContent(/^Claude starts with ~1\.4k tokens$/);
    expect(row("Glossary")).toHaveTextContent("Saved, not attached to this run");
    done();
    expect(button()).toHaveTextContent(/^Context8 · changed$/);
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", without: ["context:glossary"] });
  });

  it("a saved context that is off can be ticked on: `contexts` is then the whole list; unticked again, nothing is sent", async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    expect(box("Old notes")).not.toBeChecked();
    fireEvent.click(box("Old notes"));
    await waitFor(() => expect(box("Old notes")).toBeChecked());
    expect(asked().at(-1)).toEqual({ ...ASKED, contexts: ["glossary", "old"] });
    expect(row("Old notes")).toHaveTextContent("Chosen for this run");
    expect(total()).toHaveTextContent(/^Claude starts with ~2\.2k tokens$/);
    done();
    expect(button()).toHaveTextContent(/^Context10 · changed$/);
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "", contexts: ["glossary", "old"] });
    await open();
    fireEvent.click(box("Old notes"));
    await waitFor(() => expect(box("Old notes")).not.toBeChecked());
    done();
    expect(button()).toHaveTextContent(/^Context9$/);
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "" });
  });

  it("one ticked on and an attached one left out: both are said, each its own way", async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    fireEvent.click(box("Old notes"));
    await waitFor(() => expect(box("Old notes")).toBeChecked());
    fireEvent.click(box("Glossary"));
    await waitFor(() => expect(box("Glossary")).not.toBeChecked());
    expect(box("Old notes")).toBeChecked();
    done();
    send();
    expect(onRun).toHaveBeenCalledWith({
      prompt: "",
      contexts: ["glossary", "old"],
      without: ["context:glossary"],
    });
  });

  it('a document unticked goes to `without: ["doc:<id>"]` — what the team wrote about it goes with it; ticked back, it returns', async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    fireEvent.click(box("Spécifications J5"));
    await waitFor(() => expect(box("Spécifications J5")).not.toBeChecked());
    expect(asked().at(-1)).toEqual({ ...ASKED, without: ["doc:D401"] });
    expect(box("What the team knows about D401")).not.toBeChecked();
    expect(group("Documents")).toHaveTextContent("1 of 3 ticked");
    expect(dialog()).toHaveTextContent("and searches 1 document (~12k tokens), never sent whole");
    fireEvent.click(box("Signalisation"));
    await waitFor(() => expect(box("Signalisation")).not.toBeChecked());
    expect(dialog()).not.toHaveTextContent("searches");
    done();
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "", without: ["doc:D401", "doc:SIG"] });
    await open();
    fireEvent.click(box("Spécifications J5"));
    await waitFor(() => expect(box("Spécifications J5")).toBeChecked());
    done();
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "", without: ["doc:SIG"] });
  });

  it("how the documents fit together and a document's note can each be left out on their own", async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    fireEvent.click(box("How the documents fit together"));
    await waitFor(() => expect(box("How the documents fit together")).not.toBeChecked());
    fireEvent.click(box("What the team knows about D401"));
    await waitFor(() => expect(box("What the team knows about D401")).not.toBeChecked());
    expect(box("Spécifications J5")).toBeChecked();
    done();
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", without: ["overview", "docnote:D401"] });
  });

  it("« Back to the defaults » forgets what was ticked for this run", async () => {
    const { onRun } = mount();
    await counted(/^Context9$/);
    await open();
    expect(within(dialog()).queryByRole("button", { name: "Back to the defaults" })).toBeNull();
    fireEvent.click(box("Glossary"));
    await waitFor(() => expect(box("Glossary")).not.toBeChecked());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back to the defaults" }));
    await waitFor(() => expect(box("Glossary")).toBeChecked());
    expect(within(dialog()).queryByRole("button", { name: "Back to the defaults" })).toBeNull();
    done();
    expect(button()).toHaveTextContent(/^Context9$/);
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "" });
  });

  it("says why when what the run is given cannot be worked out, and reads nothing while there is nothing to ask about", async () => {
    net.routes["claude.preview"] = () => {
      throw new Fail("No project is open.");
    };
    const first = mount();
    fireEvent.click(button());
    expect(await within(dialog()).findByText("Could not work out what Claude is given")).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("No project is open.");
    first.unmount();
    net.calls = [];
    mount({ enabled: false });
    await act(async () => {});
    expect(asked()).toHaveLength(0);
    expect(button()).toHaveTextContent(/^Context$/);
  });
});

describe("the saved contexts, managed in the Context dialog", () => {
  const created = (name: string) => (i: Record<string, unknown>) => {
    base.push(piece("context:c-new", String(i.name ?? name), { on: false, chars: String(i.notes ?? "").length }));
    return { id: "c-new", name: i.name ?? "", notes: i.notes ?? "", paths: [], files: [], hasNotes: !!i.notes };
  };

  it("a context is created from the block's text: saved, ticked for this run, and the block emptied", async () => {
    net.routes["contexts.create"] = created("");
    const { onRun } = mount({ start: "PCC means Poste\nde commande" });
    await counted(/^Context10$/);
    const d = await open();
    fireEvent.click(within(d).getByRole("button", { name: "Save the text as a context…" }));
    const save = screen.getByRole("dialog", { name: "Save as context" });
    expect(within(save).getByRole("textbox", { name: "Name" })).toHaveValue("PCC means Poste");
    fireEvent.click(within(save).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsOf("contexts.create")).toHaveLength(1));
    expect(callsOf("contexts.create")[0].input).toEqual({
      name: "PCC means Poste",
      shared: false,
      notes: "PCC means Poste\nde commande",
    });
    await waitFor(() => expect(box("PCC means Poste")).toBeChecked());
    expect(screen.queryByRole("dialog", { name: "Save as context" })).toBeNull();
    expect(asked().at(-1)).toEqual({ ...ASKED, contexts: ["glossary", "c-new"] });
    expect(screen.getByRole("textbox", { name: "Ask Claude" })).toHaveValue("");
    expect(await screen.findByText("Context « PCC means Poste » saved")).toBeInTheDocument();
    done();
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", contexts: ["glossary", "c-new"] });
  });

  it("an empty block has no text to save, and says so", async () => {
    mount();
    await counted(/^Context9$/);
    const d = await open();
    const save = within(d).getByRole("button", { name: "Save the text as a context…" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Write in the box first");
  });

  it("« New context » makes one shared with every project, ticks it for this run and opens it to be written", async () => {
    net.routes["contexts.create"] = created("Untitled context");
    net.routes["contexts.show"] = () => ({ id: "c-new", name: "", notes: "", paths: [], files: [], hasNotes: false });
    const { onRun } = mount();
    await counted(/^Context9$/);
    const d = await open();
    fireEvent.click(within(d).getByRole("button", { name: "New context" }));
    const edit = await screen.findByRole("dialog", { name: "Edit the context" });
    expect(callsOf("contexts.create")[0].input).toEqual({ shared: true });
    expect(await within(edit).findByRole("textbox", { name: /^Name/ })).toHaveValue("");
    await waitFor(() => expect(asked().at(-1)).toEqual({ ...ASKED, contexts: ["glossary", "c-new"] }));
    fireEvent.click(within(edit).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Edit the context" })).toBeNull();
    expect(dialog()).toBeInTheDocument();
    done();
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", contexts: ["glossary", "c-new"] });
  });

  it("says when a context cannot be created, and ticks nothing", async () => {
    net.routes["contexts.create"] = () => {
      throw new Fail("The library is read-only");
    };
    mount();
    await counted(/^Context9$/);
    const d = await open();
    fireEvent.click(within(d).getByRole("button", { name: "New context" }));
    expect(await screen.findByText("Could not create the context")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit the context" })).toBeNull();
    expect(asked().every((i) => !("contexts" in i))).toBe(true);
  });

  it("« Edit » on a saved context's row opens its editor over the graph; renamed there, it is renamed in the graph", async () => {
    const store = { id: "glossary", name: "Glossary", notes: "PCC = poste", paths: [], files: [], hasNotes: true };
    net.routes["contexts.show"] = () => ({ ...store });
    net.routes["contexts.set"] = (i) => {
      store.name = String(i.name);
      base = base.map((p) => (p.id === "context:glossary" ? { ...p, name: store.name } : p));
      return { ...store };
    };
    mount();
    await counted(/^Context9$/);
    await open();
    expect(within(read("Old notes")).getByRole("button", { name: "Edit" })).toBeEnabled();
    fireEvent.click(within(read("Glossary")).getByRole("button", { name: "Edit" }));
    const edit = await screen.findByRole("dialog", { name: "Edit the context" });
    const name = await within(edit).findByRole("textbox", { name: /^Name/ });
    expect(name).toHaveValue("Glossary");
    expect(callsOf("contexts.show")[0].input).toEqual({ id: "glossary" });
    fireEvent.change(name, { target: { value: "Lexique" } });
    fireEvent.blur(name);
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(1));
    fireEvent.click(within(edit).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(box("Lexique")).toBeChecked());
    expect(within(dialog()).queryByRole("checkbox", { name: "Glossary" })).toBeNull();
  });

  it("a context copied from another project is ticked for this run", async () => {
    net.routes["project.list"] = () => ({
      last: "",
      projects: [
        { dir: "D:\\Other", name: "Other", jiraProject: "BHPTCC", exists: true },
        { dir: "D:\\Gone", name: "Gone", jiraProject: "X", exists: false },
      ],
    });
    net.routes["contexts.list"] = (i) => (i.from ? [{ id: "ctx-g", name: "Glossaire", paths: [], files: [] }] : []);
    net.routes["contexts.copy"] = (i) => {
      base.push(piece("context:ctx-g", "Glossaire", { on: false }));
      return { id: "ctx-g", name: "Glossaire", notes: "", paths: [], files: [], hasNotes: false, from: i.from };
    };
    const { onRun } = mount();
    await counted(/^Context9$/);
    const d = await open();
    fireEvent.click(within(d).getByRole("button", { name: "Copy from another project…" }));
    const from = await within(d).findByRole("combobox", { name: "Project to copy from" });
    expect(within(openList(from)).queryByRole("option", { name: "Gone" })).toBeNull();
    choose(from, "Other");
    expect(await within(d).findByRole("combobox", { name: "Context to copy" })).toHaveTextContent("Glossaire");
    fireEvent.click(within(d).getByRole("button", { name: "Copy into this project" }));
    await waitFor(() => expect(callsOf("contexts.copy")[0]?.input).toEqual({ from: "D:\\Other", id: "ctx-g" }));
    await waitFor(() => expect(box("Glossaire")).toBeChecked());
    expect(screen.queryByRole("dialog", { name: "Edit the context" })).toBeNull();
    done();
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", contexts: ["glossary", "ctx-g"] });
  });

  it("with no saved context yet, the list says what one is and how to make it", async () => {
    base = base.filter((p) => p.kind !== "context");
    mount();
    await counted(/^Context8$/);
    await open();
    const contexts = group("Your contexts");
    expect(contexts).toHaveTextContent(
      "Contexts are notes written once and given to Claude on every run: a house style, a glossary.",
    );
    expect(within(dialog()).getByRole("article", { name: "Spécifications J5" })).toBeInTheDocument();
    expect(within(contexts).getByRole("button", { name: "New context" })).toBeEnabled();
    expect(within(contexts).getByRole("button", { name: "Copy from another project…" })).toBeEnabled();
  });
});

describe("what was ticked for a run, kept or forgotten (useRunContext)", () => {
  const leaveOut = async () => {
    await open();
    fireEvent.click(box("Glossary"));
    await waitFor(() => expect(box("Glossary")).not.toBeChecked());
    done();
  };

  it("starts again when the block is about another test, and holds from one step of a test to the next", async () => {
    const onRun = vi.fn<(sent: Sent) => void>();
    const Wrapper = dataWrapper();
    const at = (scope: ClaudeScope) => (
      <Wrapper>
        <Block onRun={onRun} scope={scope} />
      </Wrapper>
    );
    const r = render(at({ kind: "step", testId: "t1", step: 1 }));
    await counted(/^Context9$/);
    await leaveOut();
    expect(button()).toHaveTextContent(/changed$/);
    r.rerender(at({ kind: "step", testId: "t1", step: 2 }));
    await waitFor(() =>
      expect(asked().at(-1)).toEqual({
        use: "ask-test",
        scope: { kind: "step", testId: "t1", step: 2 },
        without: ["context:glossary"],
      }),
    );
    expect(button()).toHaveTextContent(/changed$/);
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "", without: ["context:glossary"] });
    r.rerender(at({ kind: "step", testId: "t2", step: 2 }));
    await counted(/^Context9$/);
    send();
    expect(onRun).toHaveBeenLastCalledWith({ prompt: "" });
  });

  it("with a draft key it lives with the block's unsent draft: found again when the block comes back", async () => {
    const draftKey: Key = ["D:/p", "gen.tests", { draft: "context" }];
    const first = mount({ draftKey });
    await counted(/^Context9$/);
    await leaveOut();
    first.unmount();
    const { onRun } = mount({ draftKey });
    await counted(/^Context8 · changed$/);
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "", without: ["context:glossary"] });
    await open();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back to the defaults" }));
    done();
    await counted(/^Context9$/);
  });
});

describe("a standing list of saved contexts (a test's, a document's)", () => {
  const standing = (onChange: Standing["onChange"]): Standing => ({ says: "every run on this test", onChange });

  it("the saved contexts ticked are the list: a tick hands the whole list to its owner, and the graph is read again", async () => {
    const onChange = vi.fn((ids: string[]) => {
      base = base.map((p) => (p.kind === "context" ? { ...p, on: ids.includes(p.id.slice(8)) } : p));
    });
    const { onRun } = mount({ standing: standing(onChange), start: "a note" });
    await counted(/^Context9$/);
    const d = await open();
    expect(d).toHaveAccessibleDescription(/What Claude is given in every run on this test\./);
    expect(d).toHaveTextContent("The ticked contexts are kept for every run on this test.");
    expect(within(d).queryByRole("group", { name: "Your words" })).toBeNull();
    fireEvent.click(box("Old notes"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["glossary", "old"]));
    await waitFor(() => expect(box("Old notes")).toBeChecked());
    await counted(/^Context10$/);
    fireEvent.click(box("Glossary"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["old"]));
    await waitFor(() => expect(box("Glossary")).not.toBeChecked());
    expect(within(d).queryByRole("button", { name: "Back to the defaults" })).toBeNull();
    expect(asked().every((i) => !("contexts" in i) && !("without" in i) && !("note" in i))).toBe(true);
    done();
    expect(button()).toHaveTextContent(/^Context9$/);
    send();
    expect(onRun).toHaveBeenCalledWith({ prompt: "a note" });
  });

  it("everything else is only shown, with the reason it is not chosen here", async () => {
    mount({ standing: standing(() => {}) });
    await counted(/^Context9$/);
    await open();
    expect(ticks()).toEqual(["Glossary", "Old notes"]);
    expect(group("Documents")).toHaveTextContent(/^DocumentsChosen for each run/);
    expect(group("Background")).toHaveTextContent(/^BackgroundChosen for each run/);
    expect(group("Always given")).not.toHaveTextContent("Chosen for each run");
    for (const name of ["How the documents fit together", "Spécifications J5", "Signalisation"])
      expect(read(name)).toHaveTextContent("ChosenFor each run, where you write to Claude");
    expect(read("Edit test")).not.toHaveTextContent("Chosen");
  });

  it("says when the owner could not take the list", async () => {
    mount({
      standing: standing(async () => {
        throw new Error("test.md is locked");
      }),
    });
    await counted(/^Context9$/);
    await open();
    fireEvent.click(box("Old notes"));
    expect(await screen.findByText("Could not change the contexts")).toBeInTheDocument();
    expect(box("Old notes")).not.toBeChecked();
  });

  it("a list that is locked for now is shown, not changed: nothing ticks, none is made, and the reason is said", async () => {
    const onChange = vi.fn();
    const why = "Claude is editing this test — wait for it to finish";
    mount({ standing: { ...standing(onChange), locked: why } });
    await counted(/^Context9$/);
    const d = await open();
    expect(box("Glossary")).toBeChecked();
    for (const c of within(d).getAllByRole("checkbox")) expect(c).toBeDisabled();
    expect(box("Old notes").closest("label")).toHaveAccessibleDescription(why);
    expect(within(d).getByRole("button", { name: "New context" })).toBeDisabled();
    expect(within(d).queryByRole("button", { name: "Copy from another project…" })).toBeNull();
    expect(within(read("Old notes")).getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

let titles: string[] = [];
function Probe() {
  const t = useToasts();
  titles = t.map((x) => x.title);
  toasts = t.map((x) => x.id);
  return null;
}

describe("Save as context", () => {
  beforeEach(() => {
    net.routes["contexts.create"] = (i) => ({ id: "c-new", name: i.name, notes: i.notes, paths: [], files: [] });
  });

  it("names the context after the note's first line, saves it shared when ticked, and says so", async () => {
    const saved = vi.fn();
    const closed = vi.fn();
    render(
      <>
        <Probe />
        <SaveContext note={"  Positions of the operator\nmore lines"} onSaved={saved} onClose={closed} />
      </>,
      { wrapper: dataWrapper() },
    );
    const save = screen.getByRole("dialog", { name: "Save as context" });
    expect(within(save).getByRole("textbox", { name: "Name" })).toHaveValue("Positions of the operator");
    fireEvent.click(within(save).getByRole("checkbox", { name: /Shared with every project/ }));
    fireEvent.click(within(save).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("c-new"));
    expect(closed).toHaveBeenCalled();
    expect(callsOf("contexts.create")[0].input).toEqual({
      name: "Positions of the operator",
      shared: true,
      notes: "Positions of the operator\nmore lines",
    });
    expect(titles).toContain("Context « Positions of the operator » saved");
  });

  it("cannot save without a name, and shows why a save failed while staying open", async () => {
    net.routes["contexts.create"] = () => {
      throw new Fail("A context named « x » already exists");
    };
    const saved = vi.fn();
    render(<SaveContext note="x" onSaved={saved} onClose={() => {}} />, { wrapper: dataWrapper() });
    const save = screen.getByRole("dialog", { name: "Save as context" });
    const name = within(save).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "   " } });
    expect(within(save).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "x" } });
    fireEvent.click(within(save).getByRole("button", { name: "Save" }));
    expect(
      await within(save).findByText(/Could not save the context: A context named « x » already exists/),
    ).toBeVisible();
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Save as context" })).toBeVisible();
  });
});
