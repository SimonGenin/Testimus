import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import type { DocRef, Effort } from "../../../core/types.ts";
import { pickOf } from "../../components/claude/pieces.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import type { Key } from "../../lib/data/query.ts";
import { type DocScope, type DocWork, scopeOf, unready } from "../../lib/scope.ts";

type Info = CommandOutput<"project.info">;

const draft = (field: string): Key => [project(), "gen.tests", { draft: field }];

function parse<T>(raw: string, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ponytail: everything the request holds is an unsent draft — it outlives the screen for the page's life (the model and
// effort picked here hold for the next generation until the app closes; the project defaults change in Settings; what
// was ticked in the request's Context is kept the same way, under contextKey); a document search cannot read yet (not
// converted, not indexed, or being converted or indexed) is never in scope
export function useGenerateForm(info: Info | undefined, docs: DocRef[] | undefined, work: DocWork) {
  const cfg = info?.project;
  const [request, setRequest] = useDraft(draft("request"));
  const [scopesRaw, setScopesRaw] = useDraft(draft("scopes"), "{}");
  const contextKey = draft("context");
  const [pickRaw] = useDraft(contextKey);
  const [model, setModel] = useDraft(draft("model"));
  const [effort, setEffort] = useDraft(draft("effort"));
  const [folder, setFolder] = useDraft(draft("folder"));
  // ponytail: « Review the plan before writing » is ticked until the user unticks it (decision 4 of WORKLOAD.md)
  const [reviewRaw, setReviewRaw] = useDraft(draft("review"), "1");
  const review = reviewRaw !== "0";

  const scopes = parse<Record<string, DocScope>>(scopesRaw, {});
  const pick = pickOf(pickRaw);
  const scope = scopeOf(
    scopes,
    (docs ?? []).filter((d) => !unready(d, work)).map((d) => d.id),
  );
  const defaultModel = cfg?.claude?.model || "opus";
  const defaultEffort: Effort = cfg?.claude?.effort || "high";
  const runModel = model || defaultModel;
  const runEffort = (effort || defaultEffort) as Effort;
  const empty = !request.trim() && !scope.docs.length && !scope.sections.length;

  const input = (): CommandInput<"gen.tests"> =>
    ({
      request: request.trim(),
      ...(scope.docs.length ? { docs: scope.docs } : {}),
      ...(scope.sections.length ? { sections: scope.sections } : {}),
      ...pick,
      ...(folder.trim() ? { folder: folder.trim() } : {}),
      ...(review ? { review: true } : {}),
      model: runModel,
      effort: runEffort,
    }) as CommandInput<"gen.tests">;

  return {
    request,
    setRequest,
    scopes,
    setScopes: (next: Record<string, DocScope>) => setScopesRaw(JSON.stringify(next)),
    contextKey,
    pick,
    scope,
    model,
    setModel,
    effort,
    setEffort,
    folder,
    setFolder,
    review,
    setReview: (on: boolean) => setReviewRaw(on ? "1" : "0"),
    defaultModel,
    defaultEffort,
    runModel,
    runEffort,
    empty,
    input,
  };
}

export type GenerateForm = ReturnType<typeof useGenerateForm>;
