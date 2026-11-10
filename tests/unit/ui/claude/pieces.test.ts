import { describe, expect, it } from "vitest";
import {
  changed,
  countOn,
  groupsOf,
  pickOf,
  type RunPick,
  toggle,
  tokens,
  totalOf,
} from "../../../../src/ui/components/claude/pieces.ts";
import { piece, previewOf } from "../../helpers/fake-preview.ts";

const BASE = [
  piece("instruction", "Ask Claude on a test", { chars: 400 }),
  piece("tools", "14 tools of the app"),
  piece("overview", "How the documents fit together", { path: "docs/OVERVIEW.md" }),
  piece("context:a", "Attached", { why: "A default of the project", chars: 1200, text: "PCC" }),
  piece("context:b", "Also attached", { chars: 40 }),
  piece("context:x", "Saved only", { on: false, how: "pointer", chars: 8000, path: "contexts/x/context.md" }),
  piece("doc:D1", "Traction", { chars: 192000, detail: "D1 · v3" }),
  piece("docnote:D1", "What the team knows about D1", { parent: "doc:D1", chars: 200 }),
];

// ponytail: a pick applied the way the core applies it, so each tick is checked by what the run would then be given
const onAfter = (pick: RunPick) =>
  previewOf(BASE, pick)
    .pieces.filter((p) => p.on)
    .map((p) => p.id);

describe("a tick, said the way the run commands take it", () => {
  it("a piece left out goes to `without`; ticked back, nothing is passed at all", () => {
    const out = toggle({}, BASE, "doc:D1", false);
    expect(out).toEqual({ without: ["doc:D1"] });
    expect(toggle(out, BASE, "overview", false)).toEqual({ without: ["doc:D1", "overview"] });
    expect(toggle(out, BASE, "doc:D1", true)).toEqual({});
    expect(onAfter(out)).not.toContain("doc:D1");
  });

  it("an attached context left out is a `without` too: the contexts the run attaches stay its own to decide", () => {
    const out = toggle({}, BASE, "context:a", false);
    expect(out).toEqual({ without: ["context:a"] });
    expect(onAfter(out)).toContain("context:b");
    expect(onAfter(out)).not.toContain("context:a");
    expect(toggle(out, BASE, "context:a", true)).toEqual({});
  });

  it("a saved context that was not attached makes `contexts` the whole list; unticked, the list is the run's again", () => {
    const more = toggle({}, BASE, "context:x", true);
    expect(more).toEqual({ contexts: ["a", "b", "x"] });
    expect(onAfter(more)).toEqual(expect.arrayContaining(["context:a", "context:b", "context:x"]));
    expect(toggle(more, BASE, "context:x", true)).toEqual(more);
    expect(toggle(more, BASE, "context:x", false)).toEqual({});
  });

  it("both at once keep each its own way, whatever the order of the ticks", () => {
    const one = toggle(toggle({}, BASE, "context:x", true), BASE, "context:a", false);
    const other = toggle(toggle({}, BASE, "context:a", false), BASE, "context:x", true);
    expect(one).toEqual({ contexts: ["a", "b", "x"], without: ["context:a"] });
    expect(other).toEqual(one);
    expect(onAfter(one).filter((id) => id.startsWith("context:"))).toEqual(["context:b", "context:x"]);
    expect(toggle(one, BASE, "context:a", true)).toEqual({ contexts: ["a", "b", "x"] });
    expect(toggle(one, BASE, "context:x", false)).toEqual({ without: ["context:a"] });
  });

  it("says whether a pick changes the run, and reads one kept with a draft", () => {
    expect(changed({})).toBe(false);
    expect(changed({ without: [] })).toBe(false);
    expect(changed({ without: ["overview"] })).toBe(true);
    expect(changed({ contexts: [] })).toBe(true);
    expect(pickOf("")).toEqual({});
    expect(pickOf("not json")).toEqual({});
    expect(pickOf('{"without":["doc:D1"]}')).toEqual({ without: ["doc:D1"] });
  });
});

