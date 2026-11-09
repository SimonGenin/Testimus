import type { Review } from "../../../core/types.ts";
import type { FilterOption } from "../../components/filters/FilterMenu.tsx";
import { fold } from "../../lib/format.ts";
import type { QueueItem } from "./ReviewQueue.tsx";

export type QueueCheck = "errors" | "warnings" | "clean" | "unchecked" | "stale";

export type QueueFilters = {
  words: string;
  states: Review[];
  checks: QueueCheck[];
  folders: string[];
};

export const NO_FILTER: QueueFilters = { words: "", states: [], checks: [], folders: [] };

const CHECKS: { value: QueueCheck; label: string; has: (t: QueueItem) => boolean }[] = [
  { value: "errors", label: "Errors", has: (t) => !t.unchecked && t.errors > 0 },
  { value: "warnings", label: "Warnings", has: (t) => !t.unchecked && t.warnings > 0 },
  { value: "clean", label: "No findings", has: (t) => !t.unchecked && !t.errors && !t.warnings },
  { value: "unchecked", label: "Not checked yet", has: (t) => t.unchecked },
  { value: "stale", label: "Changed since its check", has: (t) => t.stale },
];

const STATES: { value: Review; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "to-fix", label: "To fix" },
];

const under = (folder: string, f: string) => folder === f || folder.startsWith(`${f.replace(/\/+$/, "")}/`);

const keeps = (t: QueueItem, f: QueueFilters, skip?: keyof QueueFilters) => {
  const words = fold(f.words).split(/\s+/).filter(Boolean);
  const hay = fold([t.summary, t.key ?? "", t.id].join(" "));
  return (
    (skip === "words" || words.every((w) => hay.includes(w))) &&
    (skip === "states" || !f.states.length || f.states.includes(t.review)) &&
    (skip === "checks" || !f.checks.length || CHECKS.some((c) => f.checks.includes(c.value) && c.has(t))) &&
    (skip === "folders" || !f.folders.length || f.folders.some((x) => under(t.folder, x)))
  );
};

export const keepQueued = (items: QueueItem[], f: QueueFilters) => items.filter((t) => keeps(t, f));

export const filtered = (f: QueueFilters) =>
  !!f.words.trim() || f.states.length > 0 || f.checks.length > 0 || f.folders.length > 0;

// ponytail: each menu counts what it would show with the other filters as they are (its own left out), so a tick
// says what it adds
export function queueOptions(items: QueueItem[], f: QueueFilters) {
  const rest = (skip: keyof QueueFilters) => items.filter((t) => keeps(t, f, skip));
  const byState = rest("states");
  const byCheck = rest("checks");
  const byFolder = rest("folders");
  const folders = [...new Set(items.map((t) => t.folder).filter(Boolean))].sort();
  return {
    states: STATES.map((s): FilterOption => ({ ...s, count: byState.filter((t) => t.review === s.value).length })),
    checks: CHECKS.map((c): FilterOption => ({ value: c.value, label: c.label, count: byCheck.filter(c.has).length })),
    folders: folders.map(
      (x): FilterOption => ({ value: x, label: x, count: byFolder.filter((t) => under(t.folder, x)).length }),
    ),
  };
}
