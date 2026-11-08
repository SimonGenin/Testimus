import { List } from "../../components/ui/List.tsx";
import { listMeta, type RunSummary } from "./runs.ts";

// ponytail: the runs, those still being played first (newest first in each group)
export function RunList({
  runs,
  selected,
  onOpen,
}: {
  runs: RunSummary[] | undefined;
  selected: string;
  onOpen: (slug: string) => void;
}) {
  if (!runs) return <List label="Runs" items={[]} getKey={() => ""} renderItem={() => ({ title: "" })} loading={4} />;
  const open = runs.filter((r) => !r.finished).map((r) => r.slug);
  const done = runs.filter((r) => r.finished).map((r) => r.slug);
  return (
    <List
      label="Runs"
      items={runs}
      getKey={(r) => r.slug}
      density="two-line"
      selected={selected || null}
      onSelect={onOpen}
      groups={[
        ...(open.length ? [{ label: "In progress", keys: open }] : []),
        ...(done.length ? [{ label: "Finished", keys: done }] : []),
      ]}
      renderItem={(r) => ({
        title: r.name,
        meta: r.importedAt ? `Imported from pages · ${listMeta(r)}` : listMeta(r),
        tooltip: r.name,
      })}
    />
  );
}
