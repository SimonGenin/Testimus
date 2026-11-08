import * as stylex from "@stylexjs/stylex";
import type { CheckFile, LocalTestRef, Test } from "../../../core/types.ts";
import { Badge, ReviewBadge, type ReviewState } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { GenCheck } from "./GenResult.tsx";

export type Landed = { id: string; test?: Test; ref?: LocalTestRef; check?: CheckFile | null };

const styles = stylex.create({
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  meta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.textSubtle },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

const STALE = "Out of date: the test changed after this check";

function Findings({ refItem, check, checking }: { refItem?: LocalTestRef; check?: GenCheck; checking: boolean }) {
  if (check) {
    if (check.errors) return <Badge tone="danger" icon="x-circle" label={plural(check.errors, "error")} />;
    if (check.warnings) return <Badge tone="warning" icon="alert-triangle" label={plural(check.warnings, "warning")} />;
    return <Badge tone="success" icon="check" label="No findings" />;
  }
  const f = refItem?.findings;
  if (!f)
    return checking ? <Badge tone="info" busy label="Checking…" /> : <Badge tone="neutral" label="Not checked yet" />;
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
  writing: boolean;
  checking: boolean;
  onOpen: () => void;
};

// ponytail: Generate shows what was written — title, state, findings — and Review is where a test is read, once
// the generation has ended: until then the test is nowhere else
export function GenCard({ item, check, writing, checking, onOpen }: GenCardProps) {
  if (!item.test)
    return (
      <div role="status" aria-busy="true" aria-label={writing ? "Claude is writing a test" : "Loading a test"}>
        <Card dashed>
          <span {...stylex.props(type.compact)}>{writing ? "Writing…" : "Loading…"}</span>
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
        <Findings refItem={item.ref} check={check} checking={checking} />
      </span>
    </Card>
  );
}

// ponytail: the test Claude is still writing is not on disk yet — it is read once tests.list sees it and the next one began
export function LandedCard({
  id,
  refs,
  writing,
  ...rest
}: Omit<GenCardProps, "item" | "writing"> & { id: string; refs: LocalTestRef[] | undefined; writing: boolean }) {
  const ref = refs?.find((r) => r.id === id);
  const shown = useRead("tests.show", { id }, { enabled: !!ref && !writing });
  const data = shown.data as { test?: Test; check?: CheckFile | null } | undefined;
  return (
    <GenCard
      item={{ id, test: writing ? undefined : data?.test, ref, check: data?.check }}
      writing={writing}
      {...rest}
    />
  );
}
