import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import type { DocRef, Effort } from "../../../core/types.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import type { Key } from "../../lib/data/query.ts";
import { type DocScope, scopeOf } from "../../lib/scope.ts";

type Info = CommandOutput<"project.info">;
export type Chip = { id: string; on: boolean };

const draft = (field: string): Key => [project(), "gen.tests", { draft: field }];

function parse<T>(raw: string, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ponytail: everything the request holds is an unsent draft — it outlives the screen for the page's life (the model and
// effort picked here hold for the next generation until the app closes; the project defaults change in Settings); a
// document not converted yet is never in scope (search cannot read it)
export function useGenerateForm(info: Info | undefined, docs: DocRef[] | undefined) {
  const cfg = info?.project;
  const [request, setRequest] = useDraft(draft("request"));
  const [scopesRaw, setScopesRaw] = useDraft(draft("scopes"), "{}");
  const [chipsRaw, setChipsRaw] = useDraft(draft("contexts"));
  const [model, setModel] = useDraft(draft("model"));
  const [effort, setEffort] = useDraft(draft("effort"));
  const [folder, setFolder] = useDraft(draft("folder"));

  const scopes = parse<Record<string, DocScope>>(scopesRaw, {});
  const defaults = cfg?.claude?.contexts ?? [];
  const chips = parse<Chip[] | null>(chipsRaw, null) ?? defaults.map((id) => ({ id, on: true }));
  const ctxIds = chips.filter((c) => c.on).map((c) => c.id);
  const scope = scopeOf(
    scopes,
    (docs ?? []).filter((d) => d.converted?.at).map((d) => d.id),
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
      contexts: ctxIds,
      ...(folder.trim() ? { folder: folder.trim() } : {}),
      model: runModel,
      effort: runEffort,
    }) as CommandInput<"gen.tests">;

  return {
    request,
    setRequest,
    scopes,
    setScopes: (next: Record<string, DocScope>) => setScopesRaw(JSON.stringify(next)),
    chips,
    setChips: (next: Chip[]) => setChipsRaw(JSON.stringify(next)),
    ctxIds,
    scope,
    model,
    setModel,
    effort,
    setEffort,
    folder,
    setFolder,
    defaultModel,
    defaultEffort,
    runModel,
    runEffort,
    empty,
    input,
  };
}

export type GenerateForm = ReturnType<typeof useGenerateForm>;
