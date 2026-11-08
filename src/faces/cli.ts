#!/usr/bin/env node
import { type Command, UserError } from "../core/command.ts";
import { describe as describeCommand, find, invoke, registry } from "../core/commands/index.ts";
import { listJobs, subscribe, waitJob } from "../core/jobs.ts";
import { overviewAsked } from "../core/lib/overview-after.ts";
import { resolveProjectDir } from "../core/lib/project.ts";
import { onStopSignals, trustSystemCertificates } from "../core/shell.ts";
import { commandOf, inputFrom } from "./cli-args.ts";

function help(name?: string): string {
  if (name) {
    const c = find(name);
    const d = describeCommand(c);
    const props =
      (d.input as { properties?: Record<string, { description?: string; type?: string }>; required?: string[] }) ?? {};
    const lines = [`${c.name}${c.mutates ? " *" : ""} — ${c.summary}`, ""];
    for (const [k, v] of Object.entries(props.properties ?? {})) {
      const req = props.required?.includes(k) ? "" : " (optional)";
      lines.push(`  --${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}${req}  ${v.description ?? ""}`);
    }
    if (c.positional?.length) lines.push("", `  positional: ${c.positional.join(", ")}`);
    return lines.join("\n");
  }
  const groups = new Map<string, Command[]>();
  for (const c of registry) {
    const g = c.name.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const out = [
    "testimus <group> <verb> [--flags] [--json] [--project <dir>]",
    "testimus serve [--mock] [--port 4317|0] [--no-open] [--ready-json] [--exit-with-stdin] | testimus mcp | testimus help <group.verb>",
    "",
  ];
  for (const [g, cs] of groups) {
    out.push(`${g}`);
    for (const c of cs) out.push(`  ${c.name.split(".")[1]}${c.mutates ? "*" : ""}  ${c.summary}`);
  }
  return out.join("\n");
}

function human(value: unknown, indent = ""): string {
  if (value === null || value === undefined) return `${indent}—`;
  if (typeof value !== "object") return `${indent}${String(value)}`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(none)`;
    return value
      .map((v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const o = v as Record<string, unknown>;
          if ("state" in o && "label" in o)
            return `${indent}${String(o.state).toUpperCase().padEnd(5)} ${o.label} — ${o.detail ?? ""}${o.fix && o.state !== "ok" ? `\n${indent}      → ${o.fix}` : ""}`;
          return `${indent}-\n${human(v, `${indent}  `)}`;
        }
        return `${indent}- ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
      })
      .join("\n");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) =>
      v && typeof v === "object" && (!Array.isArray(v) || v.some((x) => x && typeof x === "object"))
        ? `${indent}${k}:\n${human(v, `${indent}  `)}`
        : `${indent}${k}: ${Array.isArray(v) ? v.join(", ") || "(none)" : (v ?? "—")}`,
    )
    .join("\n");
}

function print(result: unknown, json: boolean): void {
  process.stdout.write(`${json ? JSON.stringify(result, null, 2) : human(result)}\n`);
}

async function main(argv: string[]): Promise<number> {
  const [first, second] = argv;
  if (!first || first === "help" || first === "--help" || first === "-h") {
    process.stdout.write(`${help(second)}\n`);
    return 0;
  }
  if (first === "serve") {
    const { serve } = await import("./http.ts");
    try {
      await serve(argv.slice(1));
    } catch (e) {
      report(e);
      process.exit(1);
    }
    return -1;
  }
  if (first === "mcp") {
    const { mcp } = await import("./mcp.ts");
    await mcp(argv.slice(1));
    return -1;
  }
  const { name, args } = commandOf(argv);
  const c = find(name);
  const { input, json, project, after } = inputFrom(c, args);
  const ctrl = new AbortController();
  onStopSignals(() => ctrl.abort());
  const unsub = subscribe((e) => {
    if (json) return;
    if (e.type === "progress") process.stderr.write(`${e.total ? `[${e.done ?? 0}/${e.total}] ` : ""}${e.message}\n`);
    if (e.type === "log") process.stderr.write(`${e.level}: ${e.message}\n`);
    if (e.type === "claude" && e.event.type === "text") process.stderr.write(e.event.text);
  });
  try {
    const result = await invoke(c.name, input, {
      project: resolveProjectDir(project),
      signal: ctrl.signal,
      wait: true,
      ...(after ? { cause: { jobId: after, why: "follow-up" as const } } : {}),
      onProgress: (p) =>
        !json && process.stderr.write(`${p.total ? `[${p.done ?? 0}/${p.total}] ` : ""}${p.message}\n`),
      onLog: (level, m) => !json && process.stderr.write(`${level}: ${m}\n`),
      onClaude: (e) => !json && e.type === "text" && process.stderr.write(e.text),
    });
    print(result, json);
    return 0;
  } finally {
    // ponytail: a command that started jobs without waiting (models usePack) lives until they end, then stops its servers;
    // an import's update of docs/OVERVIEW.md, asked once its index run ended, is waited for too and its progress shown
    const dir = resolveProjectDir(project);
    if (dir) await overviewAsked(dir).catch(() => {});
    for (const j of listJobs(dir))
      if (j.status === "running" && j.pid === process.pid) await waitJob(j.id).catch(() => {});
    unsub();
    // ponytail: a one-shot command never keeps a model server for later; an idle llama-server would hold the process
    const { stopAllServers } = await import("../core/rag/runtimes/llamacpp.ts");
    await stopAllServers().catch(() => {});
  }
}

function report(e: unknown): void {
  const fix = e instanceof UserError && e.fix ? `\n${e.fix}` : "";
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}${fix}\n`);
}

trustSystemCertificates();
main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e) => {
    report(e);
    process.exitCode = 1;
  },
);
