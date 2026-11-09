import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, reveal } from "../../lib/desktop.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useInfo, useProjectField, useSetProject } from "./project.ts";
import { Column, Columns, Grid, Section, Stack } from "./Section.tsx";

const styles = stylex.create({
  folder: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  icon: { display: "inline-flex", color: color.textMuted },
});

const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

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
    <Section
      id="project"
      title="Project"
      intro="This project's identity in Jira and its folder. What Claude is given is under Context."
    >
      <Columns>
        <Column>
          <Card title="Project">
            {!p ? (
              <>
                <Skeleton lines={4} />
                <Loading read="project.info" />
              </>
            ) : (
              <Stack>
                <Grid>
                  <Text label="Name" value={p.name ?? ""} {...name} />
                  <Text
                    id="settings-project-jira"
                    label="Jira project key"
                    value={p.jiraProject ?? ""}
                    placeholder="e.g. LFRPS12"
                    hint="Upper-cased as you save."
                    {...jira}
                  />
                  <Select
                    id="set-language"
                    label="Language of the tests"
                    showLabel
                    hint="Generated tests are written in it."
                    block
                    value={p.language}
                    options={languages}
                    onChange={(language) => void setProject({ language }, "the language")}
                  />
                  <Text
                    label="Review label prefix"
                    value={p.labelPrefix ?? "testimus-"}
                    hint={`Pushed tests carry their review state as a label: ${shownPrefix}validated, ${shownPrefix}to-fix…`}
                    {...prefix}
                  />
                </Grid>
                <Field label="Project folder" hint="A project is a folder: share it by sharing the folder.">
                  <div {...stylex.props(styles.folder)}>
                    <span {...stylex.props(styles.icon)}>
                      <Icon name="folder" />
                    </span>
                    <span {...stylex.props(type.code, styles.path)} title={dir}>
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
                </Field>
              </Stack>
            )}
          </Card>
        </Column>
      </Columns>
    </Section>
  );
}
