import { useEffect, useState } from "react";
import type { ProjectJson } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export async function saveProject(patch: Record<string, unknown>, refresh: () => void, what: string) {
  try {
    await call<ProjectJson>("project.set", patch);
    refresh();
    toast({ kind: "ok", title: `${what} saved` });
  } catch (e) {
    errorToast(e, `Could not save ${what.toLowerCase()}`);
  }
}

export function ProjectSection() {
  const app = useApp();
  const p = app.info?.project;
  const [key, setKey] = useState(p?.jiraProject ?? "");
  const [prefix, setPrefix] = useState(p?.labelPrefix ?? "testimus-");
  useEffect(() => {
    setKey(p?.jiraProject ?? "");
    setPrefix(p?.labelPrefix ?? "testimus-");
  }, [p?.jiraProject, p?.labelPrefix]);
  if (!p) return null;
  return (
    <section className="card sect" id="settings-project" aria-labelledby="s-proj">
      <h2 id="s-proj" className="h sect-title">
        Project
      </h2>
      <div className="formgrid">
        <div className="formfield">
          <label className="label" htmlFor="set-jira">
            Jira project
          </label>
          <input
            id="set-jira"
            className="field mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() =>
              key.trim() &&
              key.trim() !== p.jiraProject &&
              void saveProject({ jiraProject: key.trim() }, app.refreshInfo, "Jira project")
            }
          />
        </div>
        <div className="formfield">
          <label className="label" htmlFor="set-lang">
            Language of the tests
          </label>
          <select
            id="set-lang"
            className="field"
            value={p.language}
            onChange={(e) => void saveProject({ language: e.target.value }, app.refreshInfo, "Language")}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
            {!["fr", "en"].includes(p.language) && <option value={p.language}>{p.language}</option>}
          </select>
        </div>
        <div className="formfield">
          <label className="label" htmlFor="set-prefix">
            Review label prefix
          </label>
          <input
            id="set-prefix"
            className="field mono"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            onBlur={() =>
              prefix.trim() &&
              prefix !== p.labelPrefix &&
              void saveProject({ labelPrefix: prefix.trim() }, app.refreshInfo, "Label prefix")
            }
          />
        </div>
      </div>
      <p className="muted">
        Pushed tests carry their review state as a label: <span className="mono">{prefix}validated</span>,{" "}
        <span className="mono">{prefix}to-fix</span>…
      </p>
    </section>
  );
}
