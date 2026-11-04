import * as stylex from "@stylexjs/stylex";
import type { DocRef } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { plural } from "../../lib/format.ts";
import type { DocScope } from "../../lib/scope.ts";
import { border, color, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { SectionTree } from "./SectionTree.tsx";

const styles = stylex.create({
  frame: {
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  grow: { flex: 1 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  doc: {
    borderBottomStyle: "solid",
    borderBottomWidth: { default: border.width, ":last-child": 0 },
    borderBottomColor: color.border,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
  },
  side: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.s1, flexShrink: 0 },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
});

function IndexBadge({ doc, indexing }: { doc: DocRef; indexing: boolean }) {
  if (!doc.converted?.at) return null;
  if (indexing) return <Badge tone="info" busy size="sm" label="Indexing…" />;
  if (doc.indexed === "missing") return <Badge tone="danger" icon="alert-circle" size="sm" label="Not indexed" />;
  if (doc.indexed === "stale") return <Badge tone="warning" icon="alert-triangle" size="sm" label="Not up to date" />;
  return <Badge tone="success" icon="check" size="sm" label="Indexed" />;
}

export function DocScopePicker({
  docs,
  scopes,
  indexing = false,
  onChange,
  onAddDocuments,
}: {
  docs: DocRef[] | null;
  scopes: Record<string, DocScope>;
  indexing?: boolean;
  onChange: (next: Record<string, DocScope>) => void;
  onAddDocuments?: () => void;
}) {
  if (!docs)
    return (
      <div aria-busy="true" {...stylex.props(styles.frame, styles.loading)}>
        <Skeleton kind="row" />
        <Skeleton kind="row" />
      </div>
    );
  if (!docs.length)
    return (
      <div {...stylex.props(styles.frame)}>
        <EmptyState
          compact
          icon="documents"
          title="No document yet"
          text="Generate writes tests from the project's documents. Add one first."
          actions={onAddDocuments && <Button size="sm" label="Add documents" onClick={onAddDocuments} />}
        />
      </div>
    );
  const set = (id: string, s: DocScope) => onChange({ ...scopes, [id]: s });
  const of = (id: string): DocScope => scopes[id] ?? "all";
  const inScope = docs.filter((d) => of(d.id) !== "none").length;
  const narrowed = docs.filter((d) => Array.isArray(of(d.id))).length;
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.head)}>
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
      <ul aria-label="Documents in scope" {...stylex.props(styles.list)}>
        {docs.map((d) => {
          const s = of(d.id);
          const some = Array.isArray(s);
          const total = d.converted?.stats?.sections;
          const what =
            s === "all"
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
                    label={d.title || d.code}
                    hint={`${d.code} · ${what}`}
                    onChange={(on) => set(d.id, on ? "all" : "none")}
                  />
                </span>
                <span {...stylex.props(styles.side)}>
                  <IndexBadge doc={d} indexing={indexing} />
                  {some ? (
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
    </div>
  );
}
