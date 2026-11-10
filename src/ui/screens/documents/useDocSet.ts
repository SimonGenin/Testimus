import { useQueryClient } from "@tanstack/react-query";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { DocJson } from "../../../core/types.ts";
import { key, useCommand } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";

type Shown = CommandOutput<"docs.show">;

// ponytail: what the team decides on a document from its head and side — its status (shown at once, put back on a
// refusal) and whether an images or video document is the reference; the document read after each save is the one
// the page shows
export function useDocSet(id: string) {
  const client = useQueryClient();
  const k = key("docs.show", { id, brief: true }) as unknown as readonly unknown[];
  const set = useCommand("docs.set", {
    invalidates: [["docs.list"]],
    optimistic: (c, input) => {
      const before = c.getQueryData<Shown>(k);
      if (before && input.status) c.setQueryData<Shown>(k, { ...before, doc: { ...before.doc, status: input.status } });
      return () => c.setQueryData(k, before);
    },
  });
  const save = (input: { status?: DocJson["status"]; reference?: boolean }) =>
    set.mutate(
      { id, ...input },
      {
        onSuccess: (doc) => client.setQueryData<Shown>(k, (old) => (old ? { ...old, doc } : old)),
        onError: (e) => errorToast(e, "Could not save the document"),
      },
    );
  return {
    status: (status: DocJson["status"]) => save({ status }),
    reference: (reference: boolean) => save({ reference }),
  };
}
