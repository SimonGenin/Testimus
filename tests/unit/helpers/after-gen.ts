import { NEXT_MARKER } from "../../../src/core/claude/gen-next.ts";
import type { ClaudeOut, ClaudeSpawn } from "../../../src/core/env.ts";

// ponytail: the run after a generation (claude/gen-next.ts) is not the generation's — a test's scripted Claude writes
// tests on a generation prompt, and answers this one apart, with no block (the core's own fixes follow) and no side effect
export const isAfterGen = (s: ClaudeSpawn) => s.stdin.startsWith(NEXT_MARKER);

export function afterGenOut(s: ClaudeSpawn, text = "Nothing to propose."): ClaudeOut {
  const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 5 });
  s.onLine?.(l);
  return { code: 0, stdout: `${l}\n`, stderr: "" };
}
