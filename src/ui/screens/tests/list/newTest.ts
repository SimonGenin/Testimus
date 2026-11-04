import { useQueryClient } from "@tanstack/react-query";
import { execute } from "../../../lib/data/query.ts";
import { errorToast } from "../../../lib/toast.ts";
import { useListView } from "./useListView.ts";

// ponytail: « New test » puts the test in one place wherever it is pressed — the Jira folder picked on the Jira tab
// (not while a search shows), else the folder of the open test, else the root
export function useNewTest(openFolder: string | undefined, onCreated: (id: string) => void | Promise<void>) {
  const client = useQueryClient();
  const v = useListView();
  const folder = v.tab === "jira" && !v.search.trim() ? v.folder : (openFolder ?? "/");
  const create = async () => {
    try {
      const r = (await execute(
        client,
        "tests.create",
        { folder, summary: "New test" },
        { invalidates: [["tests.list"], ["project.info"]] },
      )) as { id: string };
      await onCreated(r.id);
    } catch (e) {
      errorToast(e, "Could not create the test");
    }
  };
  return { folder, create };
}
