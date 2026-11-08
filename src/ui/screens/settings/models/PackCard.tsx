import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { FIT, IN_USE, INSTALLED, NOT_IN_USE, type PackRow, PROCESSOR_ONLY, SUGGESTED, size } from "./data.ts";

const styles = stylex.create({
  card: { display: "flex", flexDirection: "column", minWidth: 0 },
  off: { opacity: 0.7 },
  head: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  muted: { color: color.textMuted },
  badges: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  notes: { display: "flex", flexDirection: "column", gap: space.s1, margin: 0, padding: 0, listStyle: "none" },
  facts: { paddingTop: space.s3 },
});

const DEVICE = { gpu: "GPU", cpu: "CPU" } as const;

// One pack as the core says it is on this PC — its models and where they run, installed or not, in use or not, and the
// core's notes, one true sentence each; the page decides nothing. Settings › Models gives it its actions in the foot
// and its speed and quality; the first launch makes it a radio among the packs, and says nothing about fitting before
// the machine is analysed
export function PackCard({
  pack: p,
  pick,
  suggested = false,
  judged = true,
  facts = false,
  footer,
}: {
  pack: PackRow;
  pick?: { checked: boolean; onSelect: (id: string) => void };
  suggested?: boolean;
  judged?: boolean;
  facts?: boolean;
  footer?: ReactNode;
}) {
  const models = p.models.map((m) => m.label).join(" + ");
  const warn = judged && p.fit && p.fit.verdict !== "fits" ? FIT[p.fit.verdict] : null;
  const notes = judged
    ? p.notes
    : p.available
      ? [p.downloadMB ? `${size(p.downloadMB)} to download` : "Nothing to download"]
      : p.notes;
  return (
    <article aria-label={`${p.label} pack`} {...stylex.props(styles.card, !p.available && !pick && styles.off)}>
      <Card
        fill={!pick}
        density={pick ? "compact" : "default"}
        selected={!pick && p.active}
        radio={
          pick
            ? { name: "pack", value: p.id, checked: pick.checked, onSelect: pick.onSelect, disabled: !p.available }
            : undefined
        }
        title={
          <span {...stylex.props(styles.head)}>
            <span {...stylex.props(type.title)}>{p.label}</span>{" "}
            {suggested && <Badge {...SUGGESTED} outline size="sm" />}
          </span>
        }
        actions={p.active ? <Badge {...IN_USE} /> : undefined}
        footer={footer}
      >
        <div {...stylex.props(styles.body)}>
          <span {...stylex.props(type.compact, styles.muted)}>{p.intent}</span>
          {models && (
            <span {...stylex.props(type.small)}>
              {models}
              {p.device && ` · ${DEVICE[p.device]}`}
            </span>
          )}
          {(p.available || warn) && (
            <span {...stylex.props(styles.badges)}>
              {p.available && <Badge {...INSTALLED[p.installed]} size="sm" />}
              {p.available && !p.active && p.installed === "all" && <Badge {...NOT_IN_USE} size="sm" />}
              {judged && p.processorOnly && <Badge {...PROCESSOR_ONLY} size="sm" />}
              {warn && p.fit && <Badge {...warn} size="sm" tooltip={p.fit.message} />}
            </span>
          )}
          {notes.length > 0 && (
            <ul aria-label="On this PC" {...stylex.props(type.small, styles.muted, styles.notes)}>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {facts && (
            <div {...stylex.props(styles.facts)}>
              <Facts
                size="sm"
                items={[
                  { label: "Speed", value: p.speed ?? "Not measured on this PC yet" },
                  { label: "Quality", value: p.quality },
                  !!p.projectQuality && { label: "On this project", value: p.projectQuality },
                ]}
              />
            </div>
          )}
        </div>
      </Card>
    </article>
  );
}
