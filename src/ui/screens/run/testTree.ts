import type { FindingCounts, Review } from "../../../core/types.ts";
import type { FilterOption } from "../../components/filters/FilterMenu.tsx";
import { fold } from "../../lib/format.ts";

export type PickTest = {
  id: string;
  key?: string;
  summary: string;
  folder: string;
  labels: string[];
  review: Review;
  findings?: FindingCounts;
  /** Claude proposes a fix on it (Generate's pick) */
  fix?: boolean;
};

export type TestBranch = { kind: "branch"; key: string; label: string; children: TestNode[] };
export type TestLeaf = { kind: "leaf"; key: string; test: PickTest };
export type TestNode = TestBranch | TestLeaf;

export type PickFilters = { words: string; folders: string[]; labels: string[]; reviews: string[]; findings: string[] };
export const NO_PICK_FILTER: PickFilters = { words: "", folders: [], labels: [], reviews: [], findings: [] };

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const parts = (folder: string) => folder.split("/").filter(Boolean);
const under = (folder: string, f: string) => {
  const a = parts(folder);
  const b = parts(f);
  return b.every((p, i) => a[i] === p);
};

const REVIEWS: { value: Review; label: string }[] = [
  { value: "validated", label: "Validated" },
  { value: "draft", label: "Draft" },
  { value: "to-fix", label: "To fix" },
];

const FINDINGS: { value: string; label: string; has: (t: PickTest) => boolean }[] = [
  { value: "errors", label: "Errors", has: (t) => !!t.findings?.errors },
  { value: "warnings", label: "Warnings", has: (t) => !!t.findings?.warnings },
  { value: "clean", label: "No findings", has: (t) => !!t.findings && !t.findings.errors && !t.findings.warnings },
  { value: "unchecked", label: "Not checked yet", has: (t) => !t.findings },
  { value: "fix", label: "With a fix", has: (t) => !!t.fix },
];

const keeps = (t: PickTest, f: PickFilters, skip?: keyof PickFilters) => {
  const words = fold(f.words).split(/\s+/).filter(Boolean);
  const hay = fold([t.summary, t.key ?? "", t.id].join(" "));
  return (
    (skip === "words" || words.every((w) => hay.includes(w))) &&
    (skip === "folders" || !f.folders.length || f.folders.some((x) => under(t.folder, x))) &&
    (skip === "labels" || !f.labels.length || t.labels.some((l) => f.labels.includes(l))) &&
    (skip === "reviews" || !f.reviews.length || f.reviews.includes(t.review)) &&
    (skip === "findings" || !f.findings.length || FINDINGS.some((x) => f.findings.includes(x.value) && x.has(t)))
  );
};

export const keepTests = (tests: PickTest[], f: PickFilters) => tests.filter((t) => keeps(t, f));

// ponytail: each menu counts what it would show with the other filters as they are (its own left out); the folders
// menu holds every folder of the tree, each counting the tests in it and below
export function pickOptions(tests: PickTest[], f: PickFilters) {
  const rest = (skip: keyof PickFilters) => tests.filter((t) => keeps(t, f, skip));
  const folders = new Set<string>();
  for (const t of tests) {
    const p = parts(t.folder);
    for (let i = 1; i <= p.length; i++) folders.add(`/${p.slice(0, i).join("/")}`);
  }
  const labels = [...new Set(tests.flatMap((t) => t.labels))].sort(natural);
  return {
    folders: [...folders]
      .sort(natural)
      .map(
        (x): FilterOption => ({ value: x, label: x, count: rest("folders").filter((t) => under(t.folder, x)).length }),
      ),
    labels: labels.map(
      (l): FilterOption => ({ value: l, label: l, count: rest("labels").filter((t) => t.labels.includes(l)).length }),
    ),
    reviews: REVIEWS.map(
      (r): FilterOption => ({ ...r, count: rest("reviews").filter((t) => t.review === r.value).length }),
    ),
    findings: FINDINGS.filter((x) => x.value !== "fix" || tests.some((t) => t.fix)).map(
      (x): FilterOption => ({ value: x.value, label: x.label, count: rest("findings").filter(x.has).length }),
    ),
  };
}

// ponytail: the folders as Xray files them, subfolders first then the tests, each level in natural order — the order
// a run made from it plays them
export function testTree(tests: PickTest[]): TestNode[] {
  type Dir = { dirs: Map<string, Dir>; tests: PickTest[] };
  const root: Dir = { dirs: new Map(), tests: [] };
  for (const t of tests) {
    let at = root;
    for (const p of parts(t.folder)) {
      if (!at.dirs.has(p)) at.dirs.set(p, { dirs: new Map(), tests: [] });
      at = at.dirs.get(p) as Dir;
    }
    at.tests.push(t);
  }
  const nodes = (d: Dir, path: string): TestNode[] => [
    ...[...d.dirs.entries()]
      .sort(([a], [b]) => natural(a, b))
      .map(([name, sub]): TestNode => {
        const key = `${path}/${name}`;
        return { kind: "branch", key, label: name, children: nodes(sub, key) };
      }),
    ...[...d.tests]
      .sort((a, b) => natural(a.key ?? a.id, b.key ?? b.id) || natural(a.summary, b.summary))
      .map((t): TestNode => ({ kind: "leaf", key: t.id, test: t })),
  ];
  return nodes(root, "");
}

// ponytail: a tree that is one folder inside another down to its tests (a generation writes into one folder) shows its
// tests alone: a folder ticking everything says nothing the picker's own « Pick all » does not
export function flatChain(nodes: TestNode[]): TestNode[] {
  let at = nodes;
  while (at.length === 1 && at[0].kind === "branch") at = at[0].children;
  return at.every((n) => n.kind === "leaf") ? at : nodes;
}

export const leavesOf = (n: TestNode): string[] => (n.kind === "leaf" ? [n.key] : n.children.flatMap(leavesOf));

export const treeOrder = (nodes: TestNode[]) => nodes.flatMap(leavesOf);
