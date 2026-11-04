// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProject } from "../../src/ui/api.ts";
import { docOfRoute } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { type Action, originLine, scopeWords } from "../../src/ui/lib/actions.ts";
import { fakeEvents, fakeNet, net } from "./cov-uishell-helpers.tsx";

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
