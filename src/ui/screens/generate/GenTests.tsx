import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { FolderPanes } from "../../components/tree/FolderPanes.tsx";
import { LocalTree } from "../../components/tree/LocalTree.tsx";
import { localTree } from "../../components/tree/tree.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { LandedCard } from "./GenCard.tsx";
import type { GenCheck } from "./GenResult.tsx";
import { type GenRow, progressOf } from "./genRows.ts";
import type { GenFixes } from "./useGenFixes.ts";
import { WritingCard } from "./WritingCard.tsx";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", height: size.reading, minHeight: 0, minWidth: 0 },
  detail: { boxSizing: "border-box", paddingInline: space.s4, paddingBlock: space.s2 },
  meta: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  progress: { color: color.textMuted },
});

const STATE: Record<GenRow["state"], { label: string; tone: "success" | "claude" | "neutral" }> = {
  written: { label: "Written", tone: "success" },
  writing: { label: "Writing", tone: "claude" },
  waiting: { label: "Waiting", tone: "neutral" },
  missed: { label: "Not written", tone: "neutral" },
};

function Findings({ check }: { check?: GenCheck }) {
  if (!check) return null;
  if (check.errors) return <Badge tone="danger" icon="x-circle" size="sm" label={plural(check.errors, "error")} />;
  if (check.warnings)
    return <Badge tone="warning" icon="alert-triangle" size="sm" label={plural(check.warnings, "warning")} />;
  return <Badge tone="success" icon="check" size="sm" label="No findings" />;
}

// ponytail: the tests of a generation as the Tests screen files them — by folder, a planned theme being a sub-folder,
// each theme saying how far it is (« 18 / 30 ») while Claude writes — and the test picked below: the one Claude is on
// while it writes (it grows as it is saved), until another is picked; once done, its card with its fixes
export function GenTests({
  rows,
  running,
  refs,
  checks,
  fixes,
  onReview,
}: {
  rows: GenRow[];
  running: boolean;
  refs: LocalTestRef[] | undefined;
  checks?: GenCheck[];
  fixes?: GenFixes;
  onReview: (id: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);
  const root = localTree(rows, false);
  // ponytail: once done, the first test with a fix proposed opens first — that is where there is something to do
  const auto = running
    ? (rows.findLast((r) => r.state === "writing") ?? rows[0])
    : (rows.find((r) => r.id && fixes?.of(r.id).length) ?? rows[0]);
  const shown = rows.find((r) => r.key === picked) ?? auto;
  const checkOf = (id?: string) => checks?.find((c) => c.id === id);
  const renderTest = (r: GenRow): ListItemProps => {
    const state = STATE[r.state];
    const fixesOn = r.id && fixes ? fixes.of(r.id).length : 0;
    return {
      title: r.summary,
      tooltip: r.summary,
      meta: (
        <span {...stylex.props(styles.meta)}>
          {running || r.state !== "written" ? (
            <Badge tone={state.tone} busy={r.state === "writing"} size="sm" label={state.label} />
          ) : (
            <Findings check={checkOf(r.id)} />
          )}
          {fixesOn > 0 && (
            <Badge tone="claude" icon="claude" size="sm" label={`${fixesOn} ${fixesOn === 1 ? "fix" : "fixes"}`} />
          )}
        </span>
      ),
      ...(!running && r.id
        ? {
            actions: (
              <Button
                variant="quiet"
                size="xs"
                iconAfter="arrow-right"
                label="Review"
                onClick={() => r.id && onReview(r.id)}
              />
            ),
          }
        : {}),
    };
  };
  const toggle = (path: string) =>
    setShut((s) => {
      const n = new Set(s);
      if (!n.delete(path)) n.add(path);
      return n;
    });
  return (
    <section aria-label="Tests written" aria-live="polite" {...stylex.props(styles.box)}>
      <FolderPanes
        name="generate"
        layout="rows"
        foldersTitle={running ? "Tests by theme · Read only while Claude writes" : "Tests by theme"}
        title={shown ? shown.summary : ""}
        code={false}
        folders={
          rows.length ? (
            <LocalTree<GenRow>
              label="Tests of the generation"
              root={root}
              shut={shut}
              forceOpen={false}
              activeId={shown?.key ?? ""}
              getKey={(r) => r.key}
              renderTest={renderTest}
              folderTrail={(n) => {
                const p = progressOf(n);
                return (
                  <span {...stylex.props(type.code, styles.progress)}>
                    {running ? `${p.written} / ${p.total}` : p.total}
                  </span>
                );
              }}
              onOpen={(k) => {
                setPicked(k);
                setOpen(true);
              }}
              onToggle={toggle}
            />
          ) : (
            <EmptyState
              compact
              icon="tests"
              title="No test written yet"
              text="Claude reads first, then plans, then writes."
            />
          )
        }
      >
        {shown && (
          <div {...stylex.props(styles.detail)}>
            {running || !shown.id ? (
              <WritingCard key={shown.key} entry={shown.entry} open={open} onOpenChange={setOpen} />
            ) : (
              <LandedCard
                key={shown.key}
                id={shown.id}
                refs={refs}
                check={checkOf(shown.id)}
                onOpen={() => shown.id && onReview(shown.id)}
                {...(fixes ? { fixes: { list: fixes.of(shown.id), onFix: fixes.run, onDismiss: fixes.dismiss } } : {})}
              />
            )}
          </div>
        )}
      </FolderPanes>
    </section>
  );
}
