import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AppState, useApp } from "../../lib/app.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { showProject } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export type Known = { dir: string; name: string; jiraProject: string; exists: boolean };

type List = { projects?: Known[]; root?: string; last?: string };

// ponytail: the list leaves a project at once; the read after the command says what the server kept
const dropping = (dir: string) => (client: QueryClient) => {
  const k = key("project.list", {});
  const before = client.getQueryData<List>(k);
  client.setQueryData<List | null>(k, (l) =>
    l?.projects ? { ...l, projects: l.projects.filter((p) => p.dir !== dir) } : l,
  );
  return () => client.setQueryData(k, before);
};

export const labelOf = (k: Pick<Known, "name" | "dir">) => k.name || k.dir;

// ponytail: the known projects of this PC and what the Project step does with them — open, hide, delete — and a new
// project; opening or creating one makes it the page's project (showProject)
export function useProjects(onOpened?: () => void) {
  const app = useApp();
  const client = useQueryClient();
  const read = useRead("project.list", {});
  const data = (read.data ?? null) as List | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");

  const afterOpen = () => (onOpened ? onOpened() : app.navigate("documents"));

  const opened = (a: AppState, dir: string) => {
    showProject(a, dir);
    afterOpen();
  };

  const open = async (dir: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await execute(client, "project.open", { dir }, { invalidates: [["project.list"]] });
      opened(app, r?.dir ?? dir);
    } catch (e) {
      setError(message(e));
      setFailed("Could not open the project");
    } finally {
      setBusy(false);
    }
  };

  const create = async (input: { dir: string; jiraProject?: string; name?: string; language: string }) => {
    setBusy(true);
    setError("");
    try {
      const r = await execute(client, "project.init", input, { invalidates: [["project.list"]] });
      setBusy(false);
      opened(app, r.dir);
      return true;
    } catch (e) {
      setError(message(e));
      setFailed("Could not create the project");
      setBusy(false);
      return false;
    }
  };

  const hide = (k: Known) =>
    execute(
      client,
      "project.forget",
      { dir: k.dir },
      { invalidates: [["project.list"]], optimistic: dropping(k.dir) },
    ).catch((e) => errorToast(e, "Could not hide the project"));

  const remove = async (k: Known, gone: boolean): Promise<boolean> => {
    try {
      await execute(
        client,
        "project.delete",
        { dir: k.dir },
        { invalidates: [["project.list"]], optimistic: dropping(k.dir) },
      );
      if (k.dir === app.info?.dir) app.closeProject();
      toast(
        gone
          ? { tone: "neutral", title: `Project ${labelOf(k)} removed`, detail: "Its folder was already gone." }
          : { tone: "neutral", title: `Project ${labelOf(k)} deleted`, detail: "Jira is untouched." },
      );
      return true;
    } catch (e) {
      errorToast(e, gone ? "Could not remove the project" : "Could not delete the project");
      return false;
    }
  };

  return {
    known: read.isPending ? null : (data?.projects ?? []),
    root: data?.root ?? "",
    current: app.info?.dir,
    busy,
    error,
    /** what failed, the banner's title (« Could not open the project ») */
    failed,
    afterOpen,
    open,
    create,
    hide,
    remove,
  };
}
