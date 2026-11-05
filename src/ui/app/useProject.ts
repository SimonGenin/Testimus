import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnLayout, CredsStatus } from "../../core/types.ts";
import type { ProjectInfo, Screen } from "../lib/app.ts";
import { ApiError, commands, project, setProject } from "../lib/data/client.ts";
import { execute, invalidate, read, useRead } from "../lib/data/query.ts";
import { DEFAULT_LAYOUT } from "../lib/fields.ts";
import { readPref, writePref } from "../lib/prefs.ts";
import { mirrorPrefs, restorePrefs } from "../lib/prefsMirror.ts";
import { errorToast } from "../lib/toast.ts";
import { parseRoute } from "./routes.ts";

const refused = (e: unknown) => e instanceof ApiError && e.status === 403;

// ponytail: GET /api — the registry's commands (the palette), the server's project and whether it is the mock
export function useApi() {
  return useQuery({
    queryKey: [null, "GET /api"],
    queryFn: () => commands(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

// ponytail: the window's project — the one it remembers (dropped when the server no longer knows it) or the server's;
// a first run (no project, or no Jira access) goes to Setup once a session; its step columns are read again from
// Xray once per opening, quietly
export function useProject(navigate: (screen: Screen, arg?: string) => void) {
  const client = useQueryClient();
  const api = useApi();
  const [dir, setDir] = useState<string | null>(project());
  const [booted, setBooted] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (api.error) errorToast(api.error, "Testimus is not answering");
  }, [api.error]);

  useEffect(() => {
    const r = api.data;
    if (!r || started.current) return;
    started.current = true;
    let stop = () => {};
    void (async () => {
      if (await restorePrefs(client)) {
        window.location.reload();
        return;
      }
      stop = mirrorPrefs(client);
      const stored = readPref("project");
      setProject(stored || r.project);
      if (stored && (await read(client, "project.info", {}, stored).then(() => false, refused))) {
        writePref("project", "");
        setProject(r.project);
      }
      const here = project();
      setDir(here);
      setBooted(true);
      if (readPref("setupShown") || parseRoute(window.location.hash).screen === "setup") return;
      const [st, settings, list] = await Promise.all([
        read(client, "system.credentials", {}).catch(() => null) as Promise<{ status: CredsStatus } | null>,
        read(client, "system.settings", {}).catch(() => null),
        here ? null : read(client, "project.list", {}, null).catch(() => null),
      ]);
      const skip = settings?.atlassian ?? {};
      const jira = skip.skipJira || !st?.status || st.status.jira.complete;
      const xray = skip.skipJira || skip.skipXray || !st?.status || st.status.xray.complete;
      const creds = jira && xray;
      const known = !!list?.projects?.length;
      if (!here || !creds) {
        writePref("setupShown", true);
        navigate("setup", here ? "access" : known && creds ? "project" : undefined);
      }
    })();
    return () => stop();
  }, [api.data, client, navigate]);

  const info = useRead("project.info", {}, { enabled: booted && !!dir });
  useEffect(() => {
    if (info.error) errorToast(info.error, "Could not read the project");
  }, [info.error]);
  const data = (info.data ?? null) as ProjectInfo | null;

  const fieldsFor = useRef("");
  const jiraKey = data?.project.jiraOffline ? "" : data?.project.jiraProject;
  useEffect(() => {
    if (!dir || !jiraKey || fieldsFor.current === dir) return;
    fieldsFor.current = dir;
    void execute(client, "xray.refreshFields", {}, { invalidates: [["project.info"], ["columns.list"]] }).catch(
      () => {},
    );
  }, [client, dir, jiraKey]);

  const xray: ColumnLayout = useMemo(
    () => ({
      ...(data?.xray?.fetchedAt ? { fetchedAt: data.xray.fetchedAt } : {}),
      fields: data?.xray?.fields?.length ? data.xray.fields : DEFAULT_LAYOUT.fields,
      columns: data?.columns?.length ? data.columns : DEFAULT_LAYOUT.columns,
    }),
    [data],
  );

  // ponytail: a screen that switched the project (setProject) asks for its info: the window follows that project
  const refreshInfo = useCallback(() => {
    setDir(project());
    void invalidate(client, [["project.info"]]);
  }, [client]);

  const closeProject = useCallback(() => {
    setProject(null);
    writePref("project", "");
    setDir(null);
  }, []);

  return {
    commands: api.data?.commands ?? [],
    mock: !!api.data?.mock,
    dir,
    booted,
    info: data,
    xray,
    refreshInfo,
    closeProject,
  };
}
