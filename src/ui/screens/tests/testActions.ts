import type { QueryClient } from "@tanstack/react-query";
import type { AppState } from "../../lib/app.ts";
import { flushAutosaves } from "../../lib/data/autosave.ts";
import { execute } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";

const saveOf = (id: string) => () => flushAutosaves([["tests.show", { id }]]);

// ponytail: Clone from the editor's menu or the list's toolbar — the edit on screen is saved first (a copy is never made
// of a file that is not what the screen shows), then the copy opens and one toast says so
export async function cloneTest(
  client: QueryClient,
  app: Pick<AppState, "testsChanged">,
  id: string,
  open: (id: string) => void,
  save: () => Promise<unknown> = saveOf(id),
): Promise<void> {
  const unsaved = await save();
  if (unsaved) return void errorToast(unsaved, "Not cloned");
  try {
    const r = (await execute(client, "tests.clone", { id }, { invalidates: [["tests.list"], ["project.info"]] })) as {
      id: string;
    };
    app.testsChanged();
    open(r.id);
    toast({ tone: "success", title: "Cloned", detail: "The copy is a new local test." });
  } catch (e) {
    errorToast(e, "Could not clone the test");
  }
}
