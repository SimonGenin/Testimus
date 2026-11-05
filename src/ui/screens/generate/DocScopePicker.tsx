import * as stylex from "@stylexjs/stylex";
import type { DocRef } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { type DocScope, type DocWork, type Unready, unready } from "../../lib/scope.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { indexWord } from "../documents/badges.tsx";
import { SectionTree } from "./SectionTree.tsx";

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    color: color.textMuted,
  },
  grow: { flex: 1 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  doc: {
    boxSizing: "border-box",
    borderBottomStyle: "solid",
    borderBottomWidth: { default: border.width, ":last-child": 0 },
    borderBottomColor: color.border,
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s3,
  },
  side: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.s1, flexShrink: 0 },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
  notice: { padding: space.s3 },
});

const converted = (d: DocRef) => !!d.converted?.at;

// ponytail: why a document cannot be picked yet — the line under its name, and the checkbox's reason
const WHY: Record<Unready, { what: string; reason: string }> = {
  "not-converted": { what: "not converted yet", reason: "Not converted: convert it in Documents first" },
  converting: { what: "being converted · available once indexed", reason: "Being converted: wait until it is indexed" },
  indexing: { what: "being indexed · available when it is done", reason: "Being indexed: wait until it is done" },
  "not-indexed": { what: "not indexed · reindex to use it", reason: "Not indexed: reindex to use it" },
};

// ponytail: the same words as the Documents list (badges.tsx), « Converting… » or « Indexing… » while that work runs
function IndexBadge({ doc, why }: { doc: DocRef; why: Unready | null }) {
  if (why === "converting") return <Badge tone="info" busy size="sm" label="Converting…" />;
  if (why === "indexing") return <Badge tone="info" busy size="sm" label="Indexing…" />;
  return <Badge size="sm" {...indexWord(doc)} />;
}

export function DocScopePicker({
  docs,
  scopes,
  work = { converting: [], indexing: false },
  onChange,
  onAddDocuments,
}: {
  docs: DocRef[] | null;
  scopes: Record<string, DocScope>;
  work?: DocWork;
  onChange: (next: Record<string, DocScope>) => void;
  onAddDocuments?: () => void;
}) {
  if (!docs)
    return (
      <Card padded={false}>
        <div aria-busy="true" {...stylex.props(styles.loading)}>
          <Skeleton kind="row" />
          <Skeleton kind="row" />
        </div>
      </Card>
    );
  if (!docs.length)
    return (
      <Card padded={false}>
        <EmptyState
          compact
          icon="documents"
          title="No document yet"
          text="Generate writes tests from the project's documents. Add one first."
          actions={
            onAddDocuments && <Button size="sm" icon="documents" label="Go to Documents" onClick={onAddDocuments} />
          }
        />
      </Card>
    );
  const set = (id: string, s: DocScope) => onChange({ ...scopes, [id]: s });
  const of = (id: string): DocScope => scopes[id] ?? "all";
  const usable = docs.filter((d) => !unready(d, work));
  const inScope = usable.filter((d) => of(d.id) !== "none").length;
  const narrowed = usable.filter((d) => Array.isArray(of(d.id))).length;
  return (
    <Card padded={false}>
      <div {...stylex.props(type.small, styles.head)}>
        <span>
          {inScope} of {plural(docs.length, "document")}
          {narrowed ? ` · ${narrowed} narrowed to sections` : ""}
        </span>
        <span {...stylex.props(styles.grow)} />
        <Button
          size="sm"
          variant="quiet"
          label="Select all"
          onClick={() => onChange(Object.fromEntries(docs.map((d) => [d.id, "all"])))}
        />
        <Button
          size="sm"
          variant="quiet"
          label="Select none"
          onClick={() => onChange(Object.fromEntries(docs.map((d) => [d.id, "none"])))}
        />
      </div>
      {!docs.some(converted) && (
        <div {...stylex.props(styles.notice)}>
          <Banner
            tone="info"
            compact
            title="No document is converted yet"
            actions={
              onAddDocuments && <Button size="sm" icon="documents" label="Go to Documents" onClick={onAddDocuments} />
            }
          >
            Generate reads converted documents only: convert one in Documents first.
          </Banner>
        </div>
      )}
      <ul aria-label="Documents in scope" {...stylex.props(styles.list)}>
        {docs.map((d) => {
          const why = unready(d, work);
          const s = why ? "none" : of(d.id);
          const some = Array.isArray(s);
          const total = d.converted?.stats?.sections;
          const what = why
            ? WHY[why].what
            : s === "all"
              ? `whole document${total ? ` · ${plural(total, "section")}` : ""}`
              : s === "none"
                ? "left out"
                : s.length
                  ? `${plural(s.length, "section")} picked`
                  : "no section picked yet";
          return (
            <li key={d.id} {...stylex.props(styles.doc)}>
              <div {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.grow)}>
                  <Checkbox
                    checked={some ? "mixed" : s === "all"}
                    disabled={why ? WHY[why].reason : false}
                    label={d.title || d.code}
                    hint={`${d.code} · ${what}`}
                    onChange={(on) => set(d.id, on ? "all" : "none")}
                  />
                </span>
                <span {...stylex.props(styles.side)}>
                  <IndexBadge doc={d} why={why} />
                  {why ? null : some ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      label="Back to the whole document"
                      onClick={() => set(d.id, "all")}
                    />
                  ) : (
                    <Button size="sm" variant="quiet" label="Only some sections…" onClick={() => set(d.id, [])} />
                  )}
                </span>
              </div>
              {some && <SectionTree docId={d.id} picked={s} onChange={(a) => set(d.id, a)} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
