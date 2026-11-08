import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { parse } from "node:path";
import type {
  CatalogEntry,
  DoctorAction,
  DoctorCheck,
  Fit,
  FitVerdict,
  MachineProfile,
  ResolvedModel,
} from "../types.ts";
import { diskCheck, row } from "./doctor-row.ts";
import { fitOf, worst } from "./fit/verdict.ts";
import { machineProfile } from "./machine/profile.ts";
import { catalogEntry, pack } from "./models-catalog.ts";
import { perfStats, readPerf } from "./models-perf.ts";
import { budgets, downloadsAllowed, readRegistry } from "./models-registry.ts";
import { resolveInstalled } from "./models-resolve.ts";
import { readSettings, writeSettings } from "./project.ts";

// ponytail: the doctor's rows about models — installed, verified, fitting this PC, room on disk, vectors complete

const LIGHTER: DoctorAction = { label: "Choose a lighter pack", command: "models.usePack" };

export type ModelDeps = {
  machine(): Promise<MachineProfile>;
  active(
    project: string | null,
  ): Promise<{ embedding: ResolvedModel | null; reranker: ResolvedModel | null; wanted: string[] }>;
  space(project: string): Promise<string | null>;
};

async function activeOf(project: string | null) {
  if (project) {
    const { activeModels } = await import("../rag/activation.ts");
    const a = await activeModels(project);
    const v = a.choice?.variant ?? (a.choice && "embedding" in a.choice ? a.choice : null);
    const wanted = [v?.embedding, v?.reranker, a.embedding?.entry.id, a.reranker?.entry.id, ...a.missing].filter(
      (m): m is string => !!m && !m.startsWith("pack "),
    );
    return { embedding: a.embedding, reranker: a.reranker, wanted: [...new Set(wanted)] };
  }
  const light = pack("light")?.variants[0];
  return {
    embedding: light ? resolveInstalled(light.embedding) : null,
    reranker: light?.reranker ? resolveInstalled(light.reranker) : null,
    wanted: [light?.embedding, light?.reranker].filter((m): m is string => !!m),
  };
}

// ponytail: a project with no document has nothing to index — not a to-do on the system check
export const NOTHING_YET = "no document in the project yet";
// ponytail: vectors an index run is building are its work in progress, not a to-do
export const BUILDING = "an index run is building them";

export const modelDeps: ModelDeps = {
  machine: () => machineProfile(),
  active: activeOf,
  space: async (project) => {
    const { invoke } = await import("../commands/index.ts");
    const st = (await invoke("rag.status", {}, { project })) as {
      degraded: string | null;
      chunks?: number;
      indexing?: unknown;
    };
    if (st.degraded && st.indexing) return BUILDING;
    return st.degraded && st.chunks === 0 ? NOTHING_YET : st.degraded;
  },
};

function installRow(kind: "embedding" | "reranker", m: ResolvedModel | null, wanted: string | undefined): DoctorCheck {
  const id = `model.${kind}`;
  const label = `${kind === "embedding" ? "Embedding" : "Reranker"} model`;
  if (!m && !wanted) return row(id, label, "skip", "none in use");
  if (!m) {
    const e = wanted ? catalogEntry(wanted) : undefined;
    const remote = downloadsAllowed();
    return row(
      id,
      label,
      "warn",
      `${e?.label ?? wanted} is not on this PC${remote ? "" : " and downloads are off"}`,
      remote
        ? `testimus models pull ${e?.id ?? wanted} (or choose a pack: testimus models usePack light).`
        : "Copy it from the team share, then testimus models add <folder>.",
      remote
        ? { label: `Download ${e?.label ?? wanted}`, command: "models.pull", input: { model: e?.id ?? wanted } }
        : { label: "Add from a folder…", command: "models.add" },
    );
  }
  const where = m.install.path ?? m.runtime;
  const detail = `${m.entry.label} — ${m.runtime}, ${m.device}, ${where}`;
  if (m.install.status === "verified" || m.runtime === "mock") return row(id, label, "ok", `${detail} (verified)`);
  return row(id, label, "warn", `${detail} (not verified yet)`, `testimus models verify ${m.entry.id}`, {
    label: "Verify",
    command: "models.verify",
    input: { model: m.entry.id },
  });
}