describe("what a run is given, in words", () => {
  it("counts the pieces that go, and sizes them in tokens", () => {
    expect(countOn(BASE)).toBe(7);
    expect(tokens(400)).toBe("~100 tokens");
    expect(tokens(6000)).toBe("~1.5k tokens");
    expect(tokens(192000)).toBe("~48k tokens");
  });

  it("the total is what Claude holds as it starts; a document is searched, so it is told apart", () => {
    expect(totalOf(BASE)).toEqual({
      total: "7 of 8 pieces · ~460 tokens",
      note: "Said, loaded or read first. 1 document more to search, never sent whole.",
    });
    const none = BASE.map((p) => (p.kind === "document" ? { ...p, on: false } : p));
    expect(totalOf(none).note).toBe("Said, loaded or read first.");
    expect(totalOf([BASE[0]]).total).toBe("1 of 1 piece · ~100 tokens");
  });
});

describe("the pieces as the graph draws them", () => {
  it("groups them — the request, the background, the saved contexts, the documents, the user's words — and drops an empty group but the contexts'", () => {
    const groups = groupsOf(BASE);
    expect(groups.map((g) => [g.label, g.nodes.map((n) => n.id)])).toEqual([
      ["The request", ["instruction", "tools"]],
      ["Background", ["overview"]],
      ["Contexts", ["context:a", "context:b", "context:x"]],
      ["Documents", ["doc:D1", "docnote:D1"]],
    ]);
    const bare = groupsOf([BASE[0]], { library: "the library" });
    expect(bare.map((g) => g.label)).toEqual(["The request", "Contexts"]);
    expect(bare[1]).toMatchObject({ nodes: [], actions: "the library" });
    expect(bare[1].empty).toMatch(/^No saved context yet/);
    const words = groupsOf(previewOf(BASE, { note: "a note", conversation: "User: hello" }).pieces);
    expect(words.at(-1)).toMatchObject({ label: "Your words" });
    expect(words.at(-1)?.nodes.map((n) => n.id)).toEqual(["note", "conversation"]);
  });

  it("a node says what it is, how it is given, its size and weight, and where its file is when Claude reads it there", () => {
    const nodes = groupsOf(BASE).flatMap((g) => g.nodes);
    const of = (id: string) => nodes.find((n) => n.id === id);
    expect(of("context:a")).toMatchObject({
      name: "Attached",
      on: true,
      locked: undefined,
      icon: "context",
      how: { icon: "text", word: "Said in full" },
      size: "~300 tokens",
      weight: 1200,
      why: "A default of the project",
      text: "PCC",
      under: false,
    });
    expect(of("context:x")).toMatchObject({
      on: false,
      how: { icon: "link", word: "Pointed at" },
      detail: "contexts/x/context.md",
    });
    expect(of("overview")?.detail).toBe("docs/OVERVIEW.md");
    expect(of("doc:D1")).toMatchObject({ how: { icon: "search", word: "Searched" }, detail: "D1 · v3" });
    expect(of("docnote:D1")?.under).toBe(true);
    expect(of("tools")).toMatchObject({ locked: true, size: undefined, how: { word: "Loaded by Claude Code" } });
    const alone = groupsOf([BASE[7]]).find((g) => g.label === "Documents");
    expect(alone?.nodes[0].under, "a note whose document is not listed hangs under nothing").toBe(false);
  });

  it("a piece can be locked here with its reason, and end its row with its own actions", () => {
    const groups = groupsOf(BASE, {
      lock: (p) => (p.kind === "context" ? undefined : "Chosen for each run"),
      actions: (p) => (p.kind === "context" ? `edit ${p.id}` : undefined),
    });
    const nodes = groups.flatMap((g) => g.nodes);
    expect(nodes.find((n) => n.id === "overview")?.locked).toBe("Chosen for each run");
    expect(nodes.find((n) => n.id === "instruction")?.locked).toBe(true);
    expect(nodes.find((n) => n.id === "context:a")).toMatchObject({ locked: undefined, actions: "edit context:a" });
    expect(nodes.find((n) => n.id === "doc:D1")?.actions).toBeUndefined();
  });
});
