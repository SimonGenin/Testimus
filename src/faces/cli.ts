#!/usr/bin/env node
import { parseArgs } from "node:util";
import { z } from "zod";
import { type Command, UserError } from "../core/command.ts";
import { describe as describeCommand, find, invoke, registry } from "../core/commands/index.ts";
import { listJobs, subscribe, waitJob } from "../core/jobs.ts";
import { resolveProjectDir } from "../core/lib/project.ts";

type Shape = Record<string, z.ZodType>;

function shapeOf(c: Command): Shape {
  return c.input instanceof z.ZodObject ? (c.input.shape as Shape) : {};
}

function baseType(t: z.ZodType): z.ZodType {
  let cur: z.ZodType = t;
  for (let i = 0; i < 6; i++) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable || cur instanceof z.ZodDefault)
      cur = cur.unwrap() as z.ZodType;
    else break;
  }
  return cur;
}

function coerce(t: z.ZodType | undefined, values: string[]): unknown {
  const b = t ? baseType(t) : undefined;
  const one = values[values.length - 1];
  if (b instanceof z.ZodArray) return values.flatMap((v) => (v.startsWith("[") ? JSON.parse(v) : v.split(",")));
  if (b instanceof z.ZodNumber) return Number(one);
  if (b instanceof z.ZodBoolean) return one !== "false" && one !== "0";
  if (b instanceof z.ZodObject || b instanceof z.ZodRecord) return JSON.parse(one);
  if (b instanceof z.ZodString || b instanceof z.ZodEnum) return one;
  try {
    return JSON.parse(one);
  } catch {
    return one;
  }
}

const camel = (s: string) => s.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

function inputFrom(c: Command, argv: string[]): { input: Record<string, unknown>; json: boolean; project?: string } {
  const declared: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = {
    project: { type: "string" },
    json: { type: "boolean" },
  };
  for (const [k, t] of Object.entries(shapeOf(c))) {
    const b = baseType(t);
    const flag = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const spec = b instanceof z.ZodBoolean ? { type: "boolean" as const } : { type: "string" as const };
    declared[flag] = b instanceof z.ZodArray ? { ...spec, multiple: true } : spec;
    if (flag !== k) declared[k] = declared[flag];
  }
  const { values, positionals, tokens } = parseArgs({
    options: declared,
    args: argv,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  const shape = shapeOf(c);
  const raw: Record<string, string[]> = {};
  for (const tok of tokens ?? []) {
    if (tok.kind !== "option") continue;
    const key = camel(tok.name);
    if (!raw[key]) raw[key] = [];
    raw[key].push(tok.value ?? "true");
  }
  const input: Record<string, unknown> = {};
  for (const [k, vs] of Object.entries(raw)) {
    if (k === "json" || k === "project") continue;
    // ponytail: `--rag.describe-figures=false` sets one key of an object input — PowerShell strips the quotes
    // of a JSON argument passed to a .cmd, so nested values must be writable without JSON
    if (k.includes(".")) {
      const [head, ...rest] = k.split(".");
      if (typeof input[head] !== "object" || input[head] === null) input[head] = {};
      let node = input[head] as Record<string, unknown>;
      for (const part of rest.slice(0, -1)) {
        if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
        node = node[part] as Record<string, unknown>;
      }
      const one = vs[vs.length - 1];
      node[rest[rest.length - 1]] = /^(true|false|null|-?\d+(\.\d+)?|\[.*\]|\{.*\})$/s.test(one)
        ? JSON.parse(one)
        : one;
      continue;
    }
    input[k] = coerce(shape[k], vs);
  }
  const pos = c.positional ?? [];
  positionals.forEach((p, i) => {
    const key = pos[Math.min(i, pos.length - 1)];
    if (!key) return;
    const b = shape[key] ? baseType(shape[key]) : undefined;
    if (b instanceof z.ZodArray) input[key] = [...((input[key] as unknown[]) ?? []), p];
    else input[key] = coerce(shape[key], [p]);
  });
  return {
    input,
    json: values.json === true,
    project: typeof values.project === "string" ? values.project : undefined,
  };
}

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
  const [first, second, ...rest] = argv;
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
  const name = camel(first.includes(".") ? first : `${first}.${second ?? ""}`);
  const args = first.includes(".") ? argv.slice(1) : rest;
  const c = find(name);
  const { input, json, project } = inputFrom(c, args);
  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
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
      onProgress: (p) =>
        !json && process.stderr.write(`${p.total ? `[${p.done ?? 0}/${p.total}] ` : ""}${p.message}\n`),
      onLog: (level, m) => !json && process.stderr.write(`${level}: ${m}\n`),
      onClaude: (e) => !json && e.type === "text" && process.stderr.write(e.text),
    });
    print(result, json);
    return 0;
  } finally {
    // ponytail: a command that started jobs without waiting (models usePack) lives until they end, then stops its servers
    for (const j of listJobs(resolveProjectDir(project)))
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

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e) => {
    report(e);
    process.exitCode = 1;
  },
);
