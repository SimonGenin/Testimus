import { existsSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, parse } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { OllamaStatus } from "../rag/runtimes/ollama.ts";
import { LOOPBACK, loopbackProxyGap, shellOf } from "../shell.ts";
import type { CatalogEntry, DoctorCheck, MachineProfile, ResolvedModel } from "../types.ts";
import { jiraCreds, xrayCreds } from "./creds.ts";
import { catalogEntry } from "./models-catalog.ts";
import { fitOf } from "./models-fit.ts";
import { machineProfile } from "./models-hardware.ts";
import { perfStats, readPerf } from "./models-perf.ts";
import { budgets, readRegistry } from "./models-registry.ts";
import { resolveInstalled } from "./models-resolve.ts";
import { DEFAULT_PROJECT, readSettings } from "./project.ts";

export type DoctorOpts = {
  project: string | null;
  claude: boolean;
  timeoutMs?: number;
  models?: ModelDeps;
};

const GB = 1024 ** 3;

function row(id: string, label: string, state: DoctorCheck["state"], detail: string, fix?: string): DoctorCheck {
  return fix && state !== "ok" ? { id, label, state, detail, fix } : { id, label, state, detail };
}

function message(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${err?.message ?? String(e)}${cause ? ` (${cause})` : ""}`;
}

export function nodeCheck(version = process.version): DoctorCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return major >= 24
    ? row("node", "Node runtime", "ok", version)
    : row("node", "Node runtime", "fail", version, "Run Testimus through testimus.cmd, which uses its own Node 26.");
}

export async function sqliteCheck(): Promise<DoctorCheck> {
  const label = "Index engine (node:sqlite + sqlite-vec + FTS5)";
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const vec = await import("sqlite-vec");
    const db = new DatabaseSync(":memory:", { allowExtension: true });
    try {
      vec.load(db);
      const v = db.prepare("select sqlite_version() as s, vec_version() as v").get() as { s: string; v: string };
      db.exec("create virtual table probe using fts5(t)");
      return row("sqlite", label, "ok", `SQLite ${v.s}, sqlite-vec ${v.v}, FTS5`);
    } finally {
      db.close();
    }
  } catch (e) {
    return row("sqlite", label, "fail", message(e), "Reinstall Testimus: the release folder is incomplete.");
  }
}

export async function onnxCheck(): Promise<DoctorCheck> {
  const label = "Embedding runtime (onnxruntime-node)";
  try {
    const ort = (await import("onnxruntime-node")) as { env?: { versions?: { node?: string } } };
    return row("onnx", label, "ok", `onnxruntime ${ort.env?.versions?.node ?? "loaded"}`);
  } catch (e) {
    return row(
      "onnx",
      label,
      "fail",
      message(e),
      "Reinstall Testimus; if it persists, install the Microsoft Visual C++ Redistributable (x64).",
    );
  }
}

function claudeExe(): string {
  return readSettings().claude.exe || "claude";
}

export async function claudeVersionCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Claude Code CLI";
  const exe = claudeExe();
  const fix =
    "Install it: irm https://claude.ai/install.ps1 | iex — or set its path with testimus system saveSettings --claude-exe <path>.";
  try {
    const out = await env.spawnClaude({
      exe,
      args: ["--version"],
      cwd: tmpdir(),
      stdin: "",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const v = out.stdout.match(/\d+\.\d+\.\d+/)?.[0];
    if (out.code !== 0 || !v) return row("claude", label, "fail", `${exe} not found or not working`, fix);
    return row("claude", label, "ok", `${exe} ${v}`);
  } catch (e) {
    return row("claude", label, "fail", `${exe}: ${message(e)}`, fix);
  }
}

export async function claudeLoginCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Claude signed in";
  const fix = "Open a terminal, run claude once and sign in with your Claude subscription.";
  try {
    const out = await env.spawnClaude({
      exe: claudeExe(),
      args: ["-p", "--output-format", "json"],
      cwd: tmpdir(),
      stdin: "Reply with the single word ok.",
      signal: AbortSignal.timeout(timeoutMs),
    });
    let result: { is_error?: boolean; result?: string } = {};
    try {
      result = JSON.parse(out.stdout.trim().split(/\r?\n/).pop() ?? "{}");
    } catch {}
    const text = `${result.result ?? ""} ${out.stderr}`.trim();
    if (out.code === 0 && !result.is_error) return row("claudeLogin", label, "ok", "a minimal claude -p run answered");
    if (/limit|credit|usage/i.test(text))
      return row("claudeLogin", label, "warn", text.slice(0, 200), "Your plan's limit is reached: wait or upgrade.");
    return row("claudeLogin", label, "fail", text.slice(0, 200) || `claude -p exited with ${out.code}`, fix);
  } catch (e) {
    return row("claudeLogin", label, "fail", message(e), fix);
  }
}

export async function jiraCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Jira reachable and authenticated";
  let c: ReturnType<typeof jiraCreds>;
  try {
    c = jiraCreds();
  } catch (e) {
    return row("jira", label, "fail", message(e), e instanceof UserError ? e.fix : undefined);
  }
  const host = new URL(c.base).host;
  try {
    const res = await env.http({
      method: "GET",
      url: `${c.base}/rest/api/3/myself`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`,
        Accept: "application/json",
      },
      timeoutMs,
    });
    if (res.status === 200) {
      const me = JSON.parse(res.text ?? "{}") as { displayName?: string };
      return row("jira", label, "ok", `${me.displayName ?? c.email} on ${host}`);
    }
    if (res.status === 401 || res.status === 403)
      return row(
        "jira",
        label,
        "fail",
        `Jira ${res.status} — check ~/.atlassian/credentials.json`,
        "Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens, then testimus system setup --token <token>.",
      );
    return row(
      "jira",
      label,
      "fail",
      `Jira ${res.status} on ${host}`,
      "Check the site in ~/.atlassian/credentials.json.",
    );
  } catch (e) {
    return row(
      "jira",
      label,
      "fail",
      `${host} unreachable: ${message(e)}`,
      "Check the network or the proxy (HTTPS_PROXY).",
    );
  }
}

