import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Source } from "../../../core/types.ts";
import { openExternal } from "../../lib/desktop.ts";
import { sourceLabel } from "../../lib/fields.ts";
import {
  type Block,
  type Inline,
  type ListBlock,
  parseBlocks,
  parseInline,
  plainText,
  sameSource,
} from "../../lib/markdown.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { videoPreview } from "../sources/VideoPreview.tsx";
import { Button } from "../ui/Button.tsx";
import { Raw } from "../ui/Raw.tsx";
import { SourceChip } from "../ui/SourceChip.tsx";
import { Table } from "../ui/Table.tsx";
import { type } from "../ui/type.ts";

const blink = stylex.keyframes({ "0%, 49%": { opacity: 1 }, "50%, 100%": { opacity: 0 } });

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    maxWidth: size.reading,
    minWidth: 0,
    color: color.text,
    overflowWrap: "anywhere",
  },
  reading: { gap: space.s4 },
  block: { margin: 0 },
  heading: { margin: 0, marginBlockStart: { default: space.s2, ":first-child": 0 }, color: color.text },
  list: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
  nested: { marginBlockStart: space.s1 },
  quote: {
    margin: 0,
    paddingInlineStart: space.s3,
    borderInlineStartWidth: border.widthStrong,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: color.border,
    color: color.textMuted,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
  },
  rule: {
    width: "100%",
    margin: 0,
    borderWidth: 0,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
  },
  code: { paddingInline: space.s1, borderRadius: radius.r1, backgroundColor: color.surfaceSunken },
  table: { minWidth: 0, overflowX: "auto" },
  caret: {
    display: "inline-block",
    width: space.s1,
    height: "1em",
    marginInlineStart: space.s1,
    verticalAlign: "text-bottom",
    backgroundColor: color.claude,
    animationName: blink,
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

type Ctx = {
  listed: Source[];
  onOpenSource: (s: Source) => void;
  observed: (docId: string) => boolean;
  reading: boolean;
};

const Caret = () => <span aria-hidden="true" data-testid="caret" {...stylex.props(styles.caret)} />;

const open = (href: string) => {
  if (!openExternal(href)) window.open(href, "_blank", "noopener,noreferrer");
};

// ponytail: a source the answer lists under its text (`listed`) stays out of the line — the words before it lose the
// space that led to it
function inlines(list: Inline[], c: Ctx): ReactNode[] {
  return list.map((x, k) => {
    const next = list[k + 1];
    if (x.kind === "text") {
      const before = next?.kind === "source" && c.listed.some((s) => sameSource(s, next.source));
      const text = before ? x.text.replace(/\s+$/, "") : x.text;
      return text.split("\n").flatMap((line, j) => (j ? [<br key={`${k}-${j}`} />, line] : [line]));
    }
    if (x.kind === "strong")
      return (
        <strong key={k} {...stylex.props(type.strong)}>
          {inlines(x.children, c)}
        </strong>
      );
    if (x.kind === "em") return <em key={k}>{inlines(x.children, c)}</em>;
    if (x.kind === "code")
      return (
        <code key={k} {...stylex.props(type.mono, styles.code)}>
          {x.text}
        </code>
      );
    if (x.kind === "link") return <Button key={k} variant="link" label={x.text} onClick={() => open(x.href)} />;
    if (c.listed.some((s) => sameSource(s, x.source))) return null;
    return (
      <SourceChip
        key={k}
        reference={sourceLabel(x.source)}
        quote={x.source.quote}
        compact
        figure={isPictureAnchor(x.source.anchor)}
        observed={c.observed(x.source.docId)}
        preview={videoPreview(x.source)}
        onOpen={() => c.onOpenSource(x.source)}
      />
    );
  });
}

const line = (text: string, c: Ctx, caret: boolean) => (
  <>
    {inlines(parseInline(text), c)}
    {caret && <Caret />}
  </>
);

function List({ list, c, caret, nested }: { list: ListBlock; c: Ctx; caret: boolean; nested?: boolean }) {
  const items = list.items.map((it, k) => {
    const last = k === list.items.length - 1;
    return (
      <li key={k}>
        {line(it.text, c, caret && last && !it.children)}
        {it.children && <List list={it.children} c={c} caret={caret && last} nested />}
      </li>
    );
  });
  const look = stylex.props(styles.list, nested && styles.nested);
  return list.ordered ? (
    <ol start={list.start === 1 ? undefined : list.start} {...look}>
      {items}
    </ol>
  ) : (
    <ul {...look}>{items}</ul>
  );
}

function heading(b: Extract<Block, { kind: "heading" }>, c: Ctx, caret: boolean, k: number): ReactNode {
  const look = c.reading
    ? b.level <= 2
      ? type.title
      : type.titleSm
    : b.level === 1
      ? type.title
      : b.level === 2
        ? type.titleSm
        : type.strong;
  // ponytail: a page Claude wrote (the overview) is a page of its own, its # and ## under the page's title; an answer
  // sits inside a card of the dock, under its head
  const Tag = c.reading ? (b.level <= 2 ? "h2" : "h3") : b.level === 1 ? "h3" : b.level === 2 ? "h4" : "h5";
  return (
    <Tag key={k} {...stylex.props(look, styles.heading)}>
      {line(b.text, c, caret)}
    </Tag>
  );
}

function block(b: Block, c: Ctx, caret: boolean, k: number): ReactNode {
  if (b.kind === "heading") return heading(b, c, caret, k);
  if (b.kind === "para")
    return (
      <p key={k} {...stylex.props(styles.block)}>
        {line(b.text, c, caret)}
      </p>
    );
  if (b.kind === "list") return <List key={k} list={b} c={c} caret={caret} />;
  if (b.kind === "quote")
    return (
      <blockquote key={k} {...stylex.props(styles.quote)}>
        {b.blocks.map((x, j) => block(x, c, caret && j === b.blocks.length - 1, j))}
      </blockquote>
    );
  if (b.kind === "rule") return <hr key={k} {...stylex.props(styles.rule)} />;
  if (b.kind === "code")
    return (
      <div key={k} {...stylex.props(type.ui)}>
        <Raw text={b.text} label={b.lang ? `Code (${b.lang})` : "Code"} />
        {caret && <Caret />}
      </div>
    );
  const rows = b.rows.map((cells, r) => ({ key: `${r}`, cells }));
  return (
    <div key={k} {...stylex.props(type.ui, styles.table)}>
      <Table
        label={plainText(parseInline(b.head.join(" · "))) || "Table"}
        columns={b.head.map((h, i) => ({
          key: `${i}`,
          label: plainText(parseInline(h)),
          render: (row: { cells: string[] }) => inlines(parseInline(row.cells[i] ?? ""), c),
        }))}
        rows={rows}
        getKey={(r) => r.key}
        dense
        grid
      />
      {caret && <Caret />}
    </div>
  );
}

// ponytail: Claude's Markdown as React elements, never HTML — the blocks apart (the kit's spacing), the reading width
// bounded, titles and lists breaking up the text; each docId#anchor "quote" a source chip in the line, unless the answer
// lists it under the text (`listed`). In the interface's face, or the reading face for a page Claude wrote to be read
export function Markdown({
  text,
  running = false,
  listed = [],
  reading = false,
  onOpenSource,
}: {
  text: string;
  running?: boolean;
  listed?: Source[];
  reading?: boolean;
  onOpenSource: (s: Source) => void;
}) {
  const observed = useObserved();
  const blocks = parseBlocks(text);
  const c: Ctx = { listed, onOpenSource, observed, reading };
  return (
    <div {...stylex.props(reading ? type.reading : type.body, styles.root, reading && styles.reading)}>
      {blocks.map((b, k) => block(b, c, running && k === blocks.length - 1, k))}
      {running && !blocks.length && (
        <p {...stylex.props(styles.block)}>
          <Caret />
        </p>
      )}
    </div>
  );
}

/** a line of Markdown inside a sentence (a diagnosis): code, bold, italic and links; no block */
export function MarkdownLine({ text }: { text: string }) {
  return (
    <>{inlines(parseInline(text), { listed: [], onOpenSource: () => {}, observed: () => false, reading: false })}</>
  );
}
