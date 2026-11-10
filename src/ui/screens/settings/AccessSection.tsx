import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { CredsStatus, DoctorCheck } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian } from "./ConnectAtlassian.tsx";
import { Fact, Group, Hint, Row, Section } from "./Section.tsx";

const styles = stylex.create({
  path: { color: color.textMuted, overflowWrap: "anywhere" },
  badges: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
  kept: { display: "flex", alignItems: "center", gap: space.s2 },
  set: { boxSizing: "border-box", minWidth: 0, margin: 0, padding: 0, borderWidth: 0 },
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

type Cred = { id: "jira" | "xray"; name: string; does: string; file: FileState };

function Verdict({ id, file, checks }: { id: Cred["id"]; file: FileState; checks: DoctorCheck[] }) {
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

const connected = (r: Cred, checks: DoctorCheck[]) =>
  fileState(r.file) === "found" && checks.find((x) => x.id === r.id)?.state === "ok";

// ponytail: the two files Xray Editor and Testimus both read (~/.atlassian), one row each, then the guided form that
// writes them — folded behind « Change the connection… » while both answer, open otherwise
export function AccessSection() {
  const creds = useRead("system.credentials", {});
  const doctor = useRead("system.doctor", {});
  const [changing, setChanging] = useState(false);
  const st = creds.data?.status;
  const checks = doctor.data?.checks ?? [];
  const rows: Cred[] = st
    ? [
        { id: "jira", name: "Jira", does: "Reads issues, writes tests and labels.", file: st.jira },
        { id: "xray", name: "Xray", does: "Reads and writes the steps of a test.", file: st.xray },
      ]
    : [];
  const fine = rows.length > 0 && rows.every((r) => connected(r, checks));
  return (
    <Section
      id="access"
      title="Jira and Xray"
      intro="Testimus reads and writes your tests with your own Jira and Xray accounts, for every project. Nothing is sent anywhere else."
    >
      {st && (
        <Group
          title="Connection"
          actions={
            <Button size="sm" label="Test again" loading={doctor.isFetching} onClick={() => void doctor.refetch()} />
          }
          footer={
            <span {...stylex.props(styles.kept)}>
              <Icon name="lock" size="sm" />
              <Hint>Kept in your .atlassian folder, read by your other Atlassian tools too.</Hint>
            </span>
          }
        >
          {rows.map((r) => (
            <Row key={r.id}>
              <fieldset aria-label={r.name} {...stylex.props(styles.set)}>
                <Fact label={r.name} hint={r.does}>
                  <Verdict id={r.id} file={r.file} checks={checks} />
                  <span title={r.file.file} {...stylex.props(type.code, styles.path)}>
                    {r.file.file}
                  </span>
                </Fact>
              </fieldset>
            </Row>
          ))}
        </Group>
      )}
      {fine && !changing ? (
        <Group title="Change the connection" note="The site, the email, the token or the Xray key.">
          <Row>
            <div>
              <Button size="sm" label="Change the connection…" onClick={() => setChanging(true)} />
            </div>
          </Row>
        </Group>
      ) : (
        <Group
          title="Connect to Jira and Xray"
          note="Three steps, about five minutes. Nothing is saved until the connection is tested."
          actions={fine && <Button size="sm" variant="quiet" label="Cancel" onClick={() => setChanging(false)} />}
        >
          <Row>
            <ConnectAtlassian />
          </Row>
        </Group>
      )}
    </Section>
  );
}
