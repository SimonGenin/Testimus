// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProject } from "../../../../src/ui/api.ts";
import { docOfRoute } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { type Action, groupByTarget, onTarget, originLine, scopeWords } from "../../../../src/ui/lib/actions.ts";
import { fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

const DOC = "SOSIE_211_D401-1_3";

const action = (o: Partial<Action> = {}): Action => ({
  id: "act-1",
  title: "Recover 23 figures from the PDF",
  scope: { kind: "doc", docId: DOC },
  where: `doc:${DOC}`,
  problem: "Figure 3, 23: caption without a picture in the .docx",
  why: "The PDF rendering has the pictures.",
  plan: ["Find the PDF", "Convert again"],
  stamp: "s",
  proposedBy: { run: "import", model: "opus", effort: "low", at: new Date(Date.now() - 120000).toISOString() },
  state: "open",
  at: "2026-11-03T10:00:00Z",
  stale: false,
  target: { kind: "document", id: DOC, name: "Traction", code: DOC },
  ...o,
});

let open: Action[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("D:/p");
  open = [];
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["actions.list"] = () => open;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("actions by target", () => {
  it("cut the core's list where the target changes, never sorting it again; a lone action says its target", () => {
    const test = { kind: "test" as const, id: "local-0000000a", name: "Sectionneur avec TK" };
    const list = [
      action({ id: "a" }),
      action({ id: "b", target: test }),
      action({ id: "c", target: test }),
      action({ id: "d" }),
    ];
    expect(groupByTarget(list).map((g) => [g.target.name, g.actions.map((a) => a.id)])).toEqual([
      ["Traction", ["a"]],
      ["Sectionneur avec TK", ["b", "c"]],
      ["Traction", ["d"]],
    ]);
    expect(onTarget(test)).toBe("on test « Sectionneur avec TK »");
  });
});

describe("action words", () => {
  it("say who proposed the action, with which model and effort, and when", () => {
    expect(originLine(action())).toBe("Proposed by Opus · low · during the import · 2 min ago");
    expect(originLine(action({ proposedBy: { run: "x", model: "", effort: "", at: "nope" } }))).toBe(
      "Proposed by Claude",
    );
    expect(scopeWords({ kind: "step", testId: "T-1", step: 4 })).toBe("T-1 · step 4");
    expect(scopeWords({ kind: "doc", docId: DOC })).toBe(`${DOC} · whole document`);
    expect(docOfRoute({ screen: "documents", arg: `${DOC}#§5.6.6` })).toBe(DOC);
    expect(docOfRoute({ screen: "tests", arg: "x" })).toBeNull();
  });
});
