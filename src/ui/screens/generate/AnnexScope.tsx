import * as stylex from "@stylexjs/stylex";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { useRead } from "../../lib/data/query.ts";
import { batchLine, isObserved } from "../../lib/media.ts";
import type { DocScope, TocEntry } from "../../lib/scope.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  list: {
    boxSizing: "border-box",
    listStyle: "none",
    margin: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: space.s3,
    paddingInlineStart: space.s7,
    paddingInlineEnd: space.s3,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
  },
});

// ponytail: the document's whole body and every annex but those left out — what « all » becomes once one annex is
// unticked; back to « all » when nothing is left out any more
export function withAnnex(scope: DocScope, toc: TocEntry[], annex: string, on: boolean): DocScope {
  const body = toc.filter((t) => !isObserved(t.anchor));
  const top = body.length ? Math.min(...body.map((t) => t.level)) : 0;
  const annexes = toc.filter((t) => isObserved(t.anchor) && t.level === 0).map((t) => t.anchor);
  const whole = [...body.filter((t) => t.level === top).map((t) => t.anchor), ...annexes];
  const now = scope === "all" ? whole : scope === "none" ? [] : scope;
  const next = on ? [...new Set([...now, annex])] : now.filter((a) => a !== annex);
  return whole.every((a) => next.includes(a)) && next.length === whole.length ? "all" : next;
}

// ponytail: under a document in scope, its annexes (the batches in it) as sections of their own — ticked with the
// document by default, each one left out on its own
export function AnnexScope({
  docId,
  scope,
  onChange,
}: {
  docId: string;
  scope: DocScope;
  onChange: (s: DocScope) => void;
}) {
  const batches = useRead("media.list", { doc: docId }).data;
  const shown = useRead("docs.show", { id: docId, brief: true });
  const toc = (shown.data?.toc ?? []) as TocEntry[];
  const annexes = (Array.isArray(batches) ? batches : []).filter((b) => b.included);
  if (!annexes.length || scope === "none") return null;
  const ticked = (anchor: string) => scope === "all" || (Array.isArray(scope) && scope.includes(anchor));
  return (
    <ul aria-label="Annexes in scope" {...stylex.props(styles.list)}>
      {annexes.map((b) => (
        <li key={b.id}>
          <Checkbox
            checked={ticked(b.anchor)}
            disabled={toc.length ? false : "Reading the document's outline"}
            label={`Annex — ${b.title}`}
            hint={`${batchLine(b)} · observed: how to do the steps, never what is expected`}
            onChange={(on) => onChange(withAnnex(scope, toc, b.anchor, on))}
          />
        </li>
      ))}
    </ul>
  );
}
