// ponytail: work the page itself waits on (a Jira folder tree, a Jira search) is shown in the activity indicator
// beside the core's jobs, as Xray Editor does — it is not a job, so it has no Cancel
export type LocalWork = { id: number; label: string; kind: string; startedAt: string };

let seq = 0;
let items: LocalWork[] = [];
const listeners = new Set<(w: LocalWork[]) => void>();

const emit = () => {
  for (const fn of listeners) fn(items);
};

export function track<T>(kind: string, label: string, work: Promise<T>): Promise<T> {
  const item: LocalWork = { id: ++seq, label, kind, startedAt: new Date().toISOString() };
  items = [...items, item];
  emit();
  const done = () => {
    items = items.filter((x) => x.id !== item.id);
    emit();
  };
  work.then(done, done);
  return work;
}

export function onLocalWork(fn: (w: LocalWork[]) => void): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}

export function resetLocalWork(): void {
  items = [];
  emit();
}
