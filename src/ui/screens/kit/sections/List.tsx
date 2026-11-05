import { useId, useState } from "react";
import { Badge, ReviewBadge, SYNC } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List, optionId } from "../../../components/ui/List.tsx";
import { Spinner } from "../../../components/ui/Spinner.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const TESTS = [
  {
    key: "LFRPS12-1420",
    title: "Sectionneur sans TK — menu contextuel et propriétés",
    review: "draft",
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

const RESULTS = [
  { id: "go:tests", group: "Go to", title: "Tests", lead: <Icon name="tests" /> },
  { id: "go:docs", group: "Go to", title: "Documents", lead: <Icon name="documents" /> },
  { id: "test:LFRPS12-1420", group: "Tests", title: "Sectionneur sans TK", lead: <Icon name="tests" /> },
  { id: "ask", group: "", title: "Ask Claude: “sectionneur”", lead: <Icon name="claude" /> },
];

function DrivenList() {
  const id = useId();
  const [active, setActive] = useState(RESULTS[2].id);
  const move = (by: number) => {
    const i = RESULTS.findIndex((r) => r.id === active);
    setActive(RESULTS[Math.min(RESULTS.length - 1, Math.max(0, i + by))].id);
  };
  return (
    <>
      <Text
        value="sectionneur"
        onChange={() => {}}
        ariaLabel="Search"
        icon="search"
        combobox={{ expanded: true, controls: id, activeDescendant: optionId(id, active) }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            move(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      />
      <List
        label="Results"
        items={RESULTS}
        getKey={(r) => r.id}
        renderItem={(r) => ({ title: r.title, lead: r.lead })}
        selected={active}
        onSelect={setActive}
        activeDescendant={{ id, onActive: setActive }}
        groups={[
          { label: "Go to", keys: ["go:tests", "go:docs"] },
          {
            label: "Tests",
            meta: "9",
            keys: ["test:LFRPS12-1420"],
            action: <Button variant="quiet" size="xs" label="All 9 tests" />,
          },
          { label: "Claude", head: false, keys: ["ask"] },
        ]}
      />
    </>
  );
}

export const section: KitSection = {
  name: "List",
  family: "Collections",
  file: "List.tsx",
  summary:
    "Every vertical list of things you pick from: tests, Jira folders, documents, the review queue, jobs, contexts, palette results. One tab stop; the arrows move, Enter or a click picks — or, driven by a field (activeDescendant), the focus stays in the field and the list follows it. Status is a badge in the row, never a coloured row.",
  guidelines: [
    {
      head: "Anatomy of an item",
      text: "Optional indent and twisty (tree) · lead (icon, status icon, checkbox) · body: title line (with inline badges) and an optional meta line (mono key, folder, time) · actions shown on hover or focus (icon buttons, `xs`) · trail (count, time, chevron).",
    },
    {
      head: "Options",
      text: "`one-line` 36 px · `two-line` 56 px · `tree` (indent 16 px per level, twisty) · `divided` (full-width rows with a hairline, for tables of jobs and settings) · group heads (sticky caption with a count) · a « x of y » head and an « all N loaded » foot for paged lists.",
    },
    {
      head: "States",
      text: "default · hover · selected (`color-surface-selected` + medium title; the list keeps one) · focus (inset ring; arrow keys move it, Enter opens) · disabled · danger (a destructive row, e.g. a failed job is not this: it uses a badge) · loading (skeleton rows, never stale rows) · empty (an Empty state inside the list's frame).",
    },
    {
      head: "Rules",
      text: "Status is a badge (icon + word) in the title or meta line, never a coloured row or a coloured left edge. Row actions never move the layout (they replace the trail). Long titles end with an ellipsis; the full title is the tooltip. A list never paginates with buttons: it loads the next slice near the end.",
    },
  ],
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
      <Cell
        label="activeDescendant · the focus stays in the field (the palette) · group action · group without a head"
        wide
        column
      >
        <DrivenList />
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
