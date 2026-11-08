import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useContext, useId, useMemo, useRef, useState } from "react";
import type { SearchMatch } from "../../../core/types.ts";
import { AppContext, SETUP_FROM_APP } from "../../lib/app.ts";
import type { CommandInfo } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { useSearch } from "../../lib/search.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { List, optionId } from "../ui/List.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { type Tab, Tabs } from "../ui/Tabs.tsx";
import { Text } from "../ui/Text.tsx";
import { type } from "../ui/type.ts";
import { PaletteFoot } from "./PaletteFoot.tsx";
import { entriesOf, filterEntries, type PaletteAction } from "./paletteEntries.tsx";
import { type Group, paletteGroups, type Row, SCOPE_K, type Scope } from "./paletteGroups.tsx";

export type { PaletteAction } from "./paletteEntries.tsx";
export { filterEntries, firstSentence } from "./paletteEntries.tsx";

const styles = stylex.create({
  head: {
    paddingTop: space.s4,
    paddingInline: space.s4,
    paddingBottom: space.s3,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderColor: color.border,
  },
  kinds: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingInline: space.s4,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderColor: color.border,
  },
  note: { paddingTop: space.s3, paddingInline: space.s4 },
  grow: { flex: 1, minWidth: 0 },
  list: { boxSizing: "border-box", maxHeight: "60vh", overflowY: "auto" },
  nothing: { display: "flex", flexDirection: "column", minHeight: `calc(${space.s11} * 4)`, paddingBottom: space.s3 },
  centred: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  loading: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
  enter: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  filters: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    paddingTop: space.s3,
    color: color.textMuted,
  },
});

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
const tidy = (s: string) => s.replace(/\s{2,}/g, " ").trimStart();

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "test", label: "Tests" },
  { id: "document", label: "Documents" },
  { id: "passage", label: "Passages" },
  { id: "commands", label: "Commands" },
];

