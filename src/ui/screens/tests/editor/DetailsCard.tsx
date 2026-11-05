import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Test } from "../../../../core/types.ts";
import { Badge, DIFF } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Chip } from "../../../components/ui/Chip.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { cardFlush } from "../step/StepFrame.tsx";
import { WAS, type WasFrom, WasToggle } from "../step/WasToggle.tsx";

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.cardHead,
    paddingBlock: space.s3,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s3,
  },
  sq: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  sqJira: { backgroundColor: color.warningSubtle, color: color.warning },
  sqClaude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
  name: { margin: 0, color: color.text },
  line: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.textSubtle,
  },
  grow: { flex: 1 },
  body: { boxSizing: "border-box", paddingInline: space.s5, paddingBottom: space.s5 },
  was: { boxSizing: "border-box", paddingInline: space.s3, paddingBottom: space.s3 },
  wasTitle: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.warning },
  wasTitleClaude: { color: color.claudeText },
  grid: { display: "flex", flexDirection: "column", gap: space.s3 },
  field: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  label: { color: color.textMuted },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  text: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: color.text },
  none: { color: color.textSubtle },
});

/** what the Details card holds and an earlier version can differ in (the summary is the head's) */
export const DETAIL_FIELDS = ["labels", "covers", "preconditions", "description"] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
const LABEL: Record<DetailField, string> = {
  labels: "Labels",
  covers: "Covers",
  preconditions: "Preconditions",
  description: "Description",
};

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export function changedDetails(now: Test, was: Test | null | undefined): DetailField[] {
  if (!was) return [];
  return DETAIL_FIELDS.filter((f) =>
    f === "description" ? now.description.trim() !== was.description.trim() : !sameSet(now[f], was[f]),
  );
}

export function restoreDetails(now: Test, was: Test, fields: DetailField[]): Test {
  const next = { ...now };
  for (const f of fields) {
    if (f === "description") next.description = was.description;
    else next[f] = [...was[f]];
  }
  return next;
}

const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

// ponytail: what the head says of a folded Details: its labels, what it covers, the start of its description
export function detailsLine(t: Test): string {
  return [
    t.labels.length ? t.labels.join(", ") : "",
    t.covers.length ? `covers ${t.covers.join(", ")}` : "",
    t.preconditions.length ? `needs ${t.preconditions.join(", ")}` : "",
    firstLine(t.description),
  ]
    .filter(Boolean)
    .join(" · ");
}

// ponytail: the test's Details as a card of their own, made like a step: a head with its marks and its earlier versions
// (Jira's at the last sync, the test's before Claude's run — the same toggles as a step's), folded or not
export function DetailsCard({
  test,
  remote,
  before,
  open,
  readOnly,
  onOpen,
  onRestore,
  children,
}: {
  test: Test;
  /** the test as Jira had it at the last sync (null: never synced) */
  remote: Test | null;
  /** the test before the Claude run that changed it, while that change stands */
  before: Test | null;
  open: boolean;
  readOnly?: boolean;
  onOpen: (open: boolean) => void;
  onRestore: (from: WasFrom, was: Test, fields: DetailField[]) => void;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState<WasFrom | null>(null);
  const jira = changedDetails(test, remote);
  const claude = changedDetails(test, before);
  const showing = shown === "jira" && jira.length ? "jira" : shown === "claude" && claude.length ? "claude" : null;
  const toggle = (from: WasFrom) => {
    setShown(showing === from ? null : from);
    if (!open) onOpen(true);
  };
  const was = showing === "jira" ? remote : showing === "claude" ? before : null;
  const fields = showing === "jira" ? jira : claude;
  const line = detailsLine(test);
  return (
    <section aria-label="Details" data-testid="details-card">
      <Card padded={false} edge={claude.length ? "claude" : jira.length ? "warning" : undefined}>
        <div {...stylex.props(cardFlush.child)}>
          <div {...stylex.props(styles.head)}>
            <span
              aria-hidden="true"
              {...stylex.props(styles.sq, claude.length ? styles.sqClaude : jira.length ? styles.sqJira : null)}
            >
              <Icon name="info" />
            </span>
            <h2 {...stylex.props(type.compact, type.strong, styles.name)}>Details</h2>
            {claude.length > 0 && <Badge {...DIFF.claude} />}
            {jira.length > 0 && <Badge {...DIFF.modified} />}
            {claude.length > 0 && (
              <WasToggle from="claude" open={showing === "claude"} onToggle={() => toggle("claude")} />
            )}
            {jira.length > 0 && <WasToggle from="jira" open={showing === "jira"} onToggle={() => toggle("jira")} />}
            {!open ? (
              <span {...stylex.props(type.small, styles.line)}>{line || "No labels, no description yet"}</span>
            ) : (
              <span {...stylex.props(styles.grow)} />
            )}
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={open ? "chevron-up" : "chevron-down"}
              label={open ? "Fold the details" : "Show the details"}
              onClick={() => onOpen(!open)}
            />
          </div>
          {open && was && showing && (
            <div {...stylex.props(styles.was)}>
              <Card
                sunken
                density="compact"
                edge={showing === "claude" ? "claude" : "warning"}
                title={
                  <span
                    {...stylex.props(
                      type.small,
                      type.medium,
                      styles.wasTitle,
                      showing === "claude" && styles.wasTitleClaude,
                    )}
                  >
                    <Icon name="history" size="sm" />
                    {WAS[showing].title}
                  </span>
                }
                actions={
                  readOnly ? undefined : (
                    <Button
                      size="sm"
                      icon="undo"
                      label={showing === "claude" ? "Put back as before Claude" : "Keep Jira's version"}
                      onClick={() => {
                        onRestore(showing, was, fields);
                        setShown(null);
                      }}
                    />
                  )
                }
              >
                <section aria-label={`Details ${WAS[showing].aria}`} {...stylex.props(styles.grid)}>
                  {fields.map((f) => (
                    <div key={f} {...stylex.props(styles.field)}>
                      <span {...stylex.props(type.label, styles.label)}>{LABEL[f]}</span>
                      {f === "description" ? (
                        <p {...stylex.props(type.body, styles.text, !was.description.trim() && styles.none)}>
                          {was.description.trim() || "No description"}
                        </p>
                      ) : was[f].length ? (
                        <span {...stylex.props(styles.chips)}>
                          {was[f].map((v) => (
                            <Chip key={v} label={v} mono={f !== "labels"} />
                          ))}
                        </span>
                      ) : (
                        <span {...stylex.props(type.small, styles.none)}>None</span>
                      )}
                    </div>
                  ))}
                  <span {...stylex.props(type.small, styles.none)}>
                    {DETAIL_FIELDS.filter((f) => !fields.includes(f)).length
                      ? `Same as here: ${DETAIL_FIELDS.filter((f) => !fields.includes(f))
                          .map((f) => LABEL[f])
                          .join(", ")}.`
                      : ""}
                    {showing === "jira" ? " Claude contexts stay in Testimus: Jira has none." : ""}
                  </span>
                </section>
              </Card>
            </div>
          )}
          {open && <div {...stylex.props(styles.body)}>{children}</div>}
        </div>
      </Card>
    </section>
  );
}
