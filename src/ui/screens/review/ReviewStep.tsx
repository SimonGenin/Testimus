import * as stylex from "@stylexjs/stylex";
import type { ColumnLayout, Finding, Source, Step } from "../../../core/types.ts";
import { Badge, DIFF } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { fieldViews, itemLinks, stepSources } from "../../lib/fields.ts";
import {
  border,
  color,
  container,
  focus,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "../tests/FieldBlocks.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { Links, Summary } from "./StepSources.tsx";
import { firstLine } from "./sources.ts";

export { FindingSources } from "./FindingCard.tsx";
export { findingSummary, refKey } from "./sources.ts";

const noop = () => {};

const styles = stylex.create({
  card: {
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
  },
  active: { outline: `${border.widthStrong} solid ${color.focusRing}`, outlineOffset: focus.offset },
  claude: { borderColor: color.claudeBorder },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: `calc(${size.controlMd} + ${space.s5})`,
    paddingTop: space.s3,
    paddingRight: space.s4,
    paddingBottom: space.s2,
    paddingLeft: space.s3,
  },
  folded: { paddingBottom: space.s3, cursor: "pointer" },
  num: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size.controlSm,
    height: size.controlSm,
    paddingInline: space.s2,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.text,
    fontSize: fontSize.compact,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
  },
  numClaude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
  line: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
  },
  empty: { color: color.textSubtle },
  grow: { flex: 1 },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: 0,
    paddingRight: space.s5,
    paddingBottom: space.s3,
    paddingLeft: space.s4,
  },
  field: {
    display: "grid",
    gridTemplateColumns: { default: `${size.stepLabel} minmax(0, 1fr)`, [container.paneNarrow]: "minmax(0, 1fr)" },
    gap: space.s4,
    alignItems: "start",
  },
  label: {
    paddingTop: `calc(${space.s2} + ${space.s1})`,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  value: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  quiet: { paddingBlock: space.s2, fontSize: fontSize.small, color: color.textSubtle },
  sources: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    marginTop: 0,
    marginRight: space.s5,
    marginBottom: 0,
    marginLeft: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s4,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
  },
  nosource: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    color: color.textSubtle,
  },
  findings: {
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
  /** Claude's last run changed this step (added: it wrote it) */
  claude?: boolean;
  added?: boolean;
  selected: string;
  url: (file: string) => string;
  onFold: (folded: boolean) => void;
  onSelect: (s: Source, step: number) => void;
  onOpenImage: (file: string) => void;
};

// ponytail: one step as the reviewer reads it — its columns read-only, its sources, and the findings the check put on it
export function ReviewStep(p: ReviewStepProps) {
  const { n, step, xray, findings, stale, selected } = p;
  const views = fieldViews(xray, step);
  const loose = stepSources(
    xray,
    step,
    views.map((v) => v.name),
  );
  const pick = (s: Source) => p.onSelect(s, n);
  const mark = p.claude && <Badge size="sm" {...DIFF.claude} label={p.added ? "Added by Claude" : DIFF.claude.label} />;
  const look = stylex.props(styles.card, p.active && styles.active, p.claude && styles.claude);
  const num = <span {...stylex.props(styles.num, p.claude && styles.numClaude)}>{n}</span>;

  if (p.folded) {
    const line = firstLine(step.fields[views[0]?.name ?? "Action"] ?? "");
    return (
      <article aria-label={`Step ${n}`} aria-current={p.active ? "step" : undefined} {...look}>
        <div {...stylex.props(styles.head, styles.folded)} onClick={() => p.onFold(false)}>
          {num}
          {mark}
          <span {...stylex.props(styles.line, !line && styles.empty)}>{line || "Empty step"}</span>
          <Summary findings={findings} stale={stale} />
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-down"
            label={`Expand step ${n}`}
            onClick={(e) => {
              e.stopPropagation();
              p.onFold(false);
            }}
          />
        </div>
      </article>
    );
  }

  return (
    <article aria-label={`Step ${n}`} aria-current={p.active ? "step" : undefined} {...look}>
      <div {...stylex.props(styles.head)}>
        {num}
        {mark}
        <span {...stylex.props(styles.grow)} />
        {findings.length > 0 && <Summary findings={findings} stale={stale} />}
        <Button
          size="sm"
          variant="quiet"
          iconOnly
          icon="chevron-up"
          label={`Fold step ${n}`}
          onClick={() => p.onFold(true)}
        />
      </div>
      <div {...stylex.props(styles.fields)}>
        {views.map((v) => {
          const value = step.fields[v.name] ?? "";
          if (!value.trim() && !v.collapsed) return null;
          const links = itemLinks(xray, step, v.name);
          return (
            <div key={v.name} data-field={v.name} {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.label)}>{v.name}</span>
              {!value.trim() ? (
                <span {...stylex.props(styles.quiet)}>Folded · empty</span>
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
                    onOpen={p.onOpenImage}
                  />
                  {links.length > 0 && <Links links={links} selected={selected} onOpen={pick} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div {...stylex.props(styles.sources)}>
        <span {...stylex.props(styles.label)}>Sources</span>
        {loose.length > 0 ? (
          <Links links={[{ item: "", sources: loose }]} selected={selected} onOpen={pick} />
        ) : (
          <span {...stylex.props(styles.nosource)}>
            <Icon name="quote" size="sm" />
            No source
          </span>
        )}
      </div>
      {findings.length > 0 && (
        <div {...stylex.props(styles.findings)}>
          {findings.map((f, i) => (
            <FindingCard
              key={`${f.kind}-${i}`}
              finding={f}
              stale={stale}
              where={`Step ${n}`}
              selected={selected}
              onSelect={pick}
            />
          ))}
        </div>
      )}
    </article>
  );
}
