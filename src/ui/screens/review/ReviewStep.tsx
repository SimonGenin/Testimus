import * as stylex from "@stylexjs/stylex";
import type { ColumnLayout, Finding, Source, Step } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { fieldViews, itemLinks, stepSources } from "../../lib/fields.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "../tests/FieldBlocks.tsx";
import { FieldRow } from "../tests/step/StepFields.tsx";
import { StepFrame, StepSourcesRow } from "../tests/step/StepFrame.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { Links, Summary } from "./StepSources.tsx";
import { firstLine } from "./sources.ts";

export { FindingSources } from "./FindingCard.tsx";
export { findingSummary, refKey } from "./sources.ts";

const noop = () => {};

const styles = stylex.create({
  grow: { flex: 1 },
  fields: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: 0,
    paddingRight: space.s5,
    paddingBottom: space.s3,
    paddingLeft: space.s4,
  },
  value: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  quiet: { paddingBlock: space.s2, color: color.textSubtle },
  nosource: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    paddingTop: space.s1,
    color: color.textSubtle,
  },
  findings: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: 0,
    paddingRight: space.s5,
    paddingBottom: space.s4,
    paddingLeft: space.s4,
  },
});

export type ReviewStepProps = {
  n: number;
  step: Step;
  xray: ColumnLayout;
  findings: Finding[];
  stale: boolean;
  folded: boolean;
  active: boolean;
  /** the open source belongs to this step: its chip or finding carries the mark, not the card */
  holdsSelection?: boolean;
  /** Claude's last run changed this step (added: it wrote it) */
  claude?: boolean;
  added?: boolean;
  /** the mark of the element that opened the source panel (sources.ts chipMark, findingMark) */
  selected: string;
  /** each finding's place in the check's findings (default: their order here) */
  at?: number[];
  url: (file: string) => string;
  onFold: (folded: boolean) => void;
  /** a chip of the step, or of its finding number `finding` */
  onSelect: (s: Source, step: number, finding?: number) => void;
  /** a picture of the step, opened in the Lightbox with the step's other pictures */
  onOpenImage: (file: string, step: number, column?: string) => void;
};

// ponytail: one step as the reviewer reads it — the step card of Tests (StepFrame), its columns read-only, its sources,
// and the findings the check put on it
export function ReviewStep(p: ReviewStepProps) {
  const { n, step, xray, findings, stale, selected } = p;
  const views = fieldViews(xray, step);
  const loose = stepSources(
    xray,
    step,
    views.map((v) => v.name),
  );
  const pick = (s: Source) => p.onSelect(s, n);
  const frame = {
    n,
    marks: { claude: p.claude, added: p.added },
    focused: p.active && !p.holdsSelection,
    current: p.active,
  };

  if (p.folded)
    return (
      <StepFrame
        {...frame}
        line={firstLine(step.fields[views[0]?.name ?? "Action"] ?? "")}
        head={
          <>
            <Summary findings={findings} stale={stale} />
            <Button
              size="sm"
              variant="quiet"
              iconOnly
              icon="chevron-down"
              label={`Expand step ${n}`}
              onClick={() => p.onFold(false)}
            />
          </>
        }
      />
    );

  return (
    <StepFrame
      {...frame}
      head={
        <>
          <span {...stylex.props(styles.grow)} />
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-up"
            label={`Fold step ${n}`}
            onClick={() => p.onFold(true)}
          />
        </>
      }
    >
      <div {...stylex.props(styles.fields)}>
        {views.map((v) => {
          const value = step.fields[v.name] ?? "";
          if (!value.trim() && !v.collapsed) return null;
          const links = itemLinks(xray, step, v.name);
          return (
            <FieldRow key={v.name} name={v.name} split={false}>
              {!value.trim() ? (
                <span {...stylex.props(type.small, styles.quiet)}>Folded · empty</span>
              ) : (
                <div {...stylex.props(styles.value)}>
                  <FieldBlocks
                    idBase={`r${n}-${v.name.replace(/\W+/g, "")}`}
                    name={v.name}
                    label={v.name}
                    text={value}
                    images={step.images}
                    url={p.url}
                    stepNumber={n}
                    readOnly
                    onText={noop}
                    onAddFiles={noop}
                    onFieldText={noop}
                    onDropBlock={noop}
                    onRemove={noop}
                    onOpen={(file) => p.onOpenImage(file, n, v.name)}
                  />
                  {links.length > 0 && <Links links={links} step={n} selected={selected} onOpen={pick} />}
                </div>
              )}
            </FieldRow>
          );
        })}
      </div>
      <StepSourcesRow>
        {loose.length > 0 ? (
          <Links links={[{ item: "", sources: loose }]} step={n} selected={selected} onOpen={pick} />
        ) : (
          <span {...stylex.props(type.small, styles.nosource)}>
            <Icon name="quote" size="sm" />
            No source
          </span>
        )}
      </StepSourcesRow>
      {findings.length > 0 && (
        <div {...stylex.props(styles.findings)}>
          {findings.map((f, i) => (
            <FindingCard
              key={`${f.kind}-${i}`}
              finding={f}
              stale={stale}
              where={`Step ${n}`}
              index={p.at?.[i] ?? i}
              selected={selected}
              onSelect={(src) => p.onSelect(src, n, p.at?.[i] ?? i)}
            />
          ))}
        </div>
      )}
    </StepFrame>
  );
}
