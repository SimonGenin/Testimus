import type { LocalTestRef } from "../../../../core/types.ts";

// ponytail: the list's « Assignee » filter is words of the filter box (assignee:me, assignee:none,
// assignee:"Camille Martin") — the control ticks and unticks them, the box shows them, search.all reads them

const TOKEN = /(^|\s)-?assignee:(?:"([^"]*)"|(\S+))/gi;

const typed = (who: string) => (/\s/.test(who) ? `"${who}"` : who);
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

/** the people the filter keeps (me, none, or names), as typed */
export function assigneesIn(filter: string): string[] {
  return [...filter.matchAll(TOKEN)].map((m) => m[2] ?? m[3] ?? "");
}

/** the filter with that person ticked or unticked */
export function toggleAssignee(filter: string, who: string): string {
  const on = assigneesIn(filter).some((x) => same(x, who));
  if (on)
    return filter
      .replace(TOKEN, (all, lead: string, quoted?: string, bare?: string) =>
        same(quoted ?? bare ?? "", who) ? lead : all,
      )
      .replace(/\s{2,}/g, " ")
      .trim();
  return `${filter.trim()} assignee:${typed(who)}`.trim();
}

export type Assignees = { people: { name: string; id?: string; count: number }[]; unassigned: number };

/** who the local tests are assigned to, with how many each, most first (a test never pushed has nobody) */
export function assigneesOf(refs: LocalTestRef[]): Assignees {
  const by = new Map<string, { name: string; id?: string; count: number }>();
  let unassigned = 0;
  for (const r of refs) {
    if (!r.assignee) {
      unassigned++;
      continue;
    }
    const k = r.assigneeId ?? r.assignee;
    const cur = by.get(k) ?? { name: r.assignee, id: r.assigneeId, count: 0 };
    cur.count++;
    by.set(k, cur);
  }
  return {
    people: [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unassigned,
  };
}
