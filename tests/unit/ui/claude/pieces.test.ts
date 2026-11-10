import { describe, expect, it } from "vitest";
import {
  changed,
  countOn,
  groupsOf,
  HOW,
  held,
  ICON,
  pickOf,
  type RunPick,
  toggle,
  tokens,
  tokensShort,
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
  it("counts the pieces that go, and sizes them in tokens, in full or beside a name", () => {
    expect(countOn(BASE)).toBe(7);
    expect(tokens(400)).toBe("~100 tokens");
    expect(tokens(6000)).toBe("~1.5k tokens");
    expect(tokens(192000)).toBe("~48k tokens");
    expect(tokensShort(6000)).toBe("~1.5k");
  });

  it("the total is what Claude starts with; a document is searched, never sent whole, so it is told apart", () => {
    expect(held(BASE).map((p) => p.id)).toEqual([
      "instruction",
      "tools",
      "overview",
      "context:a",
      "context:b",
      "docnote:D1",
    ]);
    expect(totalOf(BASE)).toEqual({
      start: "~460 tokens",
      searched: "searches 1 document (~48k tokens), never sent whole",
    });
    const none = BASE.map((p) => (p.kind === "document" ? { ...p, on: false } : p));
    expect(totalOf(none)).toEqual({ start: "~460 tokens" });
  });
});

describe("the pieces in the dialog's groups", () => {
  it("what can be changed first — the saved contexts, the documents, the background, the user's words — what always goes last; an empty group goes but the contexts'", () => {
    const groups = groupsOf(previewOf(BASE, { note: "a note", conversation: "User: hello" }).pieces);
    expect(groups.map((g) => [g.label, g.pieces.map((p) => p.id)])).toEqual([
      ["Your contexts", ["context:a", "context:b", "context:x"]],
      ["Documents", ["doc:D1", "docnote:D1"]],
      ["Background", ["overview"]],
      ["Your words", ["note", "conversation"]],
      ["Always given", ["instruction", "tools"]],
    ]);
    expect(groupsOf([BASE[0]]).map((g) => [g.label, g.pieces.length])).toEqual([
      ["Your contexts", 0],
      ["Always given", 1],
    ]);
  });

  it("each kind of piece has its icon, and each way it reaches Claude its words", () => {
    expect(ICON.context).toBe("context");
    expect(ICON.document).toBe("documents");
    expect(HOW.inline).toEqual({ icon: "text", word: "Said in full" });
    expect(HOW.auto).toEqual({ icon: "download", word: "Loaded by Claude Code", short: "loaded" });
    expect(HOW.search.short).toBe("searched");
  });
});
