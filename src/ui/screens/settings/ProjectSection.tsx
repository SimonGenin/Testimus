import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, reveal } from "../../lib/desktop.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useInfo, useProjectField, useSetProject } from "./project.ts";
import { Fact, Group, Row, Section } from "./Section.tsx";

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
  labels: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, color: color.textSubtle },
  loading: { display: "flex", flexDirection: "column", gap: space.s3 },
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
    <Section id="project" title="Project" intro="Who this project is in Jira, and where it lives on this PC.">
      <Group title="Identity">
        {!p ? (
          <Row>
            <div {...stylex.props(styles.loading)}>
              <Skeleton lines={4} />
              <Loading read="project.info" />
            </div>
          </Row>
        ) : (
          <>
            <Row>
              <Text aside label="Name" hint="Shown in the project menu." value={p.name ?? ""} {...name} />
            </Row>
            <Row>
              <Text
                aside
                id="settings-project-jira"
                label="Jira project key"
                value={p.jiraProject ?? ""}
                placeholder="e.g. LFRPS12"
                hint="Where the tests are read from and pushed to. Upper-cased as you save."
                {...jira}
              />
            </Row>
            <Row>
              <Select
                aside
                id="set-language"
                label="Language of the tests"
                showLabel
                hint="Claude writes the generated tests in it."
                block
                value={p.language}
                options={languages}
                onChange={(language) => void setProject({ language }, "the language")}
              />
            </Row>
            <Row>
              <Text
                aside
                label="Review label prefix"
                value={p.labelPrefix ?? "testimus-"}
                hint="A pushed test carries its review state as a Jira label."
                {...prefix}
              />
              <Fact>
                <span {...stylex.props(type.small, styles.labels)}>
                  Labels in Jira:
                  <Chip label={`${shownPrefix}validated`} mono inField />
                  <Chip label={`${shownPrefix}to-fix`} mono inField />
                </span>
              </Fact>
            </Row>
          </>
        )}
      </Group>
      {p && (
        <Group title="Folder">
          <Row>
            <Fact
              label="Project folder"
              hint="Everything Testimus keeps for this project is in it: documents, tests, settings."
            >
              <div {...stylex.props(styles.folder)}>
                <span {...stylex.props(styles.icon)}>
                  <Icon name="folder" />
                </span>
                <span {...stylex.props(type.code, styles.path)} title={dir}>
                  {dir}
                </span>
              </div>
              {desktop() && (
                <div>
                  <Button size="sm" icon="folder-open" label="Show in Explorer" onClick={() => void reveal(dir)} />
                </div>
              )}
            </Fact>
          </Row>
        </Group>
      )}
    </Section>
  );
}
