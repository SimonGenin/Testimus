import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { useRunningJobs } from "../../components/shell/Activity.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSettings } from "../settings/machine.ts";
import type { PackRow } from "../settings/models/data.ts";
import { StepCard } from "./StepCard.tsx";

const styles = stylex.create({
  item: { display: "contents" },
  rows: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gridTemplateColumns: "max-content max-content minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s4,
  },
  said: { color: color.textMuted, minWidth: 0 },
  next: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: { margin: 0, color: color.text },
});

type Row = { what: string; state: "ready" | "later" | "unused" | "running"; said: string; fix?: ReactNode };

const BADGE = {
  ready: { label: "Ready", tone: "success", icon: "check-circle" },
  later: { label: "Later", tone: "neutral", icon: undefined },
  unused: { label: "Not used", tone: "neutral", icon: undefined },
  running: { label: "Running", tone: "info", icon: undefined },
} as const;

// ponytail: the end of the first launch — what is set up, what was left for later (never in red: a choice), what still
// runs in the background, then the first document; nothing here asks anything new (the reads are the ones the steps made)
export function ReadyStep() {
  const app = useApp();
  const settings = useSettings();
  const { status: claude } = useClaudeStatus();
  const signIn = useRead("claude.status", { signIn: true }, { enabled: false }).data;
  const access = useRead("system.credentials", { check: true }, { enabled: false }).data;
  const creds = useRead("system.credentials", {}).data;
  const packs = useRead("models.packs", {}, { enabled: !!app.info }).data as PackRow[] | undefined;
  const running = useRunningJobs();
  const skip = settings.data?.atlassian ?? {};
  const ok = (id: string) => access?.checks.some((c) => c.id === id && c.state === "ok");
  const p = app.info?.project;
  const access_ = () => app.navigate("settings", "access");

  const jiraReady = ok("jira") || (!access && !!creds?.status.jira.complete);
  const rows: Row[] = [
    {
      what: "Claude",
      state: claude?.installed && (signIn?.signedIn ?? claude.signedIn) !== false ? "ready" : "later",
      said: !claude?.installed
        ? "Not installed: writing and checking wait for it"
        : signIn?.signedIn === false
          ? "Signed out: writing and checking wait for it"
          : signIn?.signedIn
            ? "Signed in with your subscription"
            : claude.version
              ? `Claude Code ${claude.version}`
              : "Installed",
      fix:
        claude?.installed && signIn?.signedIn !== false ? undefined : (
          <Button size="sm" label="Set it up" onClick={() => app.navigate("setup", "claude")} />
        ),
    },
    {
      what: "Jira",
      state: skip.skipJira ? "unused" : jiraReady ? "ready" : "later",
      said: skip.skipJira
        ? "Left out: tests stay on this PC"
        : !jiraReady
          ? "Not connected yet"
          : p?.jiraProject
            ? `${p.jiraProject} · its tests in Tests › Jira`
            : "Connected, no Jira project for this one",
      fix: skip.skipJira || !jiraReady ? <Button size="sm" label="Connect" onClick={access_} /> : undefined,
    },
    {
      what: "Xray",
      state:
        skip.skipJira || skip.skipXray
          ? "unused"
          : ok("xray") || (!access && creds?.status.xray.complete)
            ? "ready"
            : "later",
      said: skip.skipJira || skip.skipXray ? "No key yet: tests are read, not pushed" : "Steps are pushed to Xray",
      fix: skip.skipJira || skip.skipXray ? <Button size="sm" label="Add the key" onClick={access_} /> : undefined,
    },
  ];
  if (p) {
    const active = packs?.find((x) => x.active);
    rows.push({
      what: "Search",
      state: running.length ? "running" : "ready",
      said: running.length
        ? "Being set up; search works meanwhile"
        : active
          ? `${active.label}, on this PC`
          : "No pack in use: see Settings › Search",
      fix: running[0] ? (
        <Button size="sm" label="Show the job" onClick={() => app.openJob(running[0].id)} />
      ) : undefined,
    });
  }

  return (
    <StepCard
      id="ready-h"
      title={p ? `${p.name || p.jiraProject || "The project"} is ready` : "Testimus is ready"}
      lead="What is set up, and what was left for later. All of it lives in Settings."
      actions={<Button size="lg" label="Open the app" onClick={() => app.navigate(p ? "documents" : "tests")} />}
    >
      <Card sunken>
        <ul aria-label="Setup summary" {...stylex.props(styles.rows)}>
          {rows.map((r) => (
            <li key={r.what} {...stylex.props(styles.item)}>
              <Badge {...BADGE[r.state]} busy={r.state === "running"} />
              <span {...stylex.props(type.compact, type.strong)}>{r.what}</span>
              <span {...stylex.props(type.compact, styles.said)}>{r.said}</span>
              <span>{r.fix}</span>
            </li>
          ))}
        </ul>
      </Card>
      {p && (
        <section aria-labelledby="next-h" {...stylex.props(styles.next)}>
          <h2 id="next-h" {...stylex.props(type.titleSm, styles.title)}>
            Next: your first specification
          </h2>
          <Card>
            <EmptyState
              icon="documents"
              title="Add a .docx or a .pdf"
              text="It is converted and indexed on this PC; then Generate writes tests from it."
              actions={
                <Button variant="primary" icon="plus" label="Add documents" onClick={() => app.navigate("documents")} />
              }
            />
          </Card>
        </section>
      )}
    </StepCard>
  );
}
