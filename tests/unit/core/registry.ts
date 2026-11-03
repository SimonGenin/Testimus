import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { find, type InvokeOpts, invoke } from "../../../src/core/commands/index.ts";

export const FIXTURE = resolve(import.meta.dirname, "../../fixtures/project");

export function fixtureCopy(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `testimus-${tag}-`));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

// ponytail: every call goes through the registry (parseInput, the open-project check, the job start) and its result
// must pass the command's own output schema (GOAL-V3 N1: a typed output)
export async function call<T = unknown>(
  name: string,
  input: unknown,
  project: string | null,
  opts: Omit<InvokeOpts, "project"> = {},
): Promise<T> {
  const out = await invoke(name, input, { ...opts, project });
  const parsed = find(name).output.safeParse(out);
  if (!parsed.success)
    throw new Error(`${name} output does not pass its schema: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`);
  return out as T;
}
