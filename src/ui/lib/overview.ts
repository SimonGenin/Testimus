import type { CommandOutput } from "../../core/commands/index.ts";

export type OverviewShown = CommandOutput<"docs.overviewShow">;

// ponytail: How the documents fit together is reached as a document of the list — by a name no document id can take
export const OVERVIEW_ROUTE = "~overview";
export const OVERVIEW_TITLE = "How the documents fit together";

const names = (list: string[]) => {
  const shown = list.slice(0, 3).map((t) => `« ${t} »`);
  const more = list.length - shown.length;
  return `${shown.join(", ")}${more ? ` and ${more} more` : ""}`;
};

const part = (verb: string, list: string[], first: boolean) =>
  list.length ? `${verb} ${list.length}${first ? ` section${list.length === 1 ? "" : "s"}` : ""} (${names(list)})` : "";

// ponytail: what the last update did, in one sentence — the sections it changed, added and removed by their titles
export function changesLine(c: OverviewShown["changed"]): string {
  const parts = [
    ["changed", c.modified],
    ["added", c.added],
    ["removed", c.removed],
  ] as const;
  const said = parts.filter(([, l]) => l.length).map(([verb, l], i) => part(verb, [...l], i === 0));
  if (!said.length) return "Last update changed no section.";
  const list = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}` : said[0];
  return `Last update ${list}. The rest was kept as it was.`;
}

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

// ponytail: the line under the title — whose file it is and when Claude last wrote it, after what
export function updatedLine(o: Pick<OverviewShown, "updatedAt" | "updatedAfter">): string {
  if (!o.updatedAt) return "written by Claude, yours to edit";
  const after = o.updatedAfter ? `, after « ${o.updatedAfter} »` : "";
  return `written by Claude, yours to edit · last updated ${when(o.updatedAt)}${after}`;
}

const AFTER: Record<NonNullable<OverviewShown["kind"]>, string> = {
  import: "updated after the last import",
  conversion: "updated after the last conversion",
  removal: "updated after a removal",
  rewrite: "rewritten from scratch",
  first: "written after an import",
};

// ponytail: the list row's second line — short: the head of the pane says the rest
export function overviewMeta(o: OverviewShown): string {
  if (!o.enabled) return o.exists ? "Off · not updated after imports" : "Off · Claude can write it";
  if (!o.exists) return "Not written yet";
  if (o.pending.length) return `${o.pending.length} document${o.pending.length === 1 ? "" : "s"} changed since`;
  if (!o.updatedAfter) return "written by hand";
  return o.kind ? AFTER[o.kind] : "updated";
}