export async function xrayCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Xray reachable and authenticated";
  let c: ReturnType<typeof xrayCreds>;
  try {
    c = xrayCreds();
  } catch (e) {
    return row("xray", label, "fail", message(e), e instanceof UserError ? e.fix : undefined);
  }
  const host = new URL(c.apiBase).host;
  try {
    const res = await env.http({
      method: "POST",
      url: `${c.apiBase}/api/v2/authenticate`,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret }),
      timeoutMs,
    });
    const jwt = (res.text ?? "").trim().replace(/^"|"$/g, "");
    if (res.status === 200 && jwt) return row("xray", label, "ok", `authenticated on ${host}`);
    if (res.status === 401 || res.status === 403)
      return row(
        "xray",
        label,
        "fail",
        "Xray 401 — check ~/.atlassian/xray_credentials.json (client id / secret)",
        "Ask your Jira admin for an Xray API key (client id + secret), then testimus system setup.",
      );
    return row("xray", label, "fail", `Xray authentication failed (${res.status}) on ${host}`, "Retry later.");
  } catch (e) {
    return row(
      "xray",
      label,
      "fail",
      `${host} unreachable: ${message(e)}`,
      "Check the network or the proxy (HTTPS_PROXY).",
    );
  }
}

export type ModelDeps = {
  machine(): Promise<MachineProfile>;
  ollama(): Promise<OllamaStatus | null>;
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
  const rag = DEFAULT_PROJECT.rag;
  return {
    embedding: resolveInstalled(rag.embedding),
    reranker: rag.reranker ? resolveInstalled(rag.reranker) : null,
    wanted: [rag.embedding, rag.reranker].filter((m): m is string => !!m),
  };
}

export const modelDeps: ModelDeps = {
  machine: () => machineProfile(),
  ollama: async () => {
    try {
      return await (await import("../rag/runtimes/ollama.ts")).ollamaStatus();
    } catch {
      return null;
    }
  },
  active: activeOf,
  space: async (project) => {
    const { invoke } = await import("../commands/index.ts");
    const st = (await invoke("rag.status", {}, { project })) as { degraded: string | null };
    return st.degraded;
  },
};

