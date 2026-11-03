import { type ReactElement, useEffect, useState } from "react";
import { useApp } from "../../lib/app.ts";
import { project, setProject } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { baseName, desktop, openProject, pickFolder, reveal } from "../../lib/desktop.ts";
import { initials } from "../../lib/format.ts";
import { writePref } from "../../lib/prefs.ts";
import { errorToast } from "../../lib/toast.ts";
import type { ButtonProps } from "../ui/Button.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";
import { RailItem } from "../ui/RailItem.tsx";
import { OpenByKey } from "./OpenByKey.tsx";

type Known = { dir: string; name?: string; jiraProject?: string };

const asKnown = (v: unknown): Known[] =>
  (Array.isArray(v) ? v : ((v as { projects?: unknown[] })?.projects ?? [])).flatMap((p) =>
    typeof p === "string" ? [{ dir: p }] : p && typeof p === "object" && "dir" in p ? [p as Known] : [],
  );

// ponytail: the project at the top of the rail — its initials and Jira key; its menu switches to a known project,
// opens a folder (desktop) or a Jira key, starts a new one, shows the folder in Explorer (desktop)
export function ProjectButton() {
  const app = useApp();
  const [byKey, setByKey] = useState(false);
  const list = useRead("project.list", {});
  useEffect(() => {
    if (list.error) errorToast(list.error, "Could not list the projects");
  }, [list.error]);
  const p = app.info?.project;
  const name = p?.name || (app.info ? baseName(app.info.dir) : "No project");
  const key = p?.jiraProject;
  const here = app.info?.dir ?? project();
  const known = asKnown(list.data);
  const browse = async () => {
    const dir = await pickFolder("Open a project folder");
    if (dir) await openProject(app, dir).catch((e) => errorToast(e, "Could not open the project"));
  };
  const switchTo = (dir: string) => {
    setProject(dir);
    writePref("project", dir);
    app.refreshInfo();
    app.testsChanged();
  };
  const d = desktop();
  const entries: MenuEntry[] = [
    { group: "Projects" },
    ...(known.length
      ? known.map((k) => ({
          label: k.name || baseName(k.dir),
          icon: "folder" as const,
          hint: k.jiraProject || k.dir,
          checked: k.dir === here,
          onSelect: () => switchTo(k.dir),
        }))
      : [{ label: "No other project known yet", disabled: true, onSelect: () => {} }]),
    "separator",
    ...(d ? [{ label: "Open a folder…", icon: "folder-open" as const, onSelect: () => void browse() }] : []),
    { label: "Open by Jira key…", icon: "key", onSelect: () => setByKey(true) },
    { label: "New or other project…", icon: "plus", onSelect: () => app.navigate("setup", "project") },
    ...(d && here
      ? ([
          "separator",
          { label: "Show in Explorer", icon: "external", onSelect: () => void reveal(here) },
        ] as MenuEntry[])
      : []),
    { note: "« Don't show » and « Delete » for a project are in First launch › Project." },
  ];
  const trigger = (
    <RailItem
      label={key || "no key"}
      mono
      avatar={initials(name)}
      ariaLabel={`Project ${key || "not connected to Jira"} ${name}, change project`}
      onClick={() => void list.refetch()}
    />
  ) as unknown as ReactElement<ButtonProps>;
  return (
    <>
      {byKey && <OpenByKey onClose={() => setByKey(false)} />}
      <Menu label="Projects" trigger={trigger} entries={entries} />
    </>
  );
}
