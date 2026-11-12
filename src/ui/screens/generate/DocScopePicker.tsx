import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DocRef } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { type DocScope, type DocWork, unready } from "../../lib/scope.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { DocScopeRow } from "./DocScopeRow.tsx";
import { type DocGroup, docGroups } from "./docGroups.ts";

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.row,
    paddingBlock: space.s2,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    color: color.text,
  },
  open: { borderBottomStyle: "solid", borderBottomWidth: border.width, borderBottomColor: color.border },
  line: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textMuted },
  list: { listStyle: "none", margin: 0, padding: 0 },
  group: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInlineStart: space.s2,
    paddingInlineEnd: space.s3,
    backgroundColor: color.surfaceSunken,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  grow: { flex: 1, minWidth: 0 },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
  notice: { padding: space.s3 },
});

const converted = (d: DocRef) => !!d.converted?.at;

// ponytail: the scope in one line — « All documents (125) » until something is narrowed, else how many are in and how
// many narrowed to sections — and « Narrow… » unfolds it: the import folders, their documents, then their sections
export function DocScopePicker({
  docs,
  scopes,
  work = { converting: [] },
  onChange,
  onAddDocuments,
}: {
  docs: DocRef[] | null;
  scopes: Record<string, DocScope>;
  work?: DocWork;
  onChange: (next: Record<string, DocScope>) => void;
  onAddDocuments?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [shut, setShut] = useState<Set<string> | null>(null);
  if (!docs)
    return (
      <Card padded={false}>
        <div aria-busy="true" {...stylex.props(styles.loading)}>
          <Skeleton kind="row" />
          <Skeleton kind="row" />
          <Loading read="docs.list" />
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
  const waiting = docs.length - usable.length;
  const whole = inScope === usable.length && !narrowed;
  const summary = !usable.length
    ? "No document ready yet"
    : whole
      ? `All documents (${usable.length})`
      : `${inScope} of ${plural(usable.length, "document")}${narrowed ? `, ${narrowed} narrowed` : ""}`;
  const groups = docGroups(docs);
  const grouped = groups.length > 1;
  // ponytail: with several import folders, each starts folded; a folder opened or folded by hand stays so
  const folded = shut ?? new Set(grouped ? groups.map((g) => g.key) : []);
  const fold = (key: string) => {
    const next = new Set(folded);
    if (!next.delete(key)) next.add(key);
    setShut(next);
  };
  const tickGroup = (g: DocGroup, on: boolean) =>
    onChange({
      ...scopes,
      ...Object.fromEntries(g.docs.filter((d) => !unready(d, work)).map((d) => [d.id, on ? "all" : "none"])),
    });
  const groupTick = (g: DocGroup): boolean | "mixed" => {
    const live = g.docs.filter((d) => !unready(d, work));
    const on = live.filter((d) => of(d.id) === "all").length;
    if (live.length && on === live.length) return true;
    return live.some((d) => of(d.id) !== "none") ? "mixed" : false;
  };
  const row = (d: DocRef, nested: boolean) => {
    const why = unready(d, work);
    return (
      <DocScopeRow
        key={d.id}
        doc={d}
        scope={why ? "none" : of(d.id)}
        why={why}
        nested={nested}
        onChange={(s) => set(d.id, s)}
      />
    );
  };
  return (
    <Card padded={false}>
      <div {...stylex.props(type.compact, styles.head, open && styles.open)}>
        <span {...stylex.props(styles.line)}>
          <Icon name="documents" size="sm" />
          <span>{summary}</span>
          {waiting > 0 && <span {...stylex.props(type.small, styles.muted)}>· {waiting} not ready</span>}
        </span>
        {open && (
          <>
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
          </>
        )}
        <Button
          size="sm"
          variant="quiet"
          label={open ? "Fold" : "Narrow…"}
          expanded={open}
          onClick={() => setOpen(!open)}
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
      {open && (
        <ul aria-label="Documents in scope" {...stylex.props(styles.list)}>
          {grouped
            ? groups.map((g) => (
                <li key={g.key || "-"}>
                  <div {...stylex.props(styles.group)}>
                    <Button
                      variant="quiet"
                      size="sm"
                      iconOnly
                      icon={folded.has(g.key) ? "chevron-right" : "chevron-down"}
                      label={`${folded.has(g.key) ? "Unfold" : "Fold"} ${g.name}`}
                      expanded={!folded.has(g.key)}
                      onClick={() => fold(g.key)}
                    />
                    <span {...stylex.props(styles.grow)}>
                      <Checkbox
                        checked={groupTick(g)}
                        icon="folder"
                        label={g.name}
                        hint={`${g.path ? `${g.path} · ` : ""}${plural(g.docs.length, "document")}`}
                        onChange={(on) => tickGroup(g, on)}
                      />
                    </span>
                  </div>
                  {!folded.has(g.key) && (
                    <ul aria-label={`Documents of ${g.name}`} {...stylex.props(styles.list)}>
                      {g.docs.map((d) => row(d, true))}
                    </ul>
                  )}
                </li>
              ))
            : docs.map((d) => row(d, false))}
        </ul>
      )}
    </Card>
  );
}
