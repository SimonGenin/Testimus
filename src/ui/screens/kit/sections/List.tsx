import { useState } from "react";
import { Badge, ReviewBadge, SYNC } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List } from "../../../components/ui/List.tsx";
import { Spinner } from "../../../components/ui/Spinner.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const TESTS = [
  {
    key: "LFRPS12-1420",
    title: "Sectionneur sans TK — menu contextuel et propriétés",
    review: "checked",
    sync: "modified",
  },
  { key: "LFRPS12-1421", title: "Sectionneur avec TK — commande à distance", review: "validated", sync: "in-sync" },
  { key: "local", title: "Sectionneur — états ouvert et fermé", review: "to-fix" },
  { key: "LFRPS12-1398", title: "Disjoncteur — ouverture à distance", review: "draft", off: true },
] as const;

const FOLDERS = [
  { id: "repo", title: "Test Repository", depth: 0, count: "645", open: true },
  { id: "traction", title: "Traction", depth: 1, count: "12/212", open: true },
  { id: "sect", title: "Sectionneurs", depth: 2, count: "48", open: false },
  { id: "disj", title: "Disjoncteurs", depth: 2, count: "31", open: false },
  { id: "signal", title: "Signalisation", depth: 1, count: "433", open: false },
];

const JOBS = [
  { id: "gen", icon: <Icon name="check-circle" />, title: "Generate tests · §5.6", trail: "2 min" },
  { id: "index", icon: <Spinner size="sm" />, title: "Index · 2 documents", trail: "40 %" },
  { id: "pull", icon: <Icon name="x-circle" />, title: "Pull LFRPS12-1398", trail: "failed", danger: true },
];

function TestsList() {
  const [selected, setSelected] = useState<string>("LFRPS12-1420");
  return (
    <List
      label="Tests"
      density="two-line"
      items={[...TESTS]}
      getKey={(t) => t.key}
      selected={selected}
      onSelect={setSelected}
      groups={[{ label: "Sectionneurs", meta: "4", keys: TESTS.map((t) => t.key) }]}
      renderItem={(t) => ({
        title: t.title,
        tooltip: t.title,
        meta: (
          <>
            <span>{t.key}</span>
            <ReviewBadge state={t.review} size="sm" />
            {"sync" in t && <Badge {...SYNC[t.sync]} size="sm" />}
          </>
        ),
        disabled: "off" in t,
        debugState: t.key === "LFRPS12-1421" ? "hover" : t.key === "local" ? "focus" : undefined,
        actions:
          t.key === "LFRPS12-1421" ? (
            <Button iconOnly size="xs" variant="quiet" icon="close" label="Delete the local copy" />
          ) : undefined,
      })}
    />
  );
}

function FolderTree() {
  const [open, setOpen] = useState(new Set(FOLDERS.filter((f) => f.open).map((f) => f.id)));
  const [selected, setSelected] = useState("sect");
  const shown = FOLDERS.filter((f, i) => {
    for (let j = i - 1, d = f.depth; j >= 0 && d > 0; j--)
      if (FOLDERS[j].depth < d) {
        if (!open.has(FOLDERS[j].id)) return false;
        d = FOLDERS[j].depth;
      }
    return true;
  });
  return (
    <List
      label="Jira folders"
      tree
      items={shown}
      getKey={(f) => f.id}
      selected={selected}
      onSelect={setSelected}
      onToggle={(id) =>
        setOpen((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      renderItem={(f) => ({
        title: f.title,
        depth: f.depth,
        expanded: open.has(f.id),
        lead: <Icon name={open.has(f.id) ? "folder-open" : "folder"} />,
        trail: f.count,
        debugState: f.id === "disj" ? "hover" : undefined,
        actions:
          f.id === "disj" ? (
            <Button iconOnly size="xs" variant="quiet" icon="download" label="Pull the whole folder" />
          ) : undefined,
      })}
    />
  );
}

export const section: KitSection = {
  name: "List",
  family: "Collections",
  file: "List.tsx",
  summary:
    "Every vertical list of things you pick from: tests, Jira folders, documents, the review queue, jobs, contexts, palette results. One tab stop; the arrows move, Enter or a click picks. Status is a badge in the row, never a coloured row.",
  states: () => (
    <States>
      <Cell label="two-line · group · selected, hover (actions), focus, disabled" wide column>
        <TestsList />
      </Cell>
      <Cell label="tree · Jira folders (→ ← open and close)" column>
        <FolderTree />
      </Cell>
      <Cell label="one-line · divided · selection none" column>
        <List
          label="Jobs"
          divided
          selection="none"
          items={JOBS}
          getKey={(j) => j.id}
          renderItem={(j) => ({ title: j.title, lead: j.icon, trail: j.trail, danger: j.danger })}
        />
      </Cell>
      <Cell label="loading (skeleton rows)" column>
        <List label="Loading tests" items={[]} getKey={String} renderItem={() => ({ title: "" })} loading />
      </Cell>
      <Cell label="empty" column>
        <List
          label="No tests"
          items={[]}
          getKey={String}
          renderItem={() => ({ title: "" })}
          empty={
            <EmptyState
              compact
              icon="tests"
              title="No test yet"
              text="Generate tests from a document, or start one by hand."
              actions={<Button size="sm" icon="plus" label="New test" />}
            />
          }
        />
      </Cell>
      <Cell label="paged · x of y" column>
        <List
          label="Paged"
          items={["LFRPS12-1", "LFRPS12-2"]}
          getKey={(k) => k}
          renderItem={(k) => ({ title: k })}
          total={645}
          onEndReached={() => {}}
        />
      </Cell>
    </States>
  ),
};