// ponytail: a verdict the user may run with anyway — RAM too small and not supported here cannot run at all
export const acceptable = (v: FitVerdict) => v !== "fits" && v !== "ram-too-small" && v !== "unsupported";

/** the key of a set of models in settings.rag.fitAccepted: their ids, sorted */
export const fitKey = (entries: CatalogEntry[]) =>
  entries
    .map((e) => e.id)
    .sort()
    .join("+");

// ponytail: « Use anyway » holds while the verdict is no worse than the one accepted for these models; a worse one
// (tight → GPU too small) asks again
export function acceptedFit(entries: CatalogEntry[], verdict: FitVerdict): boolean {
  const took = readSettings().rag?.fitAccepted?.[fitKey(entries)];
  return !!took && acceptable(verdict) && worst(verdict, took) === took;
}

/** keep (or, with `verdict` null, drop) « Use anyway » for these models on this PC */
export function rememberFit(entries: CatalogEntry[], verdict: FitVerdict | null): void {
  const s = readSettings();
  const took = { ...s.rag?.fitAccepted };
  if (verdict) took[fitKey(entries)] = verdict;
  else delete took[fitKey(entries)];
  writeSettings({ ...s, rag: { ...s.rag, fitAccepted: took } });
}

// ponytail: the models a set in use stands for — the one resolved here, else the one wanted, of each kind
function entriesOf(active: Awaited<ReturnType<ModelDeps["active"]>>): CatalogEntry[] {
  const of = (kind: CatalogEntry["kind"], m: ResolvedModel | null) =>
    m?.entry ?? active.wanted.map((id) => catalogEntry(id)).find((e) => e?.kind === kind);
  return [of("embedding", active.embedding), of("reranker", active.reranker)].filter((e): e is CatalogEntry => !!e);
}

function fitRow(entries: CatalogEntry[], f: Fit): DoctorCheck {
  const label = "Models fit this PC";
  if (f.verdict === "fits") return row("model.fit", label, "ok", f.message);
  if (acceptedFit(entries, f.verdict)) return { ...row("model.fit", label, "ok", f.message), caution: "Used anyway" };
  const fix = "Choose a lighter pack: testimus models packs.";
  if (!acceptable(f.verdict)) return row("model.fit", label, "fail", f.message, fix, LIGHTER);
  return {
    ...row(
      "model.fit",
      label,
      "warn",
      f.message,
      `${fix} Or run with them as they are: testimus models acceptFit.`,
      LIGHTER,
    ),
    also: { label: "Use anyway", command: "models.acceptFit" },
  };
}

/** the models in use and their fit on this PC — what model.fit judges and models.acceptFit accepts */
export async function modelsFit(
  project: string | null,
  deps: ModelDeps = modelDeps,
): Promise<{ entries: CatalogEntry[]; fit: Fit } | null> {
  const entries = entriesOf(await deps.active(project));
  const machine = await deps.machine();
  if (!entries.length) return null;
  return { entries, fit: fitOf(entries, machine, { headroom: budgets().headroom, lines: readPerf() }) };
}

function systemRoot(): string {
  return parse(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : tmpdir()).root.toLowerCase();
}

