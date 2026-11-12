import type { CommandOutput } from "../../../core/commands/index.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import type { Key } from "../../lib/data/query.ts";
import { useCommand, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import type { Planned } from "./planEdits.ts";

export type Shown = CommandOutput<"gen.show">;

const draft = (generation: string, field: string): Key => [project(), "gen.plan", { generation, draft: field }];

function parse(raw: string): Record<string, string> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ponytail: a plan waiting for the user's go — what the core says of it (gen.show), the answers and the words for
// Claude kept as unsent drafts until they go with « Revise the plan » or « Write », and the edits written at once
// (gen.planSet, against the ledger the page read)
export function usePlan(generation: string) {
  const shown = useRead("gen.show", { generation });
  const data = shown.data as Shown | undefined;
  const [answersRaw, setAnswersRaw] = useDraft(draft(generation, "answers"), "{}");
  const [request, setRequest] = useDraft(draft(generation, "request"));
  const [reindexRaw, setReindexRaw] = useDraft(draft(generation, "reindex"), "1");
  const set = useCommand("gen.planSet", { invalidates: [["gen.show"]] });
  const answers = parse(answersRaw);
  const save = async (tests: Planned[]) => {
    try {
      await set.mutateAsync({ generation, plan: { tests }, ...(data ? { ifMtime: data.mtime } : {}) });
    } catch (e) {
      errorToast(e, "Could not change the plan");
    }
  };
  return {
    data,
    loading: shown.isPending,
    error: shown.isError ? shown.error : null,
    answers,
    answer: (id: string, text: string) => setAnswersRaw(JSON.stringify({ ...answers, [id]: text })),
    clearAnswers: () => setAnswersRaw("{}"),
    request,
    setRequest,
    reindex: reindexRaw !== "0",
    setReindex: (on: boolean) => setReindexRaw(on ? "1" : "0"),
    saving: set.isPending,
    save,
  };
}

export type PlanState = ReturnType<typeof usePlan>;
