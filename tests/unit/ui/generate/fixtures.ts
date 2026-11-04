import type { DocRef, Job, LocalTestRef, Test } from "../../../../src/core/types.ts";
import type { GenOutput } from "../../../../src/ui/screens/generate/GenResult.tsx";

export const at = "2026-11-02T10:00:00.000Z";

export const test = (summary: string, fields: Record<string, string>[] = [{ Action: "a" }]): Test =>
  ({
    summary,
    folder: "/",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps: fields.map((f) => ({ fields: f, sources: [], images: [] })),
    extra: {},
  }) as unknown as Test;

export const output = (over: Partial<GenOutput> = {}): GenOutput => ({
  runId: "r",
  ok: true,
  summary: "",
  tests: [],
  changed: [],
  skipped: [],
  reportFound: true,
  durationMs: 1,
  ...over,
});

export const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  kind: "generate",
  subject: "x",
  status: "running",
  startedAt: at,
  ...over,
});

export const ref = (id: string, over: Partial<LocalTestRef> = {}): LocalTestRef =>
  ({
    id,
    summary: id,
    folder: "/",
    review: "draft",
    generated: false,
    edited: false,
    sync: "local",
    dirty: false,
    synced: false,
    mtime: 1,
    stepCount: 1,
    ...over,
  }) as LocalTestRef;

export const docRef = (id: string, title: string, sections?: number, over: Partial<DocRef> = {}) =>
  ({
    id,
    code: `C-${id}`,
    title,
    status: "validated",
    converted: sections ? { with: "", at: "", warnings: [], stats: { sections } } : undefined,
    ...over,
  }) as unknown as DocRef;

export const toc = [
  { anchor: "§5", title: "Traction", level: 2 },
  { anchor: "§5.6", title: "Objets", level: 3 },
  { anchor: "§5.6.6", title: "Sectionneur", level: 4 },
  { anchor: "§5.6.7", title: "Disjoncteur", level: 4 },
  { anchor: "§6", title: "Signaux", level: 2 },
];
