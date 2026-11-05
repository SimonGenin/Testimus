import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { desktop, examplePath, pathJoin, pickFolder } from "../../lib/desktop.ts";
import { breakpoint, color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  set: { display: "flex", flexDirection: "column", gap: space.s4 },
  title: { margin: 0, color: color.text },
  pair: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [breakpoint.narrow]: "1fr" },
    rowGap: space.s4,
    columnGap: space.s5,
    alignItems: "start",
  },
});

export function projectFolder(where: string, title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/[. ]+$/, "")
    .trim();
  return where.trim() && name ? pathJoin(where.trim(), name) : "";
}

const draft = (field: string) => [null, "project.init", { field }] as const;

export type NewProjectInput = { dir: string; jiraProject?: string; name?: string; language: string };

// ponytail: a new project — its folder is named after it inside the projects folder (project.list's root until one is
// typed); what is typed is kept while the screen changes
export function useNewProject(root: string) {
  const [where, setWhere, clearWhere] = useDraft(draft("where"), "");
  const [key, setKey, clearKey] = useDraft(draft("key"), "");
  const [name, setName, clearName] = useDraft(draft("name"), "");
  const [language, setLanguage, clearLanguage] = useDraft(draft("language"), "fr");
  const seeded = useRef(false);
  useEffect(() => {
    if (!root || seeded.current) return;
    seeded.current = true;
    if (!where) setWhere(root);
  }, [root, where]);
  const dir = projectFolder(where, name.trim() || key.trim().toUpperCase());
  const input: NewProjectInput = {
    dir,
    ...(key.trim() ? { jiraProject: key.trim().toUpperCase() } : {}),
    ...(name.trim() ? { name: name.trim() } : {}),
    language,
  };
  const clear = () => {
    for (const c of [clearWhere, clearKey, clearName, clearLanguage]) c();
  };
  return { where, setWhere, key, setKey, name, setName, language, setLanguage, dir, input, clear };
}

export type JiraChoice =
  /** Jira is left out on this PC: no field */
  | { kind: "off" }
  /** the projects Jira lists for this account, picked from */
  | { kind: "list"; projects: { key: string; name: string }[] }
  /** no list (no access yet, or Jira did not answer): the key typed */
  | { kind: "typed" };

export function NewProject({
  f,
  busy,
  first,
  jira,
}: {
  f: ReturnType<typeof useNewProject>;
  busy: boolean;
  /** no project is known yet: the section is the only way on */
  first: boolean;
  jira: JiraChoice;
}) {
  const picked = jira.kind === "list" ? jira.projects.find((p) => p.key === f.key.trim().toUpperCase()) : undefined;
  const [none, setNone] = useState(false);
  return (
    <section aria-labelledby="new-project" {...stylex.props(styles.set)}>
      <h2 id="new-project" {...stylex.props(type.titleSm, styles.title)}>
        {first ? "New project" : "Or start a new project"}
      </h2>
      <div {...stylex.props(styles.pair)}>
        {jira.kind === "list" ? (
          <Select
            id="proj-jira"
            label="Jira project"
            showLabel
            block
            placeholder="Pick the Jira project"
            hint="Its tests and step columns come with it."
            value={picked?.key ?? (none ? "" : null)}
            onChange={(k) => {
              setNone(k === "");
              const p = jira.projects.find((x) => x.key === k);
              f.setKey(k);
              if (p && (!f.name.trim() || jira.projects.some((x) => x.name === f.name.trim()))) f.setName(p.name);
            }}
            options={[
              { value: "", label: "No Jira project" },
              ...jira.projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })),
            ]}
          />
        ) : jira.kind === "typed" ? (
          <Text
            id="proj-key"
            label="Jira project key"
            hint="Optional: a project without a key never asks Jira."
            placeholder="e.g. LFRPS12"
            value={f.key}
            onChange={f.setKey}
          />
        ) : null}
        <Text id="proj-name" label="Name" placeholder="e.g. RATP Sosie" value={f.name} onChange={f.setName} />
      </div>
      <div {...stylex.props(styles.pair)}>
        <Select
          id="proj-lang"
          label="Language of the tests"
          showLabel
          block
          value={f.language}
          onChange={f.setLanguage}
          options={[
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
      </div>
      <Text
        id="proj-where"
        label="Projects folder"
        placeholder={examplePath("D:\\Testimus\\Projects", "/Users/you/Testimus/Projects")}
        hint={
          f.dir
            ? `The project is created in ${f.dir}`
            : "The project gets its own folder in it, named after the project."
        }
        value={f.where}
        onChange={f.setWhere}
        trailing={
          desktop() ? (
            <Button
              variant="quiet"
              size="sm"
              label="Browse…"
              disabled={busy}
              onClick={() => void pickFolder("Choose where the project goes").then((d) => d && f.setWhere(d))}
            />
          ) : undefined
        }
      />
    </section>
  );
}