// ponytail: one box for everything — the project's tests, documents and passages (search.all, words first then
// meaning), the screens, the shell's toggles and every command; a command whose name starts with what is typed
// comes first. Without a project it lists the commands only, and how to open one
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
  const app = useContext(AppContext);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [at, setAt] = useState(0);
  const entries = useMemo(() => entriesOf(actions, commands, onCommand), [actions, commands, onCommand]);
  const noProject = !onHit;
  const q = query.trim();
  const searching = !noProject && scope !== "commands";
  const kinds = scope === "all" || scope === "commands" ? undefined : [scope];
  const s = useSearch(q, { in: kinds, k: scope === "all" ? SCOPE_K.all : SCOPE_K.kind, enabled: searching });
  const result = searching ? s.result : null;
  const rag = useRead("rag.status", {}, { enabled: !noProject });
  const docs = useRead("docs.list", {}, { enabled: !noProject && scope === "document" }).data;
  const allTotals = useRef<{ q: string; totals: Partial<Record<Scope, number>> }>({ q: "", totals: {} });
  if (scope === "all" && result) allTotals.current = { q, totals: result.totals };

  const pickScope = (next: Scope) => {
    setScope(next);
    setAt(0);
  };
  const inputId = `${id}-query`;
  const write = (next: string) => {
    setQuery(next);
    setAt(0);
    document.getElementById(inputId)?.focus();
  };
  const narrow = (key: string) => write(`${query && !/\s$/.test(query) ? `${query} ` : query}${key}`);
  const suggest = searching && result?.suggest && query.endsWith(result.suggest.token) ? result.suggest : null;
  const filters = (result?.filters ?? []).filter(
    (f) => query.includes(f.token) && !(!f.known && f.token === suggest?.token),
  );

  const groups: Group[] = paletteGroups({ q, scope, entries, commands, result, docs, searching, noProject, onHit }).map(
    (g) =>
      g.more
        ? {
            ...g,
            rows: [
              ...g.rows,
              {
                id: `more:${g.more.scope}`,
                stay: true,
                run: () => g.more && pickScope(g.more.scope),
                props: { lead: <Icon name="more" />, title: g.more.label },
              },
            ],
          }
        : g,
  );
  if (suggest) {
    const sg = suggest;
    const head = query.slice(0, query.length - sg.token.length);
    groups.unshift({
      id: "filter",
      title: `Filter by ${sg.key}`,
      rows: sg.values.length
        ? sg.values.map((v) => ({
            id: `filter:${v.value}`,
            stay: true,
            run: () => write(`${head}${sg.key}:${quote(v.value)} `),
            props: {
              lead: <Icon name="filter" />,
              title: `${sg.key}:${v.value}`,
              trail: v.count === undefined ? undefined : plural(v.count, "test"),
            },
          }))
        : [
            {
              id: "filter:none",
              run: () => {},
              off: true,
              props: { lead: <Icon name="filter" />, title: `No ${sg.key} matches “${sg.token}”`, disabled: true },
            },
          ],
    });
  }
  const nothing = !!q && groups.length === 0;
  const words = [...filters.map((f) => f.token), ...(suggest ? [suggest.token] : [])]
    .reduce((rest, token) => rest.replace(token, " "), q)
    .replace(/\s+/g, " ")
    .trim();
  const ask = words && onAsk ? words : "";
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

  const items = groups.flatMap((g) => g.rows);
  const rows = items.filter((r) => !r.off);
  const total = rows.length;
  const cur = Math.min(at, Math.max(0, total - 1));
  const listId = `${id}-list`;
  const pick = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (!r.stay) onClose();
    r.run();
  };

  const kept = allTotals.current.q === q ? allTotals.current.totals : {};
  const counts: Partial<Record<Scope, number>> = q
    ? { ...kept, ...result?.totals, commands: filterEntries(entries, q).length }
    : { test: 0, document: 0, passage: 0 };
  const tabs: Tab<Scope>[] = SCOPES.filter((x) => !noProject || x.id === "all" || x.id === "commands").map((x) => {
    const n = counts[x.id];
    const known = !q || !!result || x.id === "commands" || n !== undefined;
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

  const status = rag.data;
  // ponytail: while an index run builds the vectors, search answers on words and says nothing of it
  const building = !!status?.indexing;
  const wordsOnly =
    result?.meaning === "unavailable" ||
    (!!status && !building && !!status.degraded && (status.activation === "none" || status.chunks > 0));
  const noPack = status?.activation === "none";
  const openSearchSettings = () => {
    onClose();
    app?.navigate("settings", "search");
  };
  const current = rows[cur]?.id;
  const waiting = searching && !!q && s.loading && !result;
  const list = (
    <List
      label="Results"
      items={items}
      getKey={(r: Row) => r.id}
      renderItem={(r) =>
        r.id === current
          ? {
              ...r.props,
              trail: (
                <span {...stylex.props(styles.enter)}>
                  {r.props.trail}
                  <Kbd>Enter</Kbd>
                </span>
              ),
            }
          : r.props
      }
      selected={current ?? null}
      onSelect={(k) => pick(rows.findIndex((r) => r.id === k))}
      groups={groups.map((g) => ({
        label: g.title || "Claude",
        head: !!g.title,
        meta: g.meta,
        keys: g.rows.map((r) => r.id),
      }))}
      activeDescendant={{
        id: listId,
        onActive: (k) =>
          setAt(
            Math.max(
              0,
              rows.findIndex((r) => r.id === k),
            ),
          ),
      }}
    />
  );
  return (
    <Modal title="Search everything" frameless size="palette" onClose={onClose}>
      <div {...stylex.props(styles.head)}>
        <Text
          value={query}
          onChange={(v) => {
            setQuery(v);
            setAt(0);
          }}
          ariaLabel="Search"
          id={inputId}
          icon="search"
          placeholder={noProject ? "Run a command" : "Search tests, documents, passages — or run a command"}
          autoFocus
          spellCheck={false}
          combobox={{
            expanded: true,
            controls: listId,
            activeDescendant: total ? optionId(listId, rows[cur].id) : undefined,
          }}
          onKeyDown={onKeyDown}
          trailing={
            searching && q && s.loading ? (
              <Spinner size="sm" label="Searching" />
            ) : query ? (
              <Button
                variant="quiet"
                size="xs"
                iconOnly
                icon="close"
                label="Clear"
                onClick={() => {
                  setQuery("");
                  setAt(0);
                }}
              />
            ) : (
              <Kbd>Ctrl K</Kbd>
            )
          }
        />
        {filters.length > 0 && (
          <div {...stylex.props(type.small, styles.filters)}>
            Only
            {filters.map((f) => (
              <Chip
                key={f.token}
                label={f.known ? `${f.key}: ${f.value}` : `${f.key}: ${f.value} — not a ${f.key} value, left out`}
                tone={f.known ? "neutral" : "warning"}
                mono
                onRemove={() => write(tidy(query.replace(f.token, "")))}
                removeLabel={`Remove the filter ${f.token}`}
              />
            ))}
          </div>
        )}
      </div>
      {!noProject && (
        <div {...stylex.props(styles.kinds)}>
          <span {...stylex.props(styles.grow)}>
            <Tabs label="Search in" size="sm" value={scope} tabs={tabs} onChange={pickScope} />
          </span>
          {searching && q && s.loading ? (
            <Badge label="Searching…" tone="info" icon="sync" size="sm" tooltip="How passages are found" />
          ) : building && !wordsOnly ? (
            <Badge label="Indexing…" tone="info" busy size="sm" tooltip="How passages are found" />
          ) : wordsOnly ? (
            <Badge
              label="Words only"
              tone="warning"
              icon="alert-triangle"
              size="sm"
              tooltip={result?.notes.join(" ") || status?.degraded || undefined}
            />
          ) : (
            <Badge label="Words + meaning" icon="search" size="sm" tooltip="How passages are found" />
          )}
        </div>
      )}
      {noProject && (
        <div {...stylex.props(styles.note)}>
          <Banner
            tone="neutral"
            compact
            actions={
              app && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="folder-open"
                  label="Open a project…"
                  onClick={() => {
                    onClose();
                    app.navigate("setup", SETUP_FROM_APP);
                  }}
                />
              )
            }
          >
            No project is open: only commands are listed. Open a project to search its tests and documents.
          </Banner>
        </div>
      )}
      {!noProject && wordsOnly && q && (
        <div {...stylex.props(styles.note)}>
          <Banner
            tone="info"
            compact
            title="Search on words only"
            actions={
              <Button
                size="sm"
                label={noPack ? "Choose a search pack" : "Open Settings › Search"}
                onClick={openSearchSettings}
              />
            }
          >
            {noPack
              ? "No search pack is installed on this PC, so passages are found by their words, not their meaning."
              : "The passages have no vectors for this PC's search pack yet, so they are found by their words. Settings › Search builds them."}
          </Banner>
        </div>
      )}
      {waiting ? (
        <div {...stylex.props(styles.loading)} aria-busy="true">
          <Skeleton kind="row" />
          <Skeleton kind="row" />
          <Skeleton kind="row" />
          <Loading read="search.all" />
        </div>
      ) : (
        <div {...stylex.props(styles.list, (nothing || !items.length) && styles.nothing)}>
          {(nothing || !items.length) && (
            <div {...stylex.props(styles.centred)}>
              <EmptyState
                icon="search"
                title={q ? `Nothing matches “${q}”` : "Type to search."}
                text={
                  q
                    ? "No test, document, passage or command has these words, and nothing close in meaning was found. Try fewer words, or ask Claude to look through the documents."
                    : undefined
                }
              />
            </div>
          )}
          {items.length > 0 && list}
        </div>
      )}
      <PaletteFoot
        mode={noProject ? "none" : scope === "commands" ? "commands" : "search"}
        result={q ? result : null}
        searchingDeep={s.loading && !!result}
        onNarrow={narrow}
      />
    </Modal>
  );
}
