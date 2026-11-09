import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Badge, type BadgeTone } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { useStartUpdate, useUpdates } from "../../lib/updates.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Section } from "./Section.tsx";

type Entry = CommandOutput<"system.changelog">["entries"][number];

const styles = stylex.create({
  title: { display: "inline-flex", alignItems: "baseline", gap: space.s3, flexWrap: "wrap" },
  date: { color: color.textMuted },
  list: { margin: 0, paddingInlineStart: space.s5, display: "flex", flexDirection: "column", gap: space.s2 },
  item: { overflowWrap: "anywhere" },
  empty: { margin: 0, color: color.textMuted },
});

export type Mark = { label: string; tone: BadgeTone } | null;

// ponytail: newer = in the update folder, not installed; Unreleased = committed, not published (a development copy)
export function markOf(version: string, current: string, pending: string, newer: Set<string>): Mark {
  if (version === "Unreleased") return { label: "Not published yet", tone: "neutral" };
  if (version === current) return { label: "Running", tone: "success" };
  if (version === pending) return { label: "Installed — restart", tone: "success" };
  if (newer.has(version)) return { label: "Not installed", tone: "info" };
  return null;
}

function EntryCard({ entry, mark, action }: { entry: Entry; mark: Mark; action?: ReactNode }) {
  return (
    <Card
      selected={mark?.label === "Running"}
      dashed={entry.version === "Unreleased"}
      actions={action}
      title={
        <span {...stylex.props(styles.title)}>
          <span>{entry.version}</span>
          {entry.date && <span {...stylex.props(type.small, styles.date)}>{entry.date}</span>}
          {mark && <Badge label={mark.label} tone={mark.tone} />}
        </span>
      }
    >
      {entry.items.length ? (
        <ul {...stylex.props(type.compact, styles.list)}>
          {entry.items.map((item) => (
            <li key={item} {...stylex.props(styles.item)}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p {...stylex.props(type.compact, styles.empty)}>No notes for this version.</p>
      )}
    </Card>
  );
}

// ponytail: every version newest first — the ones waiting in the update folder on top (the newest with Update), then
// the running one and those before it, from the CHANGELOG.md this copy shipped with
export function ChangelogSection() {
  const app = useApp();
  const log = useRead("system.changelog", {});
  const updates = useUpdates();
  const start = useStartUpdate(app.navigate);
  const [starting, setStarting] = useState(false);
  const u = updates.data;
  const current = log.data?.current ?? u?.current ?? "";
  const known = new Set(log.data?.entries.map((e) => e.version));
  const newer = (u?.newer ?? []).filter((e) => !known.has(e.version));
  const waiting = new Set(newer.map((e) => e.version));
  const latest = u?.available && !u.pending ? u.latest?.version : undefined;

  return (
    <Section id="changelog" title="Changelog" intro="What changes in each version of Testimus, the newest on top.">
      {log.isPending ? (
        <Card>
          <Skeleton lines={4} />
        </Card>
      ) : log.isError ? (
        <Banner tone="warning">The changelog could not be read: {log.error.message}</Banner>
      ) : (
        [...newer, ...(log.data?.entries ?? [])].map((entry) => (
          <EntryCard
            key={entry.version}
            entry={entry}
            mark={markOf(entry.version, current, u?.pending ?? "", waiting)}
            action={
              entry.version === latest ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon="download"
                  label={`Update to ${latest}`}
                  disabled={u?.installed ? false : "This copy is not installed, so it cannot update itself"}
                  loading={starting}
                  onClick={() => {
                    setStarting(true);
                    void start(latest).finally(() => setStarting(false));
                  }}
                />
              ) : undefined
            }
          />
        ))
      )}
    </Section>
  );
}
