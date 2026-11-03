import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import type { SearchKind, SearchMatch } from "../../../core/types.ts";
import type { CommandInfo } from "../../lib/data/client.ts";
import { plural } from "../../lib/format.ts";
import { recentHits, useSearch } from "../../lib/search.ts";
import { border, color, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ListItem, type ListItemProps } from "../ui/ListItem.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { type Tab, Tabs } from "../ui/Tabs.tsx";
import { Text } from "../ui/Text.tsx";
import { PaletteFoot } from "./PaletteFoot.tsx";
import { type Entry, entriesOf, filterEntries, type PaletteAction } from "./paletteEntries.tsx";
import { hitRow, KIND } from "./SearchHit.tsx";

export type { PaletteAction } from "./paletteEntries.tsx";
export { filterEntries, firstSentence } from "./paletteEntries.tsx";

type Scope = "all" | SearchKind | "commands";
type Row = { id: string; run: () => void; props: ListItemProps };
type Group = { id: string; title: string; meta?: string; more?: { label: string; scope: Scope }; rows: Row[] };

const PER_GROUP = 6;
const PER_SCOPE = 40;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const styles = stylex.create({
  head: { padding: space.s3, borderBottomWidth: border.width, borderBottomStyle: "solid", borderColor: color.border },
  kinds: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingInline: space.s4,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderColor: color.border,
  },
  grow: { flex: 1, minWidth: 0 },
  list: { margin: 0, padding: space.s2, listStyle: "none", maxHeight: "60vh", overflowY: "auto" },
  group: { margin: 0, padding: 0, listStyle: "none" },
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    color: color.textMuted,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.semibold,
  },
  groupMeta: { marginInlineStart: "auto", color: color.textSubtle, fontWeight: fontWeight.regular },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
  clear: { display: "inline-flex", alignItems: "center", minHeight: size.controlSm },
});

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "test", label: "Tests" },
  { id: "document", label: "Documents" },
  { id: "passage", label: "Passages" },
  { id: "commands", label: "Commands" },
];

