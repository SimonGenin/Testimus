import type { AppState } from "../lib/app.ts";
import { useCommand } from "../lib/data/query.ts";
import { desktop, pickFolder, showProject } from "../lib/desktop.ts";
import { errorToast } from "../lib/toast.ts";

// ponytail: the palette's « Open a folder as a project… » — the desktop's folder picker, then that folder becomes the
// open project; in a browser there is no picker, so First launch › Project asks for the folder
export function useOpenFolder(app: Pick<AppState, "navigate" | "refreshInfo" | "testsChanged">): () => Promise<void> {
  const open = useCommand("project.open", { invalidates: [["project.list"]] });
  return async () => {
    if (!desktop()) return app.navigate("setup", "project");
    const dir = await pickFolder("Open a project folder");
    if (!dir) return;
    await open
      .mutateAsync({ dir })
      .then((r) => showProject(app, r.dir))
      .catch((e) => errorToast(e, "Could not open the project"));
  };
}
