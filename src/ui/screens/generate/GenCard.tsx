import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { CheckFile, ColumnLayout, Finding, LocalTestRef, Source, Test } from "../../../core/types.ts";
import { Badge, ReviewBadge, type ReviewState, SeverityBadge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { border, color, fontFamily, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { FindingSources, ReviewStep } from "../review/ReviewStep.tsx";
import type { GenCheck } from "./GenResult.tsx";

export type Landed = { id: string; test?: Test; ref?: LocalTestRef; check?: CheckFile | null };

const styles = stylex.create({
  wait: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    borderStyle: "dashed",
    borderWidth: border.width,
    borderColor: color.border,
  },
  waitTitle: { fontSize: fontSize.compact, color: color.textSubtle },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textSubtle,
  },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  finding: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s3,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  findingHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    color: color.textMuted,
  },
  text: { margin: 0, fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.text },
  muted: { margin: 0, fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.textSubtle },
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

function WholeTest({ finding, stale, onSource }: { finding: Finding; stale: boolean; onSource: (s: Source) => void }) {
  return (
    <div role="note" {...stylex.props(styles.finding)}>
      <span {...stylex.props(styles.findingHead)}>
        <SeverityBadge severity={finding.severity} size="sm" />
        Whole test{stale ? " · out of date" : ""}
      </span>
      <p {...stylex.props(styles.text)}>{finding.message}</p>
      <FindingSources finding={finding} selected="" onSelect={onSource} />
    </div>
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
  onSource: (s: Source) => void;
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
  const [folded, setFolded] = useState<Set<number>>(new Set());
  if (!item.test)
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={writing ? "Claude is writing a test" : "Loading a test"}
        {...stylex.props(styles.wait)}
      >
        <span {...stylex.props(styles.waitTitle)}>{writing ? "Writing…" : "Loading…"}</span>
        <Skeleton kind="title" width="70%" />
        <Skeleton lines={2} />
      </div>
    );
  const test = item.test;
  const title = test.summary || "Untitled test";
  const findings = item.check?.findings ?? [];
  const stale = !!item.ref?.findings?.stale;
  const url = (file: string) => fileUrl(`tests/${item.id}/${file}`);
  const fold = (i: number, f: boolean) =>
    setFolded((cur) => {
      const next = new Set(cur);
      if (f) next.add(i);
      else next.delete(i);
      return next;
    });
  const review = (check?.review ?? item.ref?.review ?? test.review) as ReviewState;
  return (
    <Card
      title={title}
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
        <span {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.mono)}>{item.id}</span>· {plural(test.steps.length, "step")}
          {test.folder ? ` · ${test.folder}` : ""}
        </span>
        <span {...stylex.props(styles.badges)}>
          <ReviewBadge state={review} size="sm" />
          <Badge tone="claude" icon="claude" size="sm" label="Generated" />
          <Findings refItem={item.ref} check={check} checking={checking} />
        </span>
        {open && (
          <>
            {findings
              .filter((f) => !f.step || f.step > test.steps.length)
              .map((f, i) => (
                <WholeTest key={i} finding={f} stale={stale} onSource={onSource} />
              ))}
            {test.steps.map((s, i) => (
              <ReviewStep
                key={i}
                n={i + 1}
                step={s}
                xray={xray}
                findings={findings.filter((f) => f.step === i + 1)}
                stale={stale}
                folded={folded.has(i)}
                active={false}
                selected=""
                url={url}
                onFold={(f) => fold(i, f)}
                onSelect={(src) => onSource(src)}
                onOpenImage={(file) => window.open(url(file), "_blank")}
              />
            ))}
            {!test.steps.length && <p {...stylex.props(styles.muted)}>This test has no steps yet.</p>}
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
