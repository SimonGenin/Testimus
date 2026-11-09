import * as stylex from "@stylexjs/stylex";
import type { CheckFile, LocalTestRef, Test } from "../../../core/types.ts";
import { Badge, ReviewBadge, type ReviewState } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import type { Action } from "../../lib/actions.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { GenFixes } from "./GenFixes.tsx";
import type { GenCheck } from "./GenResult.tsx";

export type Landed = { id: string; test?: Test; ref?: LocalTestRef; check?: CheckFile | null };

const styles = stylex.create({
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  meta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.textSubtle },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

const STALE = "Out of date: the test changed after this check";

function Findings({ refItem, check }: { refItem?: LocalTestRef; check?: GenCheck }) {
  if (check) {
    if (check.errors) return <Badge tone="danger" icon="x-circle" label={plural(check.errors, "error")} />;
    if (check.warnings) return <Badge tone="warning" icon="alert-triangle" label={plural(check.warnings, "warning")} />;
    return <Badge tone="success" icon="check" label="No findings" />;
  }
  const f = refItem?.findings;
  if (!f) return <Badge tone="neutral" label="Not checked yet" />;
  const stale = f.stale ? STALE : undefined;
  if (f.errors)
    return (
      <Badge tone={stale ? "neutral" : "danger"} icon="x-circle" label={plural(f.errors, "error")} tooltip={stale} />
    );
  if (f.warnings)
    return (
      <Badge
        tone={stale ? "neutral" : "warning"}
        icon="alert-triangle"
        label={plural(f.warnings, "warning")}
        tooltip={stale}
      />
    );
  return <Badge tone="success" icon="check" label="No findings" />;
}

export type GenCardProps = {
  item: Landed;
  check?: GenCheck;
  onOpen: () => void;
  /** the fixes Claude proposes on this test, from the generation's actions */
  fixes?: { list: Action[]; onFix: (a: Action) => void; onDismiss: (a: Action) => void };
};

// ponytail: once the generation has ended, Generate shows what was written — title, state, findings, the fixes Claude
// proposes on it — and Review is where a test is read; while it runs, WritingCard shows each test read only
export function GenCard({ item, check, onOpen, fixes }: GenCardProps) {
  if (!item.test)
    return (
      <div role="status" aria-busy="true" aria-label="Loading a test">
        <Card dashed>
          <span {...stylex.props(type.compact)}>Loading…</span>
          <Skeleton kind="title" width="70%" />
          <Skeleton lines={2} />
        </Card>
      </div>
    );
  const test = item.test;
  const title = testLabel(test);
  const review = (check?.review ?? item.ref?.review ?? test.review) as ReviewState;
  return (
    <Card
      title={
        <span {...stylex.props(styles.titles)}>
          <span>{title}</span>
          <span {...stylex.props(type.small, type.regular, styles.meta)}>
            {test.key ? <span {...stylex.props(type.code)}>{test.key}</span> : <Badge label="Local" size="sm" />}·{" "}
            {plural(test.steps.length, "step")}
            {test.folder ? ` · ${test.folder}` : ""}
          </span>
        </span>
      }
      actions={
        item.ref?.generating ? undefined : (
          <Button size="sm" variant="quiet" iconAfter="arrow-right" label="Review" onClick={onOpen} />
        )
      }
    >
      <span {...stylex.props(styles.badges)}>
        <ReviewBadge state={review} size="sm" />
        <Badge tone="claude" icon="claude" size="sm" label="Generated" />
        <Findings refItem={item.ref} check={check} />
      </span>
      {fixes && <GenFixes fixes={fixes.list} onFix={fixes.onFix} onDismiss={fixes.onDismiss} />}
    </Card>
  );
}

// ponytail: a test of the generation, read once tests.list knows it
export function LandedCard({
  id,
  refs,
  ...rest
}: Omit<GenCardProps, "item"> & { id: string; refs: LocalTestRef[] | undefined }) {
  const ref = refs?.find((r) => r.id === id);
  const shown = useRead("tests.show", { id }, { enabled: !!ref });
  const data = shown.data as { test?: Test; check?: CheckFile | null } | undefined;
  return <GenCard item={{ id, test: data?.test, ref, check: data?.check }} {...rest} />;
}
