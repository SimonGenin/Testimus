import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode, useMemo } from "react";
import { type Lookup, lines, linesRead, type Outline, outlineOf, type Phase, type Span } from "../../lib/activity.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { border, color, fontFamily, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  map: { display: "flex", flexDirection: "column", gap: space.s2 },
  track: { boxSizing: "border-box", position: "relative", paddingTop: space.s1 },
  trackPins: { paddingTop: space.s4 },
  pin: {
    position: "absolute",
    top: 0,
    width: space.s3,
    height: space.s3,
    marginInlineStart: `calc(${space.s3} / -2)`,
    borderRadius: radius.full,
    backgroundColor: color.claude,
  },
  bar: {
    position: "relative",
    height: space.s3,
    borderRadius: radius.r1,
    backgroundColor: color.surfaceSunken,
    overflow: "hidden",
  },
  chapter: { position: "absolute", top: 0, bottom: 0, width: border.width, backgroundColor: color.borderStrong },
  marks: { position: "relative", height: "1lh", overflow: "hidden", color: color.textSubtle },
  mark: {
    position: "absolute",
    top: 0,
    paddingInlineStart: space.s1,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
    whiteSpace: "nowrap",
  },
  page: { position: "absolute", top: 0, bottom: 0, backgroundColor: color.claudeBorder },
  latest: { backgroundColor: color.claude },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.s4,
    margin: 0,
    color: color.textMuted,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  swatch: { width: space.s4, height: space.s3, borderRadius: radius.r1, backgroundColor: color.claudeBorder },
  dot: { width: space.s3, height: space.s3, borderRadius: radius.full, backgroundColor: color.claude },
  search: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    color: color.textMuted,
  },
  query: { fontFamily: fontFamily.reading, color: color.text },
  muted: { color: color.textSubtle },
  lookups: {
    display: "grid",
    gridTemplateColumns: `minmax(${size.iconLg}, auto) minmax(0, 1fr)`,
    columnGap: space.s4,
    rowGap: space.s2,
    margin: 0,
  },
  dt: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.textSubtle },
  dd: { margin: 0, display: "flex", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  opened: { display: "flex", flexDirection: "column", gap: space.s1 },
  open: { display: "flex", gap: space.s2, alignItems: "baseline" },
});

export const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];
export const docsOf = (p: Phase) =>
  unique([...p.reads.map((r) => r.doc), ...p.lookups.filter((l) => l.kind === "open").map((l) => l.doc)]);

// ponytail: the outline of a document Claude read — its length, chapters and anchors — read once per document
export function useOutline(doc: string): Outline | null | undefined {
  const r = useRead("docs.show", { id: doc }, { enabled: !!doc });
  const md = (r.data as { md?: string } | undefined)?.md;
  return useMemo(
    () => (r.error ? null : md === undefined ? (r.data ? null : undefined) : outlineOf(md)),
    [md, r.error, r.data],
  );
}

function readLine(spans: Span[], total: number | undefined): string {
  const c = linesRead(spans);
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const parts = [
    c.whole && !known.length
      ? "Read in one go"
      : `Lines ${lines(1)}–${lines(c.last)}${total ? ` of ${lines(total)}` : ""}, in ${plural(known.length, "page")}${c.inOrder ? ", front to back" : ""}`,
  ];
  if (c.read && c.read < c.last) parts.push(`${lines(c.last - c.read)} lines skipped`);
  parts.push(c.twice > 2 * known.length ? `${lines(c.twice)} lines read more than once` : "nothing read twice");
  return `${parts.join("; ")}.`;
}

// the labels under the reading bar: the chapters and the sections opened from the index, by line
export function sectionMarks(
  outline: Outline | null | undefined,
  pins: { anchor: string; line: number }[],
): { anchor: string; line: number }[] {
  const chapters = outline
    ? [...outline.anchors].flatMap(([anchor, at]) =>
        anchor.startsWith("§") && outline.chapters.includes(at.line) ? [{ anchor, line: at.line }] : [],
      )
    : [];
  const all = [...chapters, ...pins.map((p) => ({ anchor: p.anchor, line: p.line }))];
  return all.filter((m, i) => all.findIndex((x) => x.anchor === m.anchor) === i).sort((a, b) => a.line - b.line);
}