// ponytail: one box for everything — the project's tests, documents and passages (search.all, words first then
// meaning), the screens, the shell's toggles and every command; a command whose name starts with what is typed
// comes first
export function Palette({
  commands,
  actions,
  onCommand,
  onHit,
  onAsk,
  onClose,
}: {
  commands: CommandInfo[];
  actions: PaletteAction[];
  onCommand: (c: CommandInfo) => void;
  onHit?: (hit: SearchMatch) => void;
  onAsk?: (question: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [at, setAt] = useState(0);
  const entries = useMemo(() => entriesOf(actions, commands, onCommand), [actions, commands, onCommand]);
  const q = query.trim();
  const searching = !!onHit && scope !== "commands";
  const kinds = scope === "all" || scope === "commands" ? undefined : [scope];
  const s = useSearch(q, { in: kinds, k: scope === "all" ? PER_GROUP : PER_SCOPE, enabled: searching });
  const result = searching ? s.result : null;

  const pickScope = (next: Scope) => {
    setScope(next);
    setAt(0);
  };
  const entryRow = (e: Entry): Row => ({ id: `cmd:${e.id}`, run: e.run, props: e.row });
  const hitOf = (h: SearchMatch): Row => ({ id: `${h.kind}:${h.id}`, run: () => onHit?.(h), props: hitRow(h) });

  const groups: Group[] = [];
  const matched = scope === "all" || scope === "commands" ? filterEntries(entries, q) : [];
  const strong = !!q && matched.some((e) => fold(e.label).startsWith(fold(q)) || e.id === q);
  const entryGroups = (cap: number) => {
    for (const g of ["Go to", "App", "Commands"] as const) {
      const rows = matched.filter((e) => e.group === g).slice(0, cap);
      if (rows.length)
        groups.push({
          id: g,
          title: g,
          meta: g === "Commands" && !q ? "every command of the app" : undefined,
          rows: rows.map(entryRow),
        });
    }
  };
  if (!q) {
    const recent = searching ? recentHits() : [];
    if (recent.length) groups.push({ id: "recent", title: "Recent", rows: recent.map(hitOf) });
    entryGroups(60);
  } else {
    if (strong || scope === "commands") entryGroups(scope === "commands" ? 60 : PER_GROUP);
    for (const kind of result?.order ?? []) {
      const hits = result?.hits.filter((h) => h.kind === kind) ?? [];
      if (!hits.length) continue;
      const total = result?.totals[kind] ?? hits.length;
      groups.push({
        id: kind,
        title: KIND[kind].label,
        meta: String(total),
        more:
          scope === "all" && total > hits.length
            ? { label: `All ${plural(total, KIND[kind].one)}`, scope: kind }
            : undefined,
        rows: hits.map(hitOf),
      });
    }
    if (!strong && scope === "all") entryGroups(5);
  }
  const ask = q && onAsk ? q : "";
  if (ask)
    groups.push({
      id: "ask",
      title: "",
      rows: [
        {
          id: "ask",
          run: () => onAsk?.(ask),
          props: { lead: <Icon name="claude" />, title: `Ask Claude: “${ask}”`, trail: "in the dock" },
        },
      ],
    });

  const rows = groups.flatMap((g) => g.rows);
  const total = rows.length;
  const cur = Math.min(at, Math.max(0, total - 1));
  const optionId = (i: number) => `${id}-o${i}`;
  const pick = (i: number) => {
    const r = rows[i];
    if (!r) return;
    onClose();
    r.run();
  };

  const counts: Partial<Record<Scope, number>> = q
    ? { ...result?.totals, commands: filterEntries(entries, q).length }
    : { test: 0, document: 0, passage: 0 };
  const tabs: Tab<Scope>[] = SCOPES.filter((x) => onHit || x.id === "all" || x.id === "commands").map((x) => {
    const n = counts[x.id];
    const known = !q || !!result || x.id === "commands";
    return {
      value: x.id,
      label: x.label,
      count: x.id === "all" || (!q && x.id === "commands") ? undefined : (n ?? (known ? 0 : undefined)),
      disabled: x.id !== "all" && x.id !== scope && known && n === 0,
    };
  });
  const cycle = (dir: 1 | -1) => {
    const open = tabs.filter((t) => !t.disabled);
    const i = open.findIndex((t) => t.value === scope);
    pickScope(open[(i + dir + open.length) % open.length].value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt(Math.min(cur + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt(Math.max(cur - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (total) pick(cur);
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      cycle(e.shiftKey ? -1 : 1);
    }
  };

  const waiting = searching && !!q && s.loading && !result;
  let n = -1;
  return (
    <Modal title="Search everywhere" frameless size="lg" onClose={onClose}>
      <div {...stylex.props(styles.head)}>
        <Text
          value={query}
          onChange={(v) => {
            setQuery(v);
            setAt(0);
          }}
          ariaLabel="Search"
          icon="search"
          placeholder={onHit ? "Search tests, documents, passages — or run a command" : "Run a command"}
          autoFocus
          spellCheck={false}
          combobox={{ expanded: true, controls: `${id}-list`, activeDescendant: total ? optionId(cur) : undefined }}
          onKeyDown={onKeyDown}
          trailing={
            searching && q && s.loading ? (
              <Spinner size="sm" label="Searching" />
            ) : query ? (
              <span {...stylex.props(styles.clear)}>
                <Button variant="quiet" size="xs" iconOnly icon="close" label="Clear" onClick={() => setQuery("")} />
              </span>
            ) : undefined
          }
        />
      </div>
      {onHit && (
        <div {...stylex.props(styles.kinds)}>
          <span {...stylex.props(styles.grow)}>
            <Tabs label="Search in" size="sm" value={scope} tabs={tabs} onChange={pickScope} />
          </span>
          {q && result?.meaning === "on" && s.deep && <Badge label="Words + meaning" icon="search" size="sm" />}
          {q && result?.meaning === "unavailable" && (
            <Badge label="Words only" size="sm" tooltip={result.notes.join(" ") || undefined} />
          )}
        </div>
      )}
      {waiting ? (
        <div {...stylex.props(styles.loading)} aria-busy="true">
          <Skeleton kind="row" />
          <Skeleton kind="row" />
          <Skeleton kind="row" />
        </div>
      ) : total ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Results" {...stylex.props(styles.list)}>
          {groups.map((g) => (
            <li key={g.id} role="presentation">
              {g.title && (
                <div {...stylex.props(styles.groupHead)}>
                  <span>{g.title}</span>
                  {g.more && (
                    <Button
                      variant="quiet"
                      size="xs"
                      label={g.more.label}
                      onClick={() => g.more && pickScope(g.more.scope)}
                    />
                  )}
                  {g.meta && <span {...stylex.props(styles.groupMeta)}>{g.meta}</span>}
                </div>
              )}
              <ul role="group" aria-label={g.title || "Claude"} {...stylex.props(styles.group)}>
                {g.rows.map((r) => {
                  n++;
                  const i = n;
                  return (
                    <ListItem
                      key={r.id}
                      {...r.props}
                      role="option"
                      selected={i === cur}
                      onActivate={() => pick(i)}
                      ref={(el) => {
                        if (!el) return;
                        el.id = optionId(i);
                        if (i === cur) el.scrollIntoView?.({ block: "nearest" });
                      }}
                    />
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon="search"
          title={q ? `Nothing matches “${q}”.` : "Type to search."}
          text={q ? "Try fewer words, a key (LFRPS12-1420), or another kind." : undefined}
        />
      )}
      {onHit && <PaletteFoot result={q ? result : null} searchingDeep={s.loading && !!result} />}
    </Modal>
  );
}
