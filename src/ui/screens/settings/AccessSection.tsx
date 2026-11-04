import * as stylex from "@stylexjs/stylex";
import type { CredsStatus, DoctorCheck } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian } from "./ConnectAtlassian.tsx";
import { Section } from "./Section.tsx";

const styles = stylex.create({
  path: { color: color.textMuted },
  badges: { display: "flex", gap: space.s2, flexWrap: "wrap", justifyContent: "flex-end" },
  sub: { color: color.textMuted },
});

type FileState = CredsStatus["xray"];

export function fileState(f: FileState): "found" | "missing" | "invalid" {
  if (!f.exists) return "missing";
  return f.invalid || !f.complete ? "invalid" : "found";
}

const WORD = {
  found: { label: "Found · valid", tone: "success", icon: "check-circle" },
  missing: { label: "Missing", tone: "neutral", icon: "circle-dashed" },
  invalid: { label: "Invalid", tone: "danger", icon: "x-circle" },
} as const;

type Row = { id: "jira" | "xray"; name: string; file: FileState };

function Verdict({ id, file, checks }: { id: Row["id"]; file: FileState; checks: DoctorCheck[] }) {
  const s = fileState(file);
  const c = checks.find((x) => x.id === id);
  const w = WORD[s];
  return (
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
  );
}

// ponytail: the two shared files Xray Editor and Testimus read (~/.atlassian), then the guided form that writes them
export function AccessSection() {
  const creds = useRead("system.credentials", {});
  const doctor = useRead("system.doctor", {});
  const st = creds.data?.status;
  const checks = doctor.data?.checks ?? [];
  const rows: Row[] = st
    ? [
        { id: "jira", name: "Jira", file: st.jira },
        { id: "xray", name: "Xray", file: st.xray },
      ]
    : [];
  return (
    <Section
      id="access"
      title="Access"
      intro="Testimus reads and writes your tests through your own Jira and Xray accounts. Nothing is sent anywhere else."
    >
      {st && (
        <Card
          padded={false}
          title={
            <>
              Credential files{" "}
              <span {...stylex.props(type.small, type.regular, styles.sub)}>
                shared with your other Atlassian tools
              </span>
            </>
          }
        >
          <List
            label="Credential files"
            selection="none"
            divided
            items={rows}
            getKey={(r) => r.id}
            renderItem={(r) => ({
              title: r.name,
              lead: <Icon name="file" />,
              meta: (
                <span title={r.file.file} {...stylex.props(type.code, styles.path)}>
                  {r.file.file}
                </span>
              ),
              trail: <Verdict id={r.id} file={r.file} checks={checks} />,
            })}
          />
        </Card>
      )}
      <Card title="Connect to Jira and Xray">
        <ConnectAtlassian />
      </Card>
    </Section>
  );
}
