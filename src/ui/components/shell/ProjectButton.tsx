import { useState } from "react";
import { call, project, setProject } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { baseName, desktop, openProject, pickFolder, reveal } from "../../lib/desktop.ts";
import { initials } from "../../lib/format.ts";
import { writePref } from "../../lib/theme.ts";
import { errorToast } from "../../lib/toast.ts";
import { Menu, type MenuItem } from "../ui/index.ts";
import { OpenByKey } from "./OpenByKey.tsx";

type Known = { dir: string; name?: string; jiraProject?: string };

const asKnown = (v: unknown): Known[] =>
  (Array.isArray(v) ? v : ((v as { projects?: unknown[] })?.projects ?? [])).flatMap((p) =>
    typeof p === "string" ? [{ dir: p }] : p && typeof p === "object" && "dir" in p ? [p as Known] : [],
  );

export function ProjectButton() {
  const app = useApp();
  const [known, setKnown] = useState<Known[]>([]);
  const [byKey, setByKey] = useState(false);
  const p = app.info?.project;
  const name = p?.name || (app.info ? baseName(app.info.dir) : "No project");
  const key = p?.jiraProject || "—";
  const here = app.info?.dir ?? project();
  const load = () =>
    call("project.list", {})
      .then((r) => setKnown(asKnown(r)))
      .catch((e) => errorToast(e, "Could not list the projects"));
  const browse = async () => {
    const dir = await pickFolder("Open a project folder");
    if (!dir) return;
    await openProject(app, dir).catch((e) => errorToast(e, "Could not open the project"));
  };
  const items: MenuItem[] = known.length
    ? known.map((k) => ({
        key: k.dir,
        label: (
          <span className="proj-item">
            <span>{k.name || baseName(k.dir)}</span>
            <span className="mono muted">{k.jiraProject ?? k.dir}</span>
          </span>
        ),
        on: k.dir === here,
        title: k.dir,
        onSelect: () => {
          setProject(k.dir);
          writePref("testimus.project", k.dir);
          app.refreshInfo();
          app.testsChanged();
        },
      }))
    : [{ key: "none", label: "No other project known yet", disabled: true, onSelect: () => {} }];
  items.push({ kind: "sep", key: "sep" });
  if (desktop()) {
    items.push({ key: "browse", label: "Open a folder…", icon: "folder", onSelect: () => void browse() });
    if (here)
      items.push({
        key: "reveal",
        label: "Show in Explorer",
        icon: "external",
        title: here,
        onSelect: () => void reveal(here),
      });
  }
  items.push({ key: "bykey", label: "Open by Jira key…", icon: "search", onSelect: () => setByKey(true) });
  items.push({
    key: "new",
    label: "New or other project…",
    icon: "plus",
    onSelect: () => app.navigate("setup", "project"),
  });
  return (
    <>
      {byKey && <OpenByKey onClose={() => setByKey(false)} />}
      <Menu
        label="Projects"
        className="rail-project"
        items={items}
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            className="rail-item"
            aria-label={`Project ${key} ${name}, change project`}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => {
              if (!open) void load();
              toggle();
            }}
          >
            <span className="proj-mark">{initials(name)}</span>
            <span className="mono proj-key">{key}</span>
          </button>
        )}
      />
    </>
  );
}
