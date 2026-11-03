import type { Finding, Source, Step, XrayJson } from "../../../core/types.ts";
import {
  ClaudeBadge,
  FindingCard,
  IconButton,
  ItemLinks,
  Severity,
  SourceChip,
} from "../../components/legacy/index.ts";
import { fieldViews, itemLinks, parseSourceRef, stepSources } from "../../lib/fields.ts";
import { cx, plural } from "../../lib/format.ts";
import { FieldBlocks } from "../tests/FieldBlocks.tsx";

const noop = () => {};

export const refKey = (s: Pick<Source, "docId" | "anchor">) => `${s.docId}#${s.anchor}`;

export function findingSummary(fs: Finding[]): { tone: "error" | "warning" | "info" | "ok"; text: string } {
  const e = fs.filter((f) => f.severity === "error").length;
  const w = fs.filter((f) => f.severity === "warning").length;
  const i = fs.filter((f) => f.severity === "info").length;
  if (e) return { tone: "error", text: plural(e, "error") };
  if (w) return { tone: "warning", text: plural(w, "warning") };
  if (i) return { tone: "info", text: plural(i, "note") };
  return { tone: "ok", text: "No findings" };
}

const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";

export function FindingSources({
  finding,
  selected,
  onSelect,
}: {
  finding: Finding;
  selected: string;
  onSelect: (s: Source) => void;
}) {
  const refs = finding.sources.map(parseSourceRef).filter((s): s is Source => !!s);
  if (!refs.length) return null;
  return (
    <div className="chips">
      {refs.map((s) => (
        <SourceChip key={refKey(s)} source={s} on={selected === refKey(s)} onOpen={onSelect} />
      ))}
    </div>
  );
}

export function ReviewStep({
  n,
  step,
  xray,
  findings,
  stale,
  folded,
  active,
  claude,
  added,
  selected,
  url,
  onFold,
  onSelect,
  onOpenImage,
}: {
  n: number;
  step: Step;
  xray: XrayJson;
  findings: Finding[];
  stale: boolean;
  folded: boolean;
  active: boolean;
  claude?: boolean;
  added?: boolean;
  selected: string;
  url: (file: string) => string;
  onFold: (folded: boolean) => void;
  onSelect: (s: Source, step: number) => void;
  onOpenImage: (file: string) => void;
}) {
  const sum = findingSummary(findings);
  const tone = stale && sum.tone !== "ok" ? "stale" : sum.tone;
  const views = fieldViews(xray, step);
  const loose = stepSources(
    xray,
    step,
    views.map((v) => v.name),
  );
  const pick = (s: Source) => onSelect(s, n);

  if (folded)
    return (
      <article className={cx("card rstep rstep-folded", active && "is-active")} aria-label={`Step ${n}`}>
        <span className="num">{n}</span>
        {claude && <ClaudeBadge added={added} small />}
        <span className="rstep-line">
          {firstLine(step.fields[views[0]?.name ?? "Action"] ?? "") || <span className="muted">Empty step</span>}
        </span>
        <Severity tone={tone}>{sum.text}</Severity>
        <IconButton icon="down" label={`Expand step ${n}`} onClick={() => onFold(false)} />
      </article>
    );

  return (
    <article
      className={cx("card rstep", active && "is-active", findings.length > 0 && "has-findings")}
      aria-label={`Step ${n}`}
    >
      <div className="rstep-head">
        <span className="num">{n}</span>
        {claude && <ClaudeBadge added={added} />}
        <Severity tone={tone}>{sum.text}</Severity>
        <span className="spacer" />
        <IconButton icon="up" label={`Fold step ${n}`} onClick={() => onFold(true)} />
      </div>
      {views.map((v) => {
        const value = step.fields[v.name] ?? "";
        if (!value.trim() && !v.collapsed) return null;
        const links = itemLinks(xray, step, v.name);
        return (
          <div key={v.name} className="fl" data-field={v.name}>
            <span className="fl-k">{v.name}</span>
            {!value.trim() ? (
              <span className="muted fl-empty">Folded · empty</span>
            ) : (
              <div className="fl-v">
                <FieldBlocks
                  idBase={`r${n}-${v.name.replace(/\W+/g, "")}`}
                  name={v.name}
                  label={v.name}
                  text={value}
                  images={step.images}
                  url={url}
                  stepNumber={n}
                  readOnly
                  onText={noop}
                  onAddFiles={noop}
                  onFieldText={noop}
                  onDropBlock={noop}
                  onRemove={noop}
                  onOpen={onOpenImage}
                />
                {links.length > 0 && <ItemLinks column={v.name} links={links} selected={selected} onOpen={pick} />}
              </div>
            )}
          </div>
        );
      })}
      {loose.length > 0 && (
        <div className="fl">
          <span className="fl-k">Sources</span>
          <div className="chips">
            {loose.map((s, i) => (
              <SourceChip key={i} source={s} on={selected === refKey(s)} onOpen={pick} />
            ))}
          </div>
        </div>
      )}
      {findings.map((f, i) => (
        <FindingCard key={i} finding={f} stale={stale}>
          <FindingSources finding={f} selected={selected} onSelect={pick} />
          {!f.sources.length && f.pass === "semantic" && (
            <span className="muted find-note">No passage was found for it.</span>
          )}
        </FindingCard>
      ))}
    </article>
  );
}
