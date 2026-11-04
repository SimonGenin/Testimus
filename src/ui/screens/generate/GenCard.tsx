import * as stylex from "@stylexjs/stylex";
import type { CheckFile, ColumnLayout, Finding, LocalTestRef, Source, Step, Test } from "../../../core/types.ts";
import { Badge, ReviewBadge, type ReviewState } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import type { SourceFrom } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { fieldViews, sourceLabel } from "../../lib/fields.ts";
import { plural } from "../../lib/format.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { FindingCard } from "../review/FindingCard.tsx";
import { refKey } from "../review/sources.ts";
import type { GenCheck } from "./GenResult.tsx";

export type Landed = { id: string; test?: Test; ref?: LocalTestRef; check?: CheckFile | null };

const styles = stylex.create({
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  meta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.textSubtle },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  steps: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s3 },
  step: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  field: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  value: { color: color.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  chips: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  muted: { margin: 0, color: color.textSubtle },
  foot: { display: "flex", alignItems: "center", gap: space.s2, width: "100%" },
  grow: { flex: 1 },
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

const textOf = (s: string) => s.replace(/!\[\]\([^)]*\)/g, "").trim();

// ponytail: a landed test's steps as a preview — each column's words and the step's sources, the check's findings on
// it; Review shows the step cards
function StepPreview({
  testId,
  n,
  step,
  xray,
  findings,
  stale,
  onSource,
}: {
  testId: string;
  n: number;
  step: Step;
  xray: ColumnLayout;
  findings: { finding: Finding; index: number }[];
  stale: boolean;
  onSource: (s: Source, from?: SourceFrom) => void;
}) {
  const fields = fieldViews(xray, step)
    .map((v) => ({ name: v.name, text: textOf(step.fields[v.name] ?? "") }))
    .filter((f) => f.text);
  return (
    <li aria-label={`Step ${n}`} {...stylex.props(styles.step)}>
      {fields.map((f, i) => (
        <span key={f.name} {...stylex.props(styles.field)}>
          <span {...stylex.props(type.caption)}>{i === 0 ? `Step ${n} · ${f.name}` : f.name}</span>
          <span {...stylex.props(type.compact, styles.value)}>{f.text}</span>
        </span>
      ))}
      {!fields.length && <span {...stylex.props(type.caption)}>Step {n} · empty</span>}
      {step.images.length > 0 && (
        <span {...stylex.props(type.small, styles.muted)}>{plural(step.images.length, "image")}</span>
      )}
      {step.sources.length > 0 && (
        <span {...stylex.props(styles.chips)}>
          {step.sources.map((s) => (
            <SourceChip
              key={`${refKey(s)}|${s.quote}`}
              reference={sourceLabel(s)}
              quote={s.quote || undefined}
              figure={s.anchor.startsWith("fig:")}
              onOpen={() => onSource(s, { test: testId, step: n, sources: step.sources })}
            />
          ))}
        </span>
      )}
      {findings.map(({ finding, index }) => (
        <FindingCard
          key={index}
          finding={finding}
          stale={stale}
          where={`Step ${n}`}
          sunken={false}
          index={index}
          selected=""
          onSelect={onSource}
        />
      ))}
    </li>
  );
}

export type GenCardProps = {
  item: Landed;
  check?: GenCheck;
  writing: boolean;
  checking: boolean;
  xray: ColumnLayout;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onEdit?: () => void;
  /** a step's source opens with its step (« Source of step n », ‹ › through its sources) */
  onSource: (s: Source, from?: SourceFrom) => void;
};

export function GenCard({
  item,
  check,
  writing,
  checking,
  xray,
  open,
  onToggle,
  onOpen,
  onEdit,
  onSource,
}: GenCardProps) {
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
  const title = test.summary || "Untitled test";
  const findings = item.check?.findings ?? [];
  const stale = !!item.ref?.findings?.stale;
  const placed = findings.map((finding, index) => ({ finding, index }));
  const onStep = (n: number) => placed.filter((p) => p.finding.step === n);
  const review = (check?.review ?? item.ref?.review ?? test.review) as ReviewState;
  return (
    <Card
      title={
        <span {...stylex.props(styles.titles)}>
          <span>{title}</span>
          <span {...stylex.props(type.small, type.regular, styles.meta)}>
            <span {...stylex.props(type.code)}>{item.id}</span>· {plural(test.steps.length, "step")}
            {test.folder ? ` · ${test.folder}` : ""}
          </span>
        </span>
      }
      actions={
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={open ? "chevron-up" : "chevron-down"}
          label={title}
          expanded={open}
          onClick={onToggle}
        />
      }
      footer={
        <span {...stylex.props(styles.foot)}>
          <Button size="sm" variant="quiet" iconAfter="arrow-right" label="Open in Review" onClick={onOpen} />
          <span {...stylex.props(styles.grow)} />
          {onEdit && <Button size="sm" variant="quiet" label="Open in the editor" onClick={onEdit} />}
        </span>
      }
    >
      <div {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.badges)}>
          <ReviewBadge state={review} size="sm" />
          <Badge tone="claude" icon="claude" size="sm" label="Generated" />
          <Findings refItem={item.ref} check={check} checking={checking} />
        </span>
        {open && (
          <>
            {placed
              .filter((p) => !p.finding.step || p.finding.step > test.steps.length)
              .map((p) => (
                <FindingCard
                  key={p.index}
                  finding={p.finding}
                  stale={stale}
                  where="Whole test"
                  index={p.index}
                  selected=""
                  onSelect={onSource}
                />
              ))}
            {test.steps.length > 0 ? (
              <ol aria-label="Steps" {...stylex.props(styles.steps)}>
                {test.steps.map((s, i) => (
                  <StepPreview
                    key={s.id ?? i}
                    testId={item.id}
                    n={i + 1}
                    step={s}
                    xray={xray}
                    findings={onStep(i + 1)}
                    stale={stale}
                    onSource={onSource}
                  />
                ))}
              </ol>
            ) : (
              <p {...stylex.props(type.compact, styles.muted)}>This test has no steps yet.</p>
            )}
          </>
        )}
      </div>
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