function installRow(kind: "embedding" | "reranker", m: ResolvedModel | null, wanted: string | undefined): DoctorCheck {
  const id = `model.${kind}`;
  const label = `${kind === "embedding" ? "Embedding" : "Reranker"} model`;
  if (!m && !wanted) return row(id, label, "skip", "none in use");
  if (!m) {
    const e = wanted ? catalogEntry(wanted) : undefined;
    const remote = readRegistry().allowRemote;
    return row(
      id,
      label,
      "warn",
      `${e?.label ?? wanted} is not on this PC${remote ? "" : " and downloads are off"}`,
      remote
        ? `testimus models pull ${e?.id ?? wanted} (or choose a pack: testimus models usePack light).`
        : "Copy it from the team share, then testimus models add <folder>.",
    );
  }
  const where = m.install.path ?? (m.install.ollama ? `Ollama ${m.install.ollama}` : m.runtime);
  const detail = `${m.entry.label} — ${m.runtime}, ${m.device}, ${where}`;
  if (m.install.status === "verified" || m.runtime === "mock") return row(id, label, "ok", `${detail} (verified)`);
  return row(id, label, "warn", `${detail} (not verified yet)`, `testimus models verify ${m.entry.id}`);
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
          ),
    );
  }
  const active = await deps.active(project).catch(() => ({ embedding: null, reranker: null, wanted: [] as string[] }));
  const wantE = active.wanted.find((m) => catalogEntry(m)?.kind === "embedding");
  const wantR = active.wanted.find((m) => catalogEntry(m)?.kind === "reranker");
  rows.push(installRow("embedding", active.embedding, wantE), installRow("reranker", active.reranker, wantR));
  const entries = [
    active.embedding?.entry ?? (wantE ? catalogEntry(wantE) : undefined),
    active.reranker?.entry ?? (wantR ? catalogEntry(wantR) : undefined),
  ].filter((e): e is CatalogEntry => !!e);
  const machine = await deps.machine().catch(() => null);
  if (!entries.length || !machine)
    rows.push(
      row("model.fit", "Models fit this PC", "skip", machine ? "no model in use" : "machine profile unavailable"),
    );
  else {
    const f = fitOf(entries, machine, { headroom: budgets().headroom, lines: readPerf() });
    const state = f.verdict === "fits" ? "ok" : f.verdict === "ram-too-small" ? "fail" : "warn";
    rows.push(
      row("model.fit", "Models fit this PC", state, f.message, "Choose a lighter pack: testimus models packs."),
    );
  }
  const ours = entries.map((e) => e.id);
  const partly = [
    ...(machine?.loaded ?? [])
      .filter((l) => l.vramMB < l.sizeMB && entries.some((e) => e.source.ollama === l.name || e.id === l.name))
      .map((l) => `${l.name} (${Math.round(l.vramMB)} of ${Math.round(l.sizeMB)} MB on the GPU)`),
    ...perfStats({ last: 50 })
      .filter((s) => s.partialOffload && ours.includes(s.model))
      .map((s) => `${s.model} (${s.op})`),
  ];
  rows.push(
    partly.length
      ? row(
          "model.offload",
          "Models fully on the GPU",
          "warn",
          `partly on the processor: ${[...new Set(partly)].join(", ")}`,
          "Choose a lighter pack or variant: testimus models advice.",
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
      degraded
        ? row("index.space", "Vectors of the active model", "warn", degraded, "testimus rag index")
        : row("index.space", "Vectors of the active model", "ok", "complete"),
    );
  } else rows.push(row("index.space", "Vectors of the active model", "skip", "no project open"));
  const ollama = await deps.ollama();
  const oMsg = ollama?.message ?? "Ollama state unknown.";
  const usesOllama = [active.embedding, active.reranker].some((m) => m?.runtime === "ollama");
  if (!usesOllama) rows.push(row("ollama", "Ollama", "ok", oMsg));
  else if (ollama?.state === "running") rows.push(row("ollama", "Ollama", "ok", oMsg));
  else
    rows.push(
      row(
        "ollama",
        "Ollama",
        "fail",
        `${oMsg} A model in use is served by Ollama.`,
        "Start Ollama, or choose a pack: every pack runs without it (testimus models packs).",
      ),
    );
  const usesLlama = [active.embedding, active.reranker].some((m) => m?.runtime === "llamacpp");
  const build = reg.llamacpp;
  if (build && existsSync(build.exe))
    rows.push(row("llamacpp", "llama.cpp build", "ok", `${build.build} (${build.backend}) at ${build.exe}`));
  else if (usesLlama)
    rows.push(
      row(
        "llamacpp",
        "llama.cpp build",
        "fail",
        build ? `${build.exe} is missing` : "a model in use needs llama.cpp and no build is registered",
        "testimus models pullRuntime (or testimus models add <llama.cpp folder>).",
      ),
    );
  else rows.push(row("llamacpp", "llama.cpp build", "skip", "not needed by the models in use"));
  return rows;
}

