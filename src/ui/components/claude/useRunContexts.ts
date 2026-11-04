import { useEffect, useState } from "react";
import type { Focus } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { useContexts } from "./contexts.ts";
import type { Sub, Tab } from "./DockScope.tsx";

// ponytail: the contexts a dock run reads — on a test its own list (else the project's defaults), on the whole project
// every context the project or a test attaches, none for a question to the documents — and what the user switched off
// or added for this run only; another scope or another test starts again from its own list
export function useRunContexts({
  tab,
  sub,
  focus,
  docId,
  projectDir,
  defaults,
}: {
  tab: Tab;
  sub: Sub;
  focus: Focus | null;
  docId: string | null;
  projectDir: string | undefined;
  defaults: string[] | undefined;
}) {
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const testId = focus?.testId;
  const onProject = tab === "test" && sub === "project";
  const ofProject = useRead("contexts.ofProject", {}, { enabled: !!projectDir && onProject });
  const ofTest = useRead(
    "contexts.ofTest",
    { testId: testId ?? "" },
    { enabled: !!projectDir && !onProject && !!testId },
  );
  const effectiveOf = (r: typeof ofProject | typeof ofTest) =>
    (r.data as { effective?: string[] } | undefined)?.effective;
  const saved = useContexts(!!projectDir);
  const effective = (
    tab !== "test" ? [] : ((onProject ? effectiveOf(ofProject) : testId ? effectiveOf(ofTest) : defaults) ?? [])
  ).filter((id) => !saved?.length || saved.some((c) => c.id === id));
  const known = tab !== "test" || (onProject ? !!ofProject.data : testId ? !!ofTest.data : !!defaults);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope or another test starts from its own contexts
  useEffect(() => setPick({}), [tab, sub, testId, docId]);

  return { effective, pick, setPick, saved, known };
}
