import { useEffect, useState } from "react";
import type { ClaudeScope } from "../../../core/types.ts";
import type { Focus } from "../../lib/app.ts";
import type { Sub, Tab } from "./DockScope.tsx";

// ponytail: what the dock talks about follows the screen — the open test (and its step), else the open document, else
// the whole project — until the user picks another; the Actions tab stays where it is
export function useDockScope(focus: Focus | null, docId: string | null) {
  const testId = focus?.testId;
  const runOnly = !!focus?.run && !testId;
  // ponytail: it starts on what the screen shows, not on the project: what a run is given is read for the scope, and a
  // first draw on the project would read the project's for nothing
  const [tab, setTab] = useState<Tab>(testId || runOnly || !docId ? "test" : "docs");
  const [sub, setSub] = useState<Sub>(testId ? "test" : runOnly ? "run" : docId ? "doc" : "project");

  useEffect(() => {
    setTab((t) => (t === "actions" ? t : testId || runOnly ? "test" : docId ? "docs" : "test"));
    setSub(testId ? "test" : runOnly ? "run" : docId ? "doc" : "project");
  }, [testId, docId, runOnly]);

  useEffect(() => {
    if (focus?.step == null && sub === "step") setSub(runOnly ? "run" : "test");
    if (runOnly && sub === "test") setSub("run");
    if (!focus && (sub === "step" || sub === "test" || sub === "run")) setSub("project");
    if (focus && !focus.run && sub === "run") setSub("test");
    if (!docId && sub === "doc") setSub("all");
  }, [focus, docId, sub, runOnly]);

  const pickTab = (t: Tab) => {
    setTab(t);
    if (t === "docs") setSub(docId ? "doc" : "all");
    if (t === "test")
      setSub(runOnly ? "run" : focus ? (focus.step != null && sub === "step" ? "step" : "test") : "project");
  };

  // a request from the app (the palette's question, the test header's Ask Claude) sets the scope it is about
  const ask = (mode: "docs" | "test", scope?: "test" | "step" | "run" | "project") => {
    if (mode === "docs") {
      setTab(docId ? "docs" : "test");
      setSub(docId ? "doc" : "project");
    } else if (scope) {
      setTab("test");
      setSub(scope);
    }
  };

  const run = focus?.run;
  const scope: ClaudeScope =
    run && focus && (sub === "step" || sub === "test" || sub === "run")
      ? {
          kind: "run",
          run,
          ...(sub !== "run" && focus.testId ? { testId: focus.testId } : {}),
          ...(sub === "step" && focus.step != null ? { step: focus.step } : {}),
        }
      : sub === "step" && focus && focus.step != null
        ? { kind: "step", testId: focus.testId, step: focus.step }
        : sub === "test" && focus
          ? { kind: "test", testId: focus.testId }
          : { kind: "project" };
  const word =
    sub === "step" && focus?.step != null
      ? `Step ${focus.step}`
      : sub === "test" && focus
        ? run
          ? "This test"
          : (focus.key ?? "This test")
        : sub === "run" && run
          ? "This run"
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
          : run
            ? "Ask about this test, its notes and screenshots, or the run…"
            : "Ask Claude to change or explain this test…";
  const label =
    sub === "doc"
      ? `Ask about ${docId}`
      : sub === "all"
        ? "Ask the documents"
        : sub === "project"
          ? "Ask Claude about the project"
          : run
            ? "Ask Claude about the run"
            : "Ask Claude about this test";

  return { tab, sub, setSub, pickTab, ask, scope, word, placeholder, label };
}
