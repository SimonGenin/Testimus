import { type ReactElement, useEffect } from "react";
import { SETUP_FROM_APP, useApp } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { baseName, showProject } from "../../lib/desktop.ts";
import { initials } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import type { ButtonProps } from "../ui/Button.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";
import { RailItem } from "../ui/RailItem.tsx";

type Known = { dir: string; name?: string; jiraProject?: string };

const asKnown = (v: unknown): Known[] =>
  (Array.isArray(v) ? v : ((v as { projects?: unknown[] })?.projects ?? [])).flatMap((p) =>
    typeof p === "string" ? [{ dir: p }] : p && typeof p === "object" && "dir" in p ? [p as Known] : [],
  );

// ponytail: the project at the top of the rail — its initials and Jira key; its menu switches to a known project, and
// « All projects… » goes to First launch › Project, where a folder, a Jira key or a new project is opened
export function ProjectButton() {
  const app = useApp();
  const list = useRead("project.list", {});
  useEffect(() => {
    if (list.error) errorToast(list.error, "Could not list the projects");
  }, [list.error]);
  const p = app.info?.project;
  const name = p?.name || (app.info ? baseName(app.info.dir) : "No project");
  const key = p?.jiraProject;
  const here = app.info?.dir ?? project();
  const known = asKnown(list.data);
  const entries: MenuEntry[] = [
    { group: "Projects" },
    ...(known.length
      ? known.map((k) => ({
          label: k.name || baseName(k.dir),
          icon: "folder" as const,
          hint: k.jiraProject || "no key",
          checked: k.dir === here,
          onSelect: () => void showProject(app, k.dir),
        }))
      : [{ label: "No other project known yet", disabled: true, onSelect: () => {} }]),
    "separator",
    { label: "All projects…", icon: "list", onSelect: () => app.navigate("setup", SETUP_FROM_APP) },
  ];
  const trigger = (
    <RailItem
      label={app.info ? key || "no key" : "no project"}
      mono
      {...(app.info ? { avatar: initials(name) } : { icon: "folder" as const })}
      ariaLabel={app.info ? `Project ${key || "not connected to Jira"} ${name}, change project` : "Open a project"}
      onClick={() => void list.refetch()}
    />
  ) as unknown as ReactElement<ButtonProps>;
  return <Menu label="Projects" align="beside" trigger={trigger} entries={entries} />;
}
