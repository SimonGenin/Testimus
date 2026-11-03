import { useEffect, useState } from "react";
import { call } from "../../api.ts";
import { Button, IconButton, Menu, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, openProject, pickFolder } from "../../lib/desktop.ts";
import { cx, message } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { DeleteProject } from "./DeleteProject.tsx";

type Known = { dir: string; name: string; jiraProject: string; exists: boolean };

export function ProjectStep({ onBack, onOpened }: { onBack: () => void; onOpened?: () => void }) {
  const app = useApp();
  const [known, setKnown] = useState<Known[] | null>(null);
  const [dir, setDir] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("fr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [del, setDel] = useState<Known | null>(null);

  const drop = (d: string) => setKnown((ks) => ks?.filter((k) => k.dir !== d) ?? ks);

  const hide = async (d: string) => {
    try {
      await call("project.forget", { dir: d });
      drop(d);
    } catch (e) {
      errorToast(e, "Could not hide the project");
    }
  };

  useEffect(() => {
    call<{ projects: Known[] }>("project.list", {})
      .then((r) => setKnown(r?.projects ?? []))
      .catch(() => setKnown([]));
  }, []);

  const open = async (d: string) => {
    setBusy(true);
    setError("");
    try {
      await openProject(app, d);
      if (onOpened) onOpened();
      else app.navigate("documents");
    } catch (e) {
      setError(message(e));
      errorToast(e, "Could not open the project");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!dir.trim()) return;
    setBusy(true);
    setError("");
    try {
      await call("project.init", {
        dir: dir.trim(),
        ...(key.trim() ? { jiraProject: key.trim().toUpperCase() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        language,
      });
      await open(dir.trim());
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const current = app.info?.dir;
  return (
    <div className="setup-form">
      <h1 className="h setup-title">Choose a project</h1>
      <p className="muted">
        A project is a folder: the documents, the tests and what Claude needs. Share it by sharing the folder.
      </p>
      {!known ? (
        <Skeleton h={48} />
      ) : (
        known.length > 0 && (
          <ul className="card setup-projects" aria-label="Known projects">
            {known.map((k) => (
              <li key={k.dir} className={cx("setup-proj", k.dir === current && "is-on")}>
                <span>
                  <span className="setup-proj-name">{k.name || k.dir}</span>{" "}
                  <span className="mono muted">{k.jiraProject}</span>
                  <br />
                  <span className="muted mono setup-proj-dir">{k.dir}</span>
                </span>
                <span className="spacer" />
                {k.exists ? (
                  <Button
                    size="sm"
                    tone={k.dir === current ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() => void open(k.dir)}
                  >
                    {k.dir === current ? "Open again" : "Open"}
                  </Button>
                ) : (
                  <span className="muted">Folder not found</span>
                )}
                <Menu
                  label={`More actions for ${k.name || k.dir}`}
                  align="right"
                  items={[
                    { key: "hide", label: "Don't show", onSelect: () => void hide(k.dir) },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "trash",
                      danger: true,
                      disabled: busy || !k.exists || k.dir === current,
                      title:
                        k.dir === current
                          ? "Open another project first"
                          : k.exists
                            ? "Delete the project folder from this PC"
                            : undefined,
                      onSelect: () => setDel(k),
                    },
                  ]}
                  trigger={({ open, toggle, id }) => (
                    <IconButton
                      icon="more"
                      label={`More actions for ${k.name || k.dir}`}
                      aria-expanded={open}
                      aria-controls={open ? id : undefined}
                      onClick={toggle}
                    />
                  )}
                />
              </li>
            ))}
          </ul>
        )
      )}
      {del && (
        <DeleteProject
          target={del}
          onClose={() => setDel(null)}
          onDeleted={() => {
            drop(del.dir);
            setDel(null);
          }}
        />
      )}
      <fieldset className="setup-set">
        <legend className="h">New project</legend>
        <div className="formfield">
          <label className="label" htmlFor="proj-dir">
            Folder
          </label>
          <div className="pickrow">
            <input
              id="proj-dir"
              className="field mono"
              placeholder="C:\…\Tests LFRPS12"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
            />
            {desktop() && (
              <Button
                aria-label="Browse for the project folder"
                disabled={busy}
                onClick={() => void pickFolder("Choose the project folder").then((d) => d && setDir(d))}
              >
                Browse…
              </Button>
            )}
          </div>
        </div>
        <div className="formgrid">
          <div className="formfield">
            <label className="label" htmlFor="proj-key">
              Jira project
            </label>
            <input
              id="proj-key"
              className="field mono"
              placeholder="LFRPS12"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="formfield">
            <label className="label" htmlFor="proj-name">
              Name
            </label>
            <input
              id="proj-name"
              className="field"
              placeholder="RATP Sosie"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="formfield">
            <label className="label" htmlFor="proj-lang">
              Language of the tests
            </label>
            <select id="proj-lang" className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        {error && <p className="sev s-err">{error}</p>}
        <div className="setup-actions">
          <Button tone="quiet" onClick={onBack}>
            Back
          </Button>
          <span className="spacer" />
          <Button tone="primary" disabled={!dir.trim() || busy} onClick={() => void create()}>
            Create the project
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