// ponytail: where in the document Claude read — the pages it read on a bar the document's length, the sections it
// opened from the index as pins
export function DocMap({ doc, spans, hits, live }: { doc: string; spans: Span[]; hits: Lookup[]; live: boolean }) {
  const outline = useOutline(doc);
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const anchors = unique(hits.map((h) => h.anchor));
  const pins = anchors.flatMap((a) => {
    const at = outline?.anchors.get(a);
    return at ? [{ anchor: a, ...at }] : [];
  });
  const end = Math.max(outline?.total ?? 0, linesRead(spans).last, ...pins.map((p) => p.line));
  const pct = (n: number) => `${(n / end) * 100}%`;
  const marks = sectionMarks(outline, pins);
  return (
    <div {...stylex.props(styles.map)}>
      {end > 0 && (
        <div {...stylex.props(styles.track, pins.length > 0 && styles.trackPins)}>
          {pins.map((p) => (
            <span
              key={p.anchor}
              data-testid="docmap-pin"
              title={`${p.anchor} ${p.title} · line ${lines(p.line)}`.replace(/\s+·/, " ·")}
              style={{ left: pct(p.line - 1) }}
              {...stylex.props(styles.pin)}
            />
          ))}
          <div
            role="img"
            aria-label={`Lines read: ${known.map((s) => `${s.from} to ${s.to}`).join(", ")}${outline?.total ? ` of ${outline.total}` : ""}`}
            {...stylex.props(styles.bar)}
          >
            {outline?.chapters.slice(1).map((l) => (
              <span
                key={l}
                data-testid="readbar-chapter"
                style={{ left: pct(l - 1) }}
                {...stylex.props(styles.chapter)}
              />
            ))}
            {known.map((s, i) => {
              const latest = live && i === known.length - 1;
              return (
                <span
                  key={i}
                  data-testid={latest ? "readbar-latest" : "readbar-page"}
                  style={{ left: pct(s.from - 1), width: pct(s.to - s.from + 1) }}
                  {...stylex.props(styles.page, latest && styles.latest)}
                />
              );
            })}
          </div>
          {marks.length > 0 && (
            <div aria-hidden="true" data-testid="readbar-marks" {...stylex.props(type.code, styles.marks)}>
              {marks.map((m) => (
                <span key={m.anchor} style={{ left: pct(m.line - 1) }} {...stylex.props(styles.mark)}>
                  {m.anchor}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <p {...stylex.props(type.small, styles.legend)}>
        {spans.length > 0 && (
          <span {...stylex.props(styles.legendItem)}>
            <i aria-hidden="true" {...stylex.props(styles.swatch)} />
            {readLine(spans, outline?.total)}
          </span>
        )}
        {anchors.length > 0 && (
          <span {...stylex.props(styles.legendItem)}>
            <i aria-hidden="true" {...stylex.props(styles.dot)} />
            {plural(anchors.length, "section")} opened from the index
          </span>
        )}
      </p>
    </div>
  );
}

const Quote = ({ q }: { q: string }) => (
  <span data-testid="act-query" {...stylex.props(styles.query)}>
    “{q}”
  </span>
);

export function Searches({ p }: { p: Phase }) {
  const queries = unique(p.lookups.filter((l) => l.kind === "search").map((l) => l.text));
  if (!queries.length) return null;
  return (
    <p data-testid="act-search" {...stylex.props(type.small, styles.search)}>
      <Icon name="search" size="sm" />
      Searched for
      {queries.slice(0, 3).map((q) => (
        <Quote key={q} q={q} />
      ))}
      {queries.length > 3 && <span {...stylex.props(styles.muted)}>and {queries.length - 3} more</span>}
    </p>
  );
}

function Opened({ l, many }: { l: Lookup; many: boolean }) {
  const at = useOutline(l.doc)?.anchors.get(l.anchor);
  return (
    <span {...stylex.props(styles.open)}>
      <code {...stylex.props(type.code)}>{many ? l.text : l.anchor || l.doc}</code>
      <span>{at?.title ?? ""}</span>
      <span {...stylex.props(styles.muted)}>{at?.line ? `line ${lines(at.line)}` : ""}</span>
    </span>
  );
}

// ponytail: the lookups of a phase grouped by what they did — read, searched, opened, followed, every mention
export function Lookups({ p }: { p: Phase }) {
  const docs = docsOf(p);
  const seen = new Set<string>();
  const opens = p.lookups.filter((l) => l.kind === "open" && !seen.has(l.text) && seen.add(l.text));
  const follows = unique(p.lookups.filter((l) => l.kind === "follow").map((l) => l.text));
  const searches = unique(p.lookups.filter((l) => l.kind === "search").map((l) => l.text));
  const mentions = unique(p.lookups.filter((l) => l.kind === "mention").map((l) => l.text));
  const row = (term: string, body: ReactNode, icon?: IconName) => (
    <>
      <dt {...stylex.props(type.medium, styles.dt)}>
        {icon && <Icon name={icon} size="sm" />}
        {term}
      </dt>
      <dd {...stylex.props(styles.dd)}>{body}</dd>
    </>
  );
  return (
    <dl {...stylex.props(type.small, styles.lookups)}>
      {p.reads.map((r) => (
        <Fragment key={r.doc}>
          {row(
            `Read${docs.length > 1 ? ` ${r.doc}` : ""}`,
            r.spans
              .map((s) => (s.to === null ? "the whole document" : `lines ${lines(s.from)}–${lines(s.to)}`))
              .join(", "),
          )}
        </Fragment>
      ))}
      {searches.length > 0 &&
        row(
          "Searched for",
          searches.map((q) => <Quote key={q} q={q} />),
          "search",
        )}
      {opens.length > 0 &&
        row(
          "Opened",
          <span {...stylex.props(styles.opened)}>
            {opens.map((o) => (
              <Opened key={o.text} l={o} many={docs.length > 1} />
            ))}
          </span>,
        )}
      {follows.length > 0 &&
        row(
          "Followed links from",
          follows.map((f) => (
            <code key={f} {...stylex.props(type.code)}>
              {f}
            </code>
          )),
        )}
      {mentions.length > 0 &&
        row(
          "Every mention of",
          mentions.map((q) => <Quote key={q} q={q} />),
          "link",
        )}
    </dl>
  );
}
