import { useDraft } from "../../../lib/data/autosave.ts";
import { project } from "../../../lib/data/client.ts";
import type { Key } from "../../../lib/data/query.ts";
import type { ListTab } from "../TestsTabs.tsx";

const view = (name: string): Key => [project(), `view:tests.list.${name}`];

function useSet(name: string, initial: string[]): [Set<string>, (fn: (s: Set<string>) => Set<string>) => void] {
  const [raw, setRaw] = useDraft(view(name), JSON.stringify(initial));
  const now = new Set<string>(JSON.parse(raw) as string[]);
  return [now, (fn) => setRaw(JSON.stringify([...fn(new Set(now))]))];
}

// ponytail: what the test list looks like is kept for the page's life, per project — the tab, the two boxes, the
// folded and unfolded folders, the Jira folder picked — so coming back to Tests finds it as it was
export function useListView() {
  const [tab, setTab] = useDraft(view("tab"), "local");
  const [filter, setFilter] = useDraft(view("filter"), "");
  const [search, setSearch] = useDraft(view("search"), "");
  const [folder, setFolder] = useDraft(view("folder"), "/");
  const [jira, setJira] = useDraft(view("jira"), "");
  const [shut, setShut] = useSet("shut", []);
  const [expanded, setExpanded] = useSet("expanded", ["/"]);
  return {
    tab: (tab === "jira" ? "jira" : "local") as ListTab,
    setTab: (t: ListTab) => setTab(t),
    filter,
    setFilter,
    search,
    setSearch,
    folder,
    setFolder,
    jira,
    setJira,
    shut,
    setShut,
    expanded,
    setExpanded,
  };
}
