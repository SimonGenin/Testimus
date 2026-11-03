import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectJson } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
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

// ponytail: CLAUDE.md is written 400 ms after the last key, on blur and when the screen goes; a pending text
// belongs to the project it was typed in and is dropped rather than written into the next one
function ProjectNotes({ dir }: { dir: string }) {
  const [text, setText] = useState<string | null>(null);
  const [file, setFile] = useState("CLAUDE.md");
  const unsaved = useRef<{ dir: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const u = unsaved.current;
    unsaved.current = null;
    const now = project();
    if (!u || (now && now !== u.dir)) return;
    call("project.setNotes", { text: u.text }).catch((e) => errorToast(e, "Could not save the project notes"));
  }, []);
  useEffect(() => {
    call<{ file: string; text: string }>("project.notes", {})
      .then((r) => {
        setText(r?.text ?? "");
        if (r?.file) setFile(r.file);
      })
      .catch(() => setText(""));
    return flush;
  }, [flush]);
  return (
    <div className="formfield">
      <label className="label" htmlFor="set-notes">
        Project notes
      </label>
      <textarea
        id="set-notes"
        className="field mono notes-area"
        rows={10}
        disabled={text === null}
        placeholder="Conventions, vocabulary, what Claude should know about this project…"
        value={text ?? ""}
        onChange={(e) => {
          setText(e.target.value);
          unsaved.current = { dir, text: e.target.value };
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 400);
        }}
        onBlur={flush}
      />
      <span className="muted">
        Markdown, saved to <span className="mono">{file}</span> and read by Claude in every run.
      </span>
    </div>
  );
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
  const saveKey = () =>
    p &&
    key.trim() &&
    key.trim().toUpperCase() !== p.jiraProject &&
    void saveProject({ jiraProject: key.trim().toUpperCase() }, app.refreshInfo, "Jira project");
  const savePrefix = () =>
    p &&
    prefix.trim() &&
    prefix !== p.labelPrefix &&
    void saveProject({ labelPrefix: prefix.trim() }, app.refreshInfo, "Label prefix");
  // ponytail: leaving Settings unmounts it without a blur — what was typed is saved from the cleanup (Xray Editor)
  const onUnmount = useRef(() => {});
  onUnmount.current = () => {
    saveKey();
    savePrefix();
  };
  useEffect(() => () => onUnmount.current(), []);
  if (!p || !app.info) return null;
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
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            onBlur={saveKey}
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
            onBlur={savePrefix}
          />
        </div>
      </div>
      <p className="muted">
        Pushed tests carry their review state as a label: <span className="mono">{prefix}validated</span>,{" "}
        <span className="mono">{prefix}to-fix</span>…
      </p>
      <ProjectNotes key={app.info.dir} dir={app.info.dir} />
    </section>
  );
}
