import { type ReactNode, useMemo, useState } from "react";
import type { SearchKind, SearchMatch } from "../../../core/types.ts";
import { type CommandInfo, call } from "../../api.ts";
import { cx, plural } from "../../lib/format.ts";
import { recentHits, useSearch } from "../../lib/search.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Icon, type IconName, Kbd } from "../legacy/index.ts";
import { KIND, SearchHit } from "./SearchHit.tsx";

export type PaletteAction = { id: string; label: string; icon?: IconName; hint?: string; run: () => void };

type Entry = { id: string; label: string; icon: IconName; hint?: string; text: string; run: () => void };

const GROUP_ICON: Record<string, IconName> = {
  docs: "documents",
  rag: "search",
  search: "search",
  chat: "claude",
  claude: "claude",
  tests: "tests",
  images: "image",
  gen: "generate",
  check: "review",
  review: "review",
  xray: "push",
  jobs: "jobs",
  system: "settings",
  project: "folder",
};

export const firstSentence = (s: string) => s.split(/(?<=[.:])\s|\s\(/)[0].replace(/[.:]$/, "");

export function filterEntries<T extends { text: string }>(entries: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => words.every((w) => e.text.includes(w)));
}

type Scope = "all" | SearchKind | "commands";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "test", label: "Tests" },
  { id: "document", label: "Documents" },
  { id: "passage", label: "Passages" },
  { id: "commands", label: "Commands" },
];

type Row = { id: string; label: string; run: () => void; node: ReactNode };
type Group = { id: string; title: string; more?: ReactNode; rows: Row[] };

