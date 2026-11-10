import * as stylex from "@stylexjs/stylex";
import type { Ref } from "react";
import type { CheckFile, ColumnLayout, Source, SyncState, Test } from "../../../core/types.ts";
import { Badge, ReviewBadge, SYNC } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { type ClaudeBefore, diffRun } from "../../lib/diff.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { border, color, container, size, space } from "../../styles/tokens.stylex.ts";
import { GoneStep } from "../tests/WasView.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { type BannersProps, type Marks, ReviewBanners, when } from "./ReviewBanners.tsx";
import { ReviewStep } from "./ReviewStep.tsx";

export type { Marks } from "./ReviewBanners.tsx";

const SYNC_WORD: Record<SyncState, (typeof SYNC)[keyof typeof SYNC]> = {
  local: SYNC.local,
  modified: SYNC.modified,
  synced: SYNC["in-sync"],
  "remote-changed": SYNC["changed-in-jira"],
};

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s2,
    minWidth: 0,
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: { default: space.s6, [container.paneCompact]: space.s5 },
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    backgroundColor: color.surface,
  },
  key: { flex: "none", whiteSpace: "nowrap" },
  local: { color: color.textMuted },
  folder: {
    flexGrow: 0,
    flexShrink: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    color: color.textMuted,
  },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fixed: { flex: "none", display: "inline-flex", alignItems: "center", gap: space.s4 },
  actions: { marginInlineStart: "auto" },
  body: { flex: 1, minHeight: 0, overflowY: "auto" },
  col: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `calc(${size.reading} + ${space.s11} * 2)`,
    marginInline: "auto",
    paddingTop: space.s6,
    paddingInline: { default: space.s7, [container.paneCompact]: space.s5 },
    paddingBottom: space.s10,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  titles: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: { margin: 0 },
  sub: { margin: 0, color: color.textMuted },
  none: { margin: 0, color: color.textMuted },
});

export type ReviewTestProps = Omit<BannersProps, "checked" | "claudeReady" | "test" | "sync"> & {
  test: Test;
  sync: SyncState;
  edited?: boolean;
  check: CheckFile | null;
  stale: boolean;
  xray: ColumnLayout;
  folded: Set<number>;
  activeStep: number;
  /** the mark of the element that opened the source panel (sources.ts chipMark, findingMark) */
  selected: string;
  /** the step of the open source (null: a whole-test finding's) */
  selectedStep?: number | null;
  marks: Marks | null;
  /** the test before the Claude run that changed it, while that change stands */
  claudeRun?: ClaudeBefore | null;
  claudeRunning: boolean;
  claudeReady?: boolean;
  url: (file: string) => string;
  onFold: (i: number, folded: boolean) => void;
  onFoldAll: (folded: boolean) => void;
  /** a chip of a step, or of the finding number `finding` */
  onSelect: (s: Source, step: number | null, finding?: number) => void;
  onOpenImage: (file: string, step: number, column?: string) => void;
  onEdit: () => void;
  bodyRef?: Ref<HTMLDivElement>;
};

function subline(test: Test, check: CheckFile | null) {
  const parts = [plural(test.steps.length, "step"), check ? `checked ${when(check.at)}` : "not checked yet"];
  if (test.review === "to-fix" && test.reviewedBy) parts.push(`marked by ${test.reviewedBy}`);
  if (test.review === "to-fix" && test.reviewedAt) parts.push(when(test.reviewedAt));
  return parts.join(" · ");
}