function existing(dir: string): string {
  let cur = dir;
  while (!existsSync(cur) && dirname(cur) !== cur) cur = dirname(cur);
  return cur;
}

export function diskCheck(id: string, label: string, dir: string, needGb: number): DoctorCheck {
  try {
    const s = statfsSync(existing(dir));
    const free = (s.bavail * s.bsize) / GB;
    const detail = `${free.toFixed(1)} GB free at ${dir}`;
    if (free >= needGb) return row(id, label, "ok", detail);
    return row(id, label, free >= needGb / 3 ? "warn" : "fail", detail, `Free at least ${needGb} GB on that drive.`);
  } catch (e) {
    return row(id, label, "warn", message(e));
  }
}

export function hideAuth(url: string): string {
  return url.replace(/\/\/[^/@]*@/, "//***@");
}

export function proxyCheck(vars: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const proxy = vars.HTTPS_PROXY || vars.https_proxy || vars.HTTP_PROXY || vars.http_proxy;
  const on = vars.NODE_USE_ENV_PROXY === "1";
  if (!proxy) return row("proxy", "Proxy", "ok", "none (direct connection)");
  const shown = `${hideAuth(proxy)}${vars.NO_PROXY || vars.no_proxy ? `, NO_PROXY=${vars.NO_PROXY || vars.no_proxy}` : ""}`;
  const gap = loopbackProxyGap(vars);
  if (gap)
    return row(
      "proxy",
      "Proxy",
      "fail",
      `${shown}: ${gap}`,
      `Start Testimus through testimus.cmd or the desktop app (they add ${LOOPBACK.join(",")} to NO_PROXY), or add them to NO_PROXY yourself.`,
    );
  if (on) return row("proxy", "Proxy", "ok", `${shown} (used by fetch)`);
  return row(
    "proxy",
    "Proxy",
    "warn",
    `${shown} is set but NODE_USE_ENV_PROXY is not 1: downloads and Jira calls ignore it`,
    "Start Testimus through testimus.cmd, which sets NODE_USE_ENV_PROXY=1.",
  );
}

export async function runDoctor(opts: DoctorOpts): Promise<DoctorCheck[]> {
  const t = opts.timeoutMs ?? 8000;
  const login: Promise<DoctorCheck> = opts.claude
    ? claudeLoginCheck(Math.max(t, 60000))
    : Promise.resolve(
        row("claudeLogin", "Claude signed in", "skip", "not checked", "testimus system doctor --claude runs one."),
      );
  const rows = await Promise.all([
    nodeCheck(),
    sqliteCheck(),
    onnxCheck(),
    row("face", "Face", "ok", shellOf().label),
    claudeVersionCheck(Math.max(t, 15000)),
    login,
    jiraCheck(t),
    xrayCheck(t),
    modelRows(opts.project, opts.models ?? modelDeps),
    opts.project
      ? diskCheck("disk.index", "Disk space for the index", opts.project, 1)
      : row("disk.index", "Disk space for the index", "skip", "no project open"),
    proxyCheck(),
  ]);
  return rows.flat();
}
