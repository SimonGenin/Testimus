import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode, useMemo } from "react";
import { type Lookup, lines, linesRead, type Outline, outlineOf, type Phase, type Span } from "../../lib/activity.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { ReadMap } from "../ui/ReadMap.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  search: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    color: color.textMuted,
  },
  query: { color: color.text },
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

// ponytail: a chapter or a section is named by its number (« §5.6 ») when it has one, else by its heading — an anchor
// made from the heading's words (« §sending-a-verification-job ») says less than the heading itself
const nameOf = (anchor: string, title: string) => (/^§\d/.test(anchor) || !title ? anchor : title);

// ponytail: where in the document Claude read — the kit's ReadMap over the document's outline: the lines it read, the
// sections it opened from the index over their extent, the chapters under the bar
export function DocMap({ doc, spans, hits, live }: { doc: string; spans: Span[]; hits: Lookup[]; live: boolean }) {
  const outline = useOutline(doc);
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const c = linesRead(spans);
  const total = Math.max(outline?.total ?? 0, c.last);
  const sections = outline
    ? [...outline.anchors]
        .filter(([a]) => a.startsWith("§"))
        .map(([anchor, at]) => ({ anchor, ...at }))
        .sort((a, b) => a.line - b.line)
    : [];
  const chapters = sections
    .filter((x) => outline?.chapters.includes(x.line))
    .map((x) => ({ label: nameOf(x.anchor, x.title), title: `${x.anchor} ${x.title}`.trim(), line: x.line }));
  const opened = unique(hits.map((h) => h.anchor)).map((anchor) => {
    const i = sections.findIndex((x) => x.anchor === anchor);
    const at = outline?.anchors.get(anchor);
    if (!at) return { label: anchor, from: 0, to: -1 };
    const title = `${anchor} ${at.title}`.trim();
    // ponytail: a section reaches the next heading; a figure is its one line
    const to = i >= 0 ? (sections[i + 1]?.line ?? total + 1) - 1 : at.line;
    return { label: nameOf(anchor, at.title), title, from: at.line, to };
  });
  const read = c.whole && !known.length && total ? [{ from: 1, to: total }] : known;
  return (
    <ReadMap
      total={total}
      chapters={chapters}
      read={read}
      opened={opened}
      live={live}
      summary={spans.length > 0 ? readLine(spans, outline?.total) : undefined}
      label={`Where Claude read ${doc}`}
    />
  );
}

const Quote = ({ q }: { q: string }) => (
  <span data-testid="act-query" {...stylex.props(type.readingFace, styles.query)}>
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