// ponytail: the test under review, read-only — its head, what is true of it now, the whole-test findings, then the steps
export function ReviewTest(p: ReviewTestProps) {
  const { test, check, stale } = p;
  const findings = check?.findings ?? [];
  const indexed = findings.map((f, i) => ({ f, i }));
  const whole = indexed.filter(({ f }) => !f.step || f.step > test.steps.length);
  const allFolded = test.steps.length > 0 && test.steps.every((_, i) => p.folded.has(i));
  const sync = SYNC_WORD[p.sync] ?? SYNC.local;
  // ponytail: as in the editor — each step the last standing Claude run changed can be read as it was before it
  const run = p.claudeRun ?? null;
  const cdiff = run ? diffRun(test.steps, run.test.steps) : null;
  const gone = (at: number) =>
    (cdiff?.gone ?? [])
      .filter((g) => g.at === at)
      .map((g, k) => (
        <GoneStep
          key={`gone:${at}:${k}`}
          from="claude"
          step={g.step}
          xray={p.xray}
          layout="stacked"
          url={p.url}
          onOpenImage={() => {}}
        />
      ));
  return (
    <>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(type.code, styles.key, !test.key && styles.local)}>{test.key ?? "Not in Jira yet"}</span>
        <span {...stylex.props(type.small, styles.folder)} title={test.folder || "/"}>
          <Icon name="folder" size="sm" />
          <span {...stylex.props(styles.path)}>{test.folder || "/"}</span>
        </span>
        <span {...stylex.props(styles.fixed)}>
          <ReviewBadge state={test.review} />
          {test.generatedBy && (
            <Badge
              tone="claude"
              icon="claude"
              label={p.edited ? "Generated · edited" : "Generated"}
              tooltip={p.edited ? "Generated by Claude, then changed by hand" : "Generated by Claude, untouched since"}
            />
          )}
          <Badge {...sync} />
        </span>
        <span {...stylex.props(styles.fixed, styles.actions)}>
          <Button
            size="sm"
            variant="quiet"
            icon="layers"
            label={allFolded ? "Unfold all" : "Fold all"}
            onClick={() => p.onFoldAll(!allFolded)}
          />
          <Button size="sm" icon="text" label="Edit" onClick={p.onEdit} />
        </span>
      </div>
      <div ref={p.bodyRef} {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.col)}>
          <div {...stylex.props(styles.titles)}>
            <h2 {...stylex.props(type.titleLg, styles.title)}>{testLabel(test)}</h2>
            <p {...stylex.props(type.compact, styles.sub)}>{subline(test, check)}</p>
          </div>
          <ReviewBanners {...p} checked={!!check} claudeReady={p.claudeReady ?? true} />
          {whole.map(({ f, i }) => (
            <FindingCard
              key={`${f.kind}-${i}`}
              finding={f}
              stale={stale}
              where="Whole test"
              index={i}
              selected={p.selected}
              onSelect={(s) => p.onSelect(s, null, i)}
            />
          ))}
          {gone(-1)}
          {test.steps.flatMap((s, i) => {
            const n = i + 1;
            const own = indexed.filter(({ f }) => f.step === n);
            const cm = cdiff?.marks[i];
            const theirs = !!run?.untouched && (cm === "new" || cm === "modified");
            return [
              <ReviewStep
                key={s.id ?? i}
                n={n}
                step={s}
                xray={p.xray}
                findings={own.map(({ f }) => f)}
                verdict={check?.verdicts?.find((v) => v.step === n)}
                at={own.map(({ i: at }) => at)}
                stale={stale}
                folded={p.folded.has(i) && p.activeStep !== i}
                active={p.activeStep === i}
                holdsSelection={!!p.selected && p.selectedStep === n}
                claude={!!p.marks?.steps.has(n) || theirs}
                added={!!p.marks?.added.has(n) || (theirs && cm === "new")}
                claudeBefore={cm === "modified" ? cdiff?.was[i] : undefined}
                selected={p.selected}
                url={p.url}
                onFold={(f) => p.onFold(i, f)}
                onSelect={p.onSelect}
                onOpenImage={p.onOpenImage}
              />,
              ...gone(i),
            ];
          })}
          {!test.steps.length && <p {...stylex.props(styles.none)}>This test has no steps yet.</p>}
        </div>
      </div>
    </>
  );
}
