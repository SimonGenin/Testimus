import * as stylex from "@stylexjs/stylex";
import type { CredsStatus } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { useRead } from "../../lib/data/query.ts";
import { border, color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian } from "./ConnectAtlassian.tsx";
import { Section } from "./Section.tsx";

const styles = stylex.create({
  rows: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    borderTopStyle: { default: "solid", ":first-child": "none" },
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  icon: { display: "inline-flex", color: color.textMuted, paddingTop: space.s1 },
  body: { display: "flex", flexDirection: "column", gap: space.s1, flex: 1, minWidth: 0 },
  name: { fontSize: fontSize.body, lineHeight: lineHeight.body },
  path: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
  },
  badges: { display: "flex", gap: space.s2, flexWrap: "wrap", justifyContent: "flex-end" },
  sub: { fontWeight: fontWeight.regular, fontSize: fontSize.small, color: color.textMuted },
});

type FileState = CredsStatus["xray"];

export function fileState(f: FileState): "found" | "missing" | "invalid" {
  if (!f.exists) return "missing";
  return f.invalid || !f.complete ? "invalid" : "found";
}

const WORD = {
  found: { label: "Found · valid", tone: "success", icon: "check-circle" },
  missing: { label: "Missing", tone: "warning", icon: "alert-triangle" },
  invalid: { label: "Invalid", tone: "danger", icon: "x-circle" },
} as const;

function FileRow({ id, name, file }: { id: "jira" | "xray"; name: string; file: FileState }) {
  const doctor = useRead("system.doctor", {});
  const s = fileState(file);
  const c = doctor.data?.checks?.find((x) => x.id === id);
  const w = WORD[s];
  return (
    <li aria-label={name} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.icon)}>
        <Icon name="file" />
      </span>
      <div {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        <span title={file.file} {...stylex.props(styles.path)}>
          {file.file}
        </span>
      </div>
      <span {...stylex.props(styles.badges)}>
        <Badge
          label={s === "invalid" && file.problem ? `Invalid — ${file.problem}` : w.label}
          tone={w.tone}
          icon={w.icon}
          tooltip={file.problem}
        />
        {s === "found" && c && c.state !== "skip" && (
          <Badge
            label={c.state === "ok" ? "Connected" : c.detail.slice(0, 60)}
            tone={c.state === "ok" ? "success" : "danger"}
            icon={c.state === "ok" ? "plug" : "alert-circle"}
            tooltip={c.state === "ok" ? undefined : c.fix}
          />
        )}
      </span>
    </li>
  );
}

// ponytail: the two shared files Xray Editor and Testimus read (~/.atlassian), then the guided form that writes them
export function AccessSection() {
  const creds = useRead("system.credentials", {});
  const st = creds.data?.status;
  return (
    <Section
      id="access"
      title="Access"
      intro="Testimus reads and writes your tests through your own Jira and Xray accounts. Nothing is sent anywhere else."
    >
      {st && (
        <Card
          title={
            <>
              Credential files <span {...stylex.props(styles.sub)}>shared with your other Atlassian tools</span>
            </>
          }
        >
          <ul aria-label="Credential files" {...stylex.props(styles.rows)}>
            <FileRow id="jira" name="Jira" file={st.jira} />
            <FileRow id="xray" name="Xray" file={st.xray} />
          </ul>
        </Card>
      )}
      <Card title="Connect to Jira and Xray">
        <ConnectAtlassian />
      </Card>
    </Section>
  );
}
