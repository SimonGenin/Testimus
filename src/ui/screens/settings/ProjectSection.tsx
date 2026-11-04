import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import type { Save } from "../../lib/data/autosave.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { desktop, reveal } from "../../lib/desktop.ts";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { useInfo, useProjectField, useSetProject } from "./project.ts";
import { Grid, Hint, Labelled, Section, Stack } from "./Section.tsx";

const styles = stylex.create({
  label: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
  folder: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
  },
  mono: { fontFamily: fontFamily.mono },
  icon: { display: "inline-flex", color: color.textMuted },
  file: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    color: color.textMuted,
    fontWeight: fontWeight.regular,
  },
});

const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

type Notes = CommandOutput<"project.notes">;

// ponytail: CLAUDE.md, saved by the field against the version it was read at — a change on disk meanwhile is a
// conflict the field shows; a pending text belongs to the project it was typed in (the key carries it)
function ProjectNotes() {
  const client = useQueryClient();
  const notes = useRead("project.notes", {});
  const saveKey = key("project.notes", {});
  const save: Save<string> = async (text, base) => {
    const out = await execute(
      client,
      "project.setNotes",
      { text, ...(base ? { ifMtime: Number(base) } : {}) },
      { invalidates: "none" },
      saveKey[0],
    );
    client.setQueryData<Notes>(saveKey as unknown as readonly unknown[], (old) =>
      old ? { ...old, text, mtime: out.mtime } : old,
    );
    return String(out.mtime);
  };
  const file = notes.data?.file ?? "CLAUDE.md";
  return (
    <Card
      title={
        <>
          Project notes <span {...stylex.props(styles.file)}>CLAUDE.md</span>
        </>
      }
    >
      <Stack>
        <Text
          multiline
          label="Project notes"
          value={notes.data?.text ?? ""}
          save={save}
          saveKey={saveKey}
          base={notes.data ? String(notes.data.mtime) : undefined}
          disabled={notes.isPending}
          placeholder="Conventions, vocabulary, what Claude should know about this project…"
        />
        <Hint>
          Markdown, saved to <span {...stylex.props(styles.mono)}>{file}</span> and read by Claude in every run.
        </Hint>
      </Stack>
    </Card>
  );
}

export function ProjectSection() {
  const info = useInfo();
  const setProject = useSetProject();
  const name = useProjectField("name");
  const jira = useProjectField("jiraProject", (t) => t.trim().toUpperCase());
  const prefix = useProjectField("labelPrefix");
  const p = info.data?.project;
  const dir = info.data?.dir ?? "";
  const shownPrefix = p?.labelPrefix || "testimus-";
  const languages =
    p && !LANGUAGES.some((l) => l.value === p.language)
      ? [...LANGUAGES, { value: p.language, label: p.language }]
      : LANGUAGES;
  return (
    <Section id="project" title="Project" intro="This project's identity in Jira and what Claude should know about it.">
      <Card title="Project">
        {!p ? (
          <Skeleton lines={4} />
        ) : (
          <Stack>
            <Grid>
              <Text label="Name" value={p.name ?? ""} {...name} />
              <Text label="Jira project key" value={p.jiraProject ?? ""} hint="Upper-cased as you save." {...jira} />
              <Labelled id="set-language" label="Language of the tests" hint="Generated tests are written in it.">
                <Select
                  id="set-language"
                  label="Language of the tests"
                  block
                  value={p.language}
                  options={languages}
                  onChange={(language) => void setProject({ language }, "the language")}
                />
              </Labelled>
              <Text
                label="Review label prefix"
                value={p.labelPrefix ?? "testimus-"}
                hint={`Pushed tests carry their review state as a label: ${shownPrefix}validated, ${shownPrefix}to-fix…`}
                {...prefix}
              />
            </Grid>
            <span {...stylex.props(styles.label)}>Project folder</span>
            <div {...stylex.props(styles.folder)}>
              <span {...stylex.props(styles.icon)}>
                <Icon name="folder" />
              </span>
              <span {...stylex.props(styles.path)} title={dir}>
                {dir}
              </span>
              {desktop() && (
                <Button
                  size="sm"
                  variant="quiet"
                  icon="folder-open"
                  label="Show in Explorer"
                  onClick={() => void reveal(dir)}
                />
              )}
            </div>
            <Hint>A project is a folder: share it by sharing the folder.</Hint>
          </Stack>
        )}
      </Card>
      {p && <ProjectNotes />}
    </Section>
  );
}
