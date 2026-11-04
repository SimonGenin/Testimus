import type { DocJson, SearchKind, SearchMatch, SearchResult } from "../../../core/types.ts";
import type { CommandInfo } from "../../lib/data/client.ts";
import { plural } from "../../lib/format.ts";
import { recentHits } from "../../lib/search.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import { type Entry, featuredFirst, filterEntries } from "./paletteEntries.tsx";
import { hitRow, KIND } from "./SearchHit.tsx";

export type Scope = "all" | SearchKind | "commands";
export type Row = { id: string; run: () => void; props: ListItemProps; off?: boolean; stay?: boolean };
export type Group = { id: string; title: string; meta?: string; more?: { label: string; scope: Scope }; rows: Row[] };

const PER_GROUP = 6;
// ponytail: with no project open, the ways to get one — named as the person would ask, in this order
const PROJECT: Record<string, { label: string; icon: IconName }> = {
  "project.open": { label: "Open a folder as a project…", icon: "folder-open" },
  "project.openKey": { label: "Open a project by its Jira key", icon: "key" },
  "project.init": { label: "Create a project…", icon: "plus" },
};
const PROJECT_COMMANDS = Object.keys(PROJECT);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const SCOPE_K = { all: PER_GROUP, kind: 40 };

const docMeta = (d: DocJson) =>
  [
    d.version && `version ${d.version}`,
    d.status && d.status[0].toUpperCase() + d.status.slice(1),
    d.converted?.stats && plural(d.converted.stats.sections, "section"),
    d.converted?.stats && plural(d.converted.stats.figures, "figure"),
  ]
    .filter(Boolean)
    .join(" · ");

// ponytail: what the palette lists, in its groups — without a project its own « Project » group first (open a folder,
// by its key, create one); without a query the recent hits, the screens, the toggles and the commands, the useful
// ones first; with one, the commands when they are what was meant, then each kind found (« All N » to its tab), the
// documents that do not match greyed in the Documents tab, then the rest of the commands
export function paletteGroups({
  q,
  scope,
  entries,
  commands,
  result,
  docs,
  searching,
  noProject,
  onHit,
}: {
  q: string;
  scope: Scope;
  entries: Entry[];
  commands: CommandInfo[];
  result: SearchResult | null;
  docs: DocJson[] | undefined;
  searching: boolean;
  noProject: boolean;
  onHit?: (hit: SearchMatch) => void;
}): Group[] {
  const groups: Group[] = [];
  const entryRow = (e: Entry): Row => ({ id: `cmd:${e.id}`, run: e.run, props: e.row });
  const hitOf = (h: SearchMatch): Row => {
    const doc = h.kind === "document" ? docs?.find((d) => d.id === h.id) : undefined;
    const props = hitRow(h);
    return {
      id: `${h.kind}:${h.id}`,
      run: () => onHit?.(h),
      props: doc ? { ...props, meta: `${h.id} · ${docMeta(doc)}` } : props,
    };
  };
  const projectIds = noProject ? PROJECT_COMMANDS.filter((n) => commands.some((c) => c.name === n)) : [];
  const matched = (scope === "all" || scope === "commands" ? filterEntries(entries, q) : []).filter(
    (e) => !projectIds.includes(e.id),
  );
  const strong = !!q && matched.some((e) => fold(e.label).startsWith(fold(q)) || e.id === q);
  const entryGroups = (cap: number) => {
    for (const g of ["Go to", "App", "Commands"] as const) {
      const all = matched.filter((e) => e.group === g);
      const rows = (g === "Commands" && !q ? featuredFirst(all) : all).slice(0, cap);
      if (rows.length)
        groups.push({
          id: g,
          title: g,
          meta: g === "Commands" ? (q ? String(all.length) : "every command of the app") : undefined,
          rows: rows.map(entryRow),
        });
    }
  };
  if (projectIds.length) {
    const own = filterEntries(
      projectIds.flatMap((id) => entries.filter((e) => e.id === id)),
      q,
    ).map((e) => ({
      ...e,
      row: { ...e.row, title: PROJECT[e.id].label, lead: <Icon name={PROJECT[e.id].icon} /> },
    }));
    if (own.length) groups.push({ id: "project", title: "Project", rows: own.map(entryRow) });
  }
  if (!q) {
    const recent = searching ? recentHits() : [];
    if (recent.length) groups.push({ id: "recent", title: "Recent", rows: recent.map(hitOf) });
    entryGroups(scope === "commands" ? 200 : 60);
  } else {
    if (strong || scope === "commands") entryGroups(scope === "commands" ? 200 : PER_GROUP);
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
            ? { label: plural(total - hits.length, `more ${KIND[kind].one}`), scope: kind }
            : undefined,
        rows: hits.map(hitOf),
      });
    }
    if (scope === "document" && result && docs) {
      const found = new Set(result.hits.filter((h) => h.kind === "document").map((h) => h.id));
      const rest = docs.filter((d) => !found.has(d.id));
      if (rest.length)
        groups.push({
          id: "not-matching",
          title: "Not matching",
          meta: String(rest.length),
          rows: rest.map((d) => ({
            id: `nomatch:${d.id}`,
            run: () => {},
            off: true,
            props: {
              lead: <Icon name="file" />,
              title: d.title || d.id,
              meta: `${d.id} · ${docMeta(d)}`,
              disabled: true,
            },
          })),
        });
    }
    if (!strong && scope === "all") entryGroups(5);
  }
  return groups;
}
