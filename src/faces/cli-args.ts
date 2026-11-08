import { parseArgs } from "node:util";
import { z } from "zod";
import type { Command } from "../core/command.ts";

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
  if (b instanceof z.ZodArray) {
    const item = baseType(b.element as z.ZodType);
    const typed = item instanceof z.ZodNumber || item instanceof z.ZodBoolean;
    return values.flatMap((v) =>
      v.startsWith("[") ? JSON.parse(v) : v.split(",").map((x) => (typed ? coerce(item, [x]) : x)),
    );
  }
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

function leafType(t: z.ZodType | undefined, path: string[]): z.ZodType | undefined {
  let cur = t;
  for (const part of path) {
    const b = cur ? baseType(cur) : undefined;
    cur =
      b instanceof z.ZodObject
        ? (b.shape as Shape)[part]
        : b instanceof z.ZodRecord
          ? (b.valueType as z.ZodType)
          : undefined;
  }
  return cur;
}

// ponytail: a string key keeps its text as typed (a version 1.10, a code 007); any other key reads JSON when it is
function dotted(leaf: z.ZodType | undefined, one: string): unknown {
  if (leaf && baseType(leaf) instanceof z.ZodString && !(one === "null" && leaf.safeParse(null).success)) return one;
  if (!/^(true|false|null|-?\d+(\.\d+)?|\[.*\]|\{.*\})$/s.test(one)) return one;
  try {
    return JSON.parse(one);
  } catch {
    return one;
  }
}

const camel = (s: string) => s.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

export function inputFrom(
  c: Command,
  argv: string[],
): { input: Record<string, unknown>; json: boolean; project?: string; after?: string } {
  const declared: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = {
    project: { type: "string" },
    json: { type: "boolean" },
    after: { type: "string" },
  };
  for (const [k, t] of Object.entries(shapeOf(c))) {
    const b = baseType(t);
    const flag = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const spec = b instanceof z.ZodBoolean ? { type: "boolean" as const } : { type: "string" as const };
    declared[flag] = b instanceof z.ZodArray ? { ...spec, multiple: true } : spec;
    if (flag !== k) declared[k] = declared[flag];
  }
  // ponytail: `--semantic false` is the switch set to false, not a switch and a positional « false »
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const [a, next] = [argv[i], argv[i + 1]];
    const switchValue =
      a.startsWith("--") && declared[a.slice(2)]?.type === "boolean" && /^(true|false)$/.test(next ?? "");
    args.push(switchValue ? `${a}=${next}` : a);
    if (switchValue) i++;
  }
  const { values, positionals, tokens } = parseArgs({
    options: declared,
    args,
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
    if (k === "json" || k === "project" || (k === "after" && !shape.after)) continue;
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
      node[rest[rest.length - 1]] = dotted(leafType(shape[head], rest), vs[vs.length - 1]);
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
    after: !shape.after && typeof values.after === "string" ? values.after : undefined,
  };
}

// ponytail: `testimus tests set-folds …` and `testimus tests.setFolds …` name the same command
export function commandOf(argv: string[]): { name: string; args: string[] } {
  const [first = "", second, ...rest] = argv;
  const dotted = first.includes(".");
  return { name: camel(dotted ? first : `${first}.${second ?? ""}`), args: dotted ? argv.slice(1) : rest };
}
