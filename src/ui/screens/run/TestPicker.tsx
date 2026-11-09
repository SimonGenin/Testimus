import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import { FilterBar } from "../../components/filters/FilterBar.tsx";
import { type CheckNode, CheckTree } from "../../components/pick/CheckTree.tsx";
import { Badge, ReviewBadge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import {
  flatChain,
  keepTests,
  NO_PICK_FILTER,
  type PickFilters,
  type PickTest,
  pickOptions,
  type TestNode,
  testTree,
  treeOrder,
} from "./testTree.ts";

const styles = stylex.create({
  tools: {
    display: "flex",
    flexDirection: "column",
    padding: space.s3,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  count: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    backgroundColor: color.surfaceSunken,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    color: color.textMuted,
  },
  strong: { color: color.text },
  grow: { flex: 1 },
  scroll: { maxHeight: "22rem", overflowY: "auto" },
  key: { color: color.textMuted },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
});

const toChecks = (nodes: TestNode[]): CheckNode[] =>
  nodes.map((n) =>
    n.kind === "branch"
      ? { key: n.key, label: n.label, children: toChecks(n.children) }
      : {
          key: n.key,
          label: n.test.summary,
          meta: (
            <>
              <span {...stylex.props(type.code, styles.key)}>{n.test.key ?? "local"}</span>
              {!!n.test.findings?.errors && (
                <Badge size="sm" tone="danger" icon="x-circle" label={plural(n.test.findings.errors, "error")} />
              )}
              {!n.test.findings?.errors && !!n.test.findings?.warnings && (
                <Badge
                  size="sm"
                  tone="warning"
                  icon="alert-triangle"
                  label={plural(n.test.findings.warnings, "warning")}
                />
              )}
              {n.test.fix && <Badge size="sm" tone="claude" icon="claude" label="Fix proposed" />}
              <ReviewBadge state={n.test.review} size="sm" />
            </>
          ),
        },
  );

// ponytail: tests picked as Generate picks sections — the project's tests by folder (or only some of them: Generate's
// pick among a generation's tests), a folder ticking all its tests; the filter bar above narrows what the tree shows, and
// what it hides stays picked. onChange gives the picked tests in the tree's order: the order a run plays them
export function TestPicker({
  onChange,
  only,
  fixes,
  initial,
}: {
  onChange: (ids: string[]) => void;
  /** pick among these tests only */
  only?: string[];
  /** the tests Claude proposes a fix on: the Findings menu gets « With a fix » */
  fixes?: string[];
  /** picked at first */
  initial?: string[];
}) {
  const r = useRead("tests.list", {});
  const tests = useMemo(() => {
    const all = r.data as PickTest[] | undefined;
    if (!all) return null;
    return all
      .filter((t) => !only || only.includes(t.id))
      .map((t) => (fixes?.includes(t.id) ? { ...t, fix: true } : t));
  }, [r.data, only, fixes]);
  const [filters, setFilters] = useState<PickFilters>(NO_PICK_FILTER);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(initial));
  const order = useMemo(() => (tests ? treeOrder(testTree(tests)) : []), [tests]);
  const shown = useMemo(() => (tests ? keepTests(tests, filters) : []), [tests, filters]);
  const tree = useMemo(() => toChecks(flatChain(testTree(shown))), [shown]);
  if (!tests)
    return (
      <Card padded={false}>
        <div aria-busy="true" {...stylex.props(styles.loading)}>
          <Skeleton kind="row" />
          <Skeleton kind="row" />
          <Loading read="tests.list" />
        </div>
      </Card>
    );
  if (!tests.length)
    return (
      <Card padded={false}>
        <EmptyState
          compact
          icon="tests"
          title="No test yet"
          text="A run freezes the project's tests: write some first."
        />
      </Card>
    );
  const pick = (keys: string[], on: boolean) => {
    const next = new Set(picked);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setPicked(next);
    onChange(order.filter((id) => next.has(id)));
  };
  const options = pickOptions(tests, filters);
  const set = (k: keyof PickFilters) => (v: string[]) => setFilters((f) => ({ ...f, [k]: v }));
  const hidden = tests.length - shown.length;
  return (
    <Card padded={false}>
      <div {...stylex.props(styles.tools)}>
        <FilterBar
          label="Filter the tests"
          placeholder="Filter — summary or key"
          words={filters.words}
          onWords={(words) => setFilters((f) => ({ ...f, words }))}
          shown={shown.length}
          total={tests.length}
          onClear={() => setFilters(NO_PICK_FILTER)}
          menus={[
            {
              key: "folder",
              label: "Folder",
              icon: "folder",
              options: options.folders,
              selected: filters.folders,
              onChange: set("folders"),
            },
            {
              key: "labels",
              label: "Labels",
              icon: "tag",
              options: options.labels,
              selected: filters.labels,
              onChange: set("labels"),
            },
            {
              key: "findings",
              label: "Findings",
              options: options.findings,
              selected: filters.findings,
              onChange: set("findings"),
              note: "What its last check found. Ticks add up: a test shows when it has any of them.",
            },
            {
              key: "review",
              label: "Review state",
              options: options.reviews,
              selected: filters.reviews,
              onChange: set("reviews"),
            },
          ]}
        />
      </div>
      <div role="status" {...stylex.props(type.small, styles.count)}>
        <span>
          <span {...stylex.props(type.strong, styles.strong)}>{picked.size} picked</span> of {tests.length}
          {hidden ? ` · ${shown.length} shown` : ""}
        </span>
        <span {...stylex.props(styles.grow)} />
        <Button
          size="sm"
          variant="quiet"
          label={hidden ? `Pick the ${shown.length} shown` : "Pick all"}
          disabled={!shown.length}
          onClick={() =>
            pick(
              shown.map((t) => t.id),
              true,
            )
          }
        />
        <Button
          size="sm"
          variant="quiet"
          label="Pick none"
          disabled={!picked.size}
          onClick={() => pick([...picked], false)}
        />
      </div>
      <div {...stylex.props(styles.scroll)}>
        {tree.length ? (
          <CheckTree label="Tests to run" nodes={tree} picked={picked} onPick={pick} />
        ) : (
          <EmptyState
            compact
            icon="filter"
            title="No test matches these filters"
            actions={<Button size="sm" label="Clear the filters" onClick={() => setFilters(NO_PICK_FILTER)} />}
          />
        )}
      </div>
    </Card>
  );
}