const PER_GROUP = 6;
const PER_SCOPE = 40;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// ponytail: one box for everything — the project's tests, documents and passages (search.all, words
// first then meaning), the commands and the screens; a command whose name starts with what is typed comes first
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
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [at, setAt] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const entries = useMemo<Entry[]>(
    () => [
      ...actions.map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon ?? "right",
        hint: a.hint,
        text: `${a.label} ${a.hint ?? ""}`.toLowerCase(),
        run: a.run,
      })),
      ...commands.map((c) => ({
        id: c.name,
        label: firstSentence(c.summary) || c.name,
        icon: GROUP_ICON[c.name.split(".")[0]] ?? "right",
        hint: c.name.replace(".", " "),
        text: `${c.name} ${c.name.replace(".", " ")} ${c.summary}`.toLowerCase(),
        run: () => onCommand(c),
      })),
    ],
    [actions, commands, onCommand],
  );
  const q = query.trim();
  const searching = !!onHit && scope !== "commands";
  const kinds = scope === "all" || scope === "commands" ? undefined : [scope];
  const s = useSearch(q, { in: kinds, k: scope === "all" ? PER_GROUP : PER_SCOPE, enabled: searching });
  const result = searching ? s.result : null;

  const pickScope = (next: Scope) => {
    setScope(next);
    setAt(0);
  };
  const entryRow = (e: Entry): Row => ({
    id: `cmd:${e.id}`,
    label: e.label,
    run: e.run,
    node: (
      <>
        <Icon name={e.icon} />
        <span className="pal-label">{e.label}</span>
        {e.hint && <span className="mono muted">{e.hint}</span>}
      </>
    ),
  });
  const hitRow = (h: SearchMatch): Row => ({
    id: `${h.kind}:${h.id}`,
    label: h.title,
    run: () => onHit?.(h),
    node: (
      <>
        <Icon name={KIND[h.kind].icon} />
        <SearchHit hit={h} />
      </>
    ),
  });

  const groups: Group[] = [];
  const matched = scope === "all" || scope === "commands" ? filterEntries(entries, q) : [];
  const strong = !!q && matched.some((e) => fold(e.label).startsWith(fold(q)) || e.id === q);
  const commandGroup = (cap: number) => {
    if (matched.length) groups.push({ id: "commands", title: "Commands", rows: matched.slice(0, cap).map(entryRow) });
  };
  if (!q) {
    const recent = searching ? recentHits() : [];
    if (recent.length) groups.push({ id: "recent", title: "Recent", rows: recent.map(hitRow) });
    commandGroup(60);
  } else {
    if (strong || scope === "commands") commandGroup(scope === "commands" ? 60 : PER_GROUP);
    for (const kind of result?.order ?? []) {
      const hits = result?.hits.filter((h) => h.kind === kind) ?? [];
      if (!hits.length) continue;
      const total = result?.totals[kind] ?? hits.length;
      groups.push({
        id: kind,
        title: KIND[kind].label,
        more:
          scope === "all" && total > hits.length ? (
            <button type="button" className="pal-more" onClick={() => pickScope(kind)}>
              All {plural(total, KIND[kind].one)}
            </button>
          ) : null,
        rows: hits.map(hitRow),
      });
    }
    if (!strong && scope === "all") commandGroup(5);
  }
  const ask = q && onAsk ? q : "";
  if (ask)
    groups.push({
      id: "ask",
      title: "",
      rows: [
        {
          id: "ask",
          label: `Ask Claude: “${ask}”`,
          run: () => onAsk?.(ask),
          node: (
            <>
              <Icon name="claude" />
              <span className="pal-label">Ask Claude: “{ask}”</span>
              <span className="mono muted">Claude</span>
            </>
          ),
        },
      ],
    });

  const rows = groups.flatMap((g) => g.rows);
  const total = rows.length;
  const cur = Math.min(at, Math.max(0, total - 1));
  const keepInView = (el: HTMLDivElement | null) => el?.scrollIntoView?.({ block: "nearest" });
  const pick = (i: number) => {
    const r = rows[i];
    if (!r) return;
    onClose();
    r.run();
  };
  const cycle = (dir: 1 | -1) => {
    const list = onHit ? SCOPES : SCOPES.filter((x) => x.id === "all" || x.id === "commands");
    const i = list.findIndex((x) => x.id === scope);
    pickScope(list[(i + dir + list.length) % list.length].id);
  };
  const index = async () => {
    setIndexing(true);
    try {
      await call("search.index", {});
      toast({ kind: "ok", title: "Indexing the tests by meaning", detail: "Follow it in Jobs." });
    } catch (e) {
      errorToast(e, "Could not index the tests");
    }
  };

  let n = -1;
  return (
    <div className="overlay overlay-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette card" role="dialog" aria-modal="true" aria-label="Search everywhere">
        <div className="palette-search">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="Search"
            placeholder={onHit ? "Search tests, documents, passages — or run a command" : "Run a command"}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt(Math.min(cur + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt(Math.max(cur - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (total) pick(cur);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "Tab") {
                e.preventDefault();
                cycle(e.shiftKey ? -1 : 1);
              }
            }}
          />
          {s.loading && searching && <span className="spin spin-sm" role="status" aria-label="Searching" />}
        </div>
        {onHit && (
          <div className="pal-scopes" role="tablist" aria-label="Search in">
            {SCOPES.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={scope === x.id}
                className={cx("pal-scope", scope === x.id && "is-on")}
                tabIndex={-1}
                onClick={() => pickScope(x.id)}
              >
                {x.label}
                {scope === "all" && x.id !== "all" && x.id !== "commands" && result?.totals[x.id] ? (
                  <span className="pal-count">{result.totals[x.id]}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <div className="palette-list" id="palette-list" role="listbox" aria-label="Results">
          {groups.map((g) => (
            <div key={g.id}>
              {g.title && (
                <div className="pal-group">
                  <span>{g.title}</span>
                  {g.more}
                </div>
              )}
              {g.rows.map((r) => {
                n++;
                const i = n;
                return (
                  <div
                    key={r.id}
                    className={cx("pal", i === cur && "pal-on")}
                    role="option"
                    aria-selected={i === cur}
                    ref={i === cur ? keepInView : undefined}
                    tabIndex={-1}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => pick(i)}
                  >
                    {r.node}
                    {i === cur && <Kbd>Enter</Kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {!total && (
            <p className="muted palette-empty">
              {q && s.loading ? "Searching…" : q ? `Nothing matches “${q}”.` : "Type to search."}
            </p>
          )}
        </div>
        {onHit && (
          <div className="pal-foot">
            <span className="pal-tips">
              <Kbd>Tab</Kbd> scope · <code>"exact"</code> <code>-word</code> <code>review:to-fix</code>{" "}
              <code>label:</code> <code>folder:</code> <code>in:reqs</code>
            </span>
            <span className="spacer" />
            {result?.meaning === "unavailable" ? (
              <span className="muted" title={result.notes.join(" ")}>
                Words only
              </span>
            ) : result?.unembedded ? (
              <button type="button" className="pal-more" disabled={indexing} onClick={() => void index()}>
                {plural(result.unembedded, "test")} not searchable by meaning yet · Index
              </button>
            ) : s.loading && result ? (
              <span className="muted">Searching by meaning…</span>
            ) : s.deep && result?.meaning === "on" ? (
              <span className="muted">Words + meaning</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
