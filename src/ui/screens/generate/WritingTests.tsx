import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { GenTestProgress } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { type } from "../../components/ui/type.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { WritingCard } from "./WritingCard.tsx";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: size.controlSm },
  title: { margin: 0 },
  grow: { flex: 1 },
  muted: { color: color.textMuted },
});

// ponytail: the tests of a running generation as Claude writes them — the one(s) it is on open by themselves and fold
// when done (the next one opens); a test opened or folded by hand stays as the hand left it; « Fold all » folds them all
export function WritingTests({ tests }: { tests: GenTestProgress[] }) {
  const [hand, setHand] = useState<Record<number, boolean>>({});
  const isOpen = (k: number) => hand[k] ?? tests[k].state === "writing";
  const anyOpen = tests.some((_, k) => isOpen(k));
  return (
    <section aria-label="Tests written" aria-live="polite" {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.head)}>
        <h3 {...stylex.props(type.body, type.strong, styles.title)}>Tests</h3>
        <Badge count size="sm" label={String(tests.length)} />
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(type.compact, styles.muted)}>Read only while Claude writes</span>
        {anyOpen && (
          <Button
            variant="quiet"
            size="sm"
            label="Fold all"
            onClick={() => setHand(Object.fromEntries(tests.map((_, k) => [k, false])))}
          />
        )}
      </div>
      {tests.length ? (
        tests.map((t, k) => (
          <WritingCard key={k} entry={t} open={isOpen(k)} onOpenChange={(o) => setHand((h) => ({ ...h, [k]: o }))} />
        ))
      ) : (
        <Card>
          <EmptyState
            compact
            icon="tests"
            title="No test written yet"
            text="Claude reads first, then plans, then writes."
          />
        </Card>
      )}
    </section>
  );
}
