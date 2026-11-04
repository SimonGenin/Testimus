import { useEffect, useState } from "react";
import type { ClaudeScope } from "../../../core/types.ts";
import type { Focus } from "../../lib/app.ts";
import type { Sub, Tab } from "./DockScope.tsx";

// ponytail: what the dock talks about follows the screen — the open test (and its step), else the open document, else
// the whole project — until the user picks another; the Actions tab stays where it is
export function useDockScope(focus: Focus | null, docId: string | null) {
  const [tab, setTab] = useState<Tab>("test");
  const [sub, setSub] = useState<Sub>("project");
  const testId = focus?.testId;

  useEffect(() => {
    setTab((t) => (t === "actions" ? t : testId ? "test" : docId ? "docs" : "test"));
    setSub(testId ? "test" : docId ? "doc" : "project");
  }, [testId, docId]);

  useEffect(() => {
    if (focus?.step == null && sub === "step") setSub("test");
    if (!focus && (sub === "step" || sub === "test")) setSub("project");
    if (!docId && sub === "doc") setSub("all");
  }, [focus, docId, sub]);

  const pickTab = (t: Tab) => {
    setTab(t);
    if (t === "docs") setSub(docId ? "doc" : "all");
    if (t === "test") setSub(focus ? (focus.step != null && sub === "step" ? "step" : "test") : "project");
  };

  // a request from the app (the palette's question, the test header's Ask Claude) sets the scope it is about
  const ask = (mode: "docs" | "test", scope?: "test" | "step" | "project") => {
    if (mode === "docs") {
      setTab(docId ? "docs" : "test");
      setSub(docId ? "doc" : "project");
    } else if (scope) {
      setTab("test");
      setSub(scope);
    }
  };

  const scope: ClaudeScope =
    sub === "step" && focus && focus.step != null
      ? { kind: "step", testId: focus.testId, step: focus.step }
      : sub === "test" && focus
        ? { kind: "test", testId: focus.testId }
        : { kind: "project" };
  const word =
    sub === "step" && focus?.step != null
      ? `Step ${focus.step}`
      : sub === "test" && focus
        ? (focus.key ?? "This test")
        : sub === "doc" && docId
          ? docId
          : sub === "all"
            ? "All documents"
            : "Whole project";
  const placeholder =
    sub === "doc"
      ? `Ask anything about ${docId}…`
      : sub === "all"
        ? "Ask the documents — answers cite their passages"
        : sub === "project"
          ? "Ask about the project, or tell Claude what to do with its tests…"
          : "Ask Claude to change or explain this test…";
  const label =
    sub === "doc"
      ? `Ask about ${docId}`
      : sub === "all"
        ? "Ask the documents"
        : sub === "project"
          ? "Ask Claude about the project"
          : "Ask Claude about this test";

  return { tab, sub, setSub, pickTab, ask, scope, word, placeholder, label };
}