export async function modelRows(project: string | null, deps: ModelDeps = modelDeps): Promise<DoctorCheck[]> {
  const rows: DoctorCheck[] = [];
  const reg = readRegistry();
  if (reg.dir) {
    const d = diskCheck("models.dir", "Models folder", reg.dir, 3);
    rows.push({ ...d, detail: `${reg.dir} — ${d.detail.replace(` at ${reg.dir}`, "")}` });
  } else
    rows.push(
      row(
        "models.dir",
        "Models folder",
        "warn",
        "not chosen yet: the first download asks where models go",
        "testimus models setDir <folder> (a drive with room; avoid C: when it is short of space).",
        { label: "Choose the models folder…", command: "models.setDir" },
      ),
    );
  const sys = systemRoot();
  const onSystem = [reg.dir, ...reg.installs.map((i) => i.path)].filter(
    (p): p is string => !!p && parse(p).root.toLowerCase() === sys,
  );
  if (onSystem.length) {
    const c = diskCheck("models.system", "Models on the system drive", onSystem[0], 10);
    rows.push(
      c.state === "ok"
        ? c
        : row(
            "models.system",
            "Models on the system drive",
            "warn",
            c.detail,
            "Move them: testimus models setDir <folder on another drive> --move.",
            {
              label: "Move the models…",
              command: "models.setDir",
              input: { move: true },
              value: reg.dir ?? onSystem[0],
            },
          ),
    );
  }
  const active = await deps.active(project).catch(() => ({ embedding: null, reranker: null, wanted: [] as string[] }));
  const wantE = active.wanted.find((m) => catalogEntry(m)?.kind === "embedding");
  const wantR = active.wanted.find((m) => catalogEntry(m)?.kind === "reranker");
  rows.push(installRow("embedding", active.embedding, wantE), installRow("reranker", active.reranker, wantR));
  const entries = entriesOf(active);
  const machine = await deps.machine().catch(() => null);
  if (!entries.length || !machine)
    rows.push(
      row("model.fit", "Models fit this PC", "skip", machine ? "no model in use" : "machine profile unavailable"),
    );
  else rows.push(fitRow(entries, fitOf(entries, machine, { headroom: budgets().headroom, lines: readPerf() })));
  const ours = entries.map((e) => e.id);
  const partly = perfStats({ last: 50 })
    .filter((s) => s.partialOffload && ours.includes(s.model))
    .map((s) => `${s.model} (${s.op})`);
  rows.push(
    partly.length
      ? row(
          "model.offload",
          "Models fully on the GPU",
          "warn",
          `partly on the processor: ${[...new Set(partly)].join(", ")}`,
          "Choose a lighter pack or variant: testimus models advice.",
          LIGHTER,
        )
      : row(
          "model.offload",
          "Models fully on the GPU",
          entries.length ? "ok" : "skip",
          entries.length ? "no model reported partly on the processor" : "no model in use",
        ),
  );
  if (project) {
    const degraded = await deps.space(project).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    rows.push(
      degraded === NOTHING_YET || degraded === BUILDING
        ? row("index.space", "Vectors of the active model", "skip", degraded)
        : degraded
          ? row("index.space", "Vectors of the active model", "warn", degraded, "testimus rag index", {
              label: "Index now",
              command: "rag.index",
            })
          : row("index.space", "Vectors of the active model", "ok", "complete"),
    );
  } else rows.push(row("index.space", "Vectors of the active model", "skip", "no project open"));
  const usesLlama = [active.embedding, active.reranker].some((m) => m?.runtime === "llamacpp");
  const build = reg.llamacpp;
  // ponytail: llama.cpp is only the GGUF runtime — its row exists while a model in use runs on it
  if (!usesLlama) return rows;
  if (build && existsSync(build.exe))
    rows.push(row("llamacpp", "llama.cpp build", "ok", `${build.build} (${build.backend}) at ${build.exe}`));
  else
    rows.push(
      row(
        "llamacpp",
        "llama.cpp build",
        "fail",
        build ? `${build.exe} is missing` : "a model in use needs llama.cpp and no build is registered",
        "testimus models pullRuntime (or testimus models add <llama.cpp folder>).",
        { label: "Download llama.cpp", command: "models.pullRuntime" },
      ),
    );
  return rows;
}
