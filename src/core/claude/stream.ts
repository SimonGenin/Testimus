import type { ClaudeEvent } from "../types.ts";

function short(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? {});
  return s.length > 300 ? `${s.slice(0, 297)}...` : s;
}

export function eventsOf(line: string): ClaudeEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!m || typeof m !== "object") return [];
  if (m.type === "assistant") {
    const content = (m.message as { content?: unknown })?.content;
    if (!Array.isArray(content)) return [];
    const out: ClaudeEvent[] = [];
    for (const c of content as Record<string, unknown>[]) {
      if (c.type === "text" && typeof c.text === "string" && c.text) out.push({ type: "text", text: c.text });
      if (c.type === "tool_use") out.push({ type: "tool", name: String(c.name ?? ""), input: short(c.input) });
    }
    return out;
  }
  if (m.type === "result")
    return [
      {
        type: "result",
        ok: m.is_error !== true && (m.subtype === undefined || m.subtype === "success"),
        text: typeof m.result === "string" ? m.result : "",
        costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : undefined,
        sessionId: typeof m.session_id === "string" ? m.session_id : undefined,
        durationMs: typeof m.duration_ms === "number" ? m.duration_ms : 0,
      },
    ];
  return [];
}

// ponytail: lines may arrive whole, several per chunk, or cut in two — a line is parsed once it ends
export function streamParser(onEvent: (e: ClaudeEvent) => void): { push(chunk: string): void; end(): void } {
  let pending = "";
  const flush = (line: string) => {
    if (line.trim()) for (const e of eventsOf(line)) onEvent(e);
  };
  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const l of lines) flush(l);
      if (pending.trim().startsWith("{")) {
        try {
          JSON.parse(pending);
          flush(pending);
          pending = "";
        } catch {}
      }
    },
    end() {
      flush(pending);
      pending = "";
    },
  };
}

export type ToolCall = { name: string; input: Record<string, unknown>; result?: string; error?: boolean };

const resultText = (c: unknown): string =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((x) => (x && typeof x === "object" && typeof x.text === "string" ? x.text : "")).join("")
      : "";

// ponytail: the whole tool input and its result, from the full stdout — the live events are cut to 300 chars
export function toolCalls(stdout: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let m: { type?: unknown; message?: { content?: unknown } };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const content = m?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content as Record<string, unknown>[]) {
      if (m.type === "assistant" && c.type === "tool_use") {
        const input = c.input && typeof c.input === "object" ? (c.input as Record<string, unknown>) : {};
        const call: ToolCall = { name: String(c.name ?? ""), input };
        calls.push(call);
        if (typeof c.id === "string") byId.set(c.id, call);
      }
      if (m.type === "user" && c.type === "tool_result" && typeof c.tool_use_id === "string") {
        const call = byId.get(c.tool_use_id);
        if (!call) continue;
        call.result = resultText(c.content);
        call.error = c.is_error === true;
      }
    }
  }
  return calls;
}

const TEST_IN_PATH = /(?:^|[\\/])tests[\\/]+([^\\/]+)[\\/]/;

// ponytail: a test is the run's own when a call of the run wrote it — a file tool on its path, a tests_*
// tool with its id, or the id tests_create / tests_clone answered
export function writtenTests(calls: ToolCall[]): string[] {
  const out = new Set<string>();
  for (const c of calls) {
    if (c.error) continue;
    if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(c.name)) {
      const p = c.input.file_path ?? c.input.notebook_path;
      const id = typeof p === "string" ? p.match(TEST_IN_PATH)?.[1] : undefined;
      if (id) out.add(id);
    }
    if (/(^|_)tests_(edit|save|addImage|removeImage|create|clone)$/.test(c.name)) {
      if (!/_(create|clone)$/.test(c.name) && typeof c.input.id === "string") out.add(c.input.id);
      const made = c.result?.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
      if (/_(create|clone)$/.test(c.name) && made) out.add(made);
    }
  }
  return [...out].sort();
}

export const calledFor = (calls: ToolCall[], tool: string, id: string): boolean =>
  calls.some((c) => c.name.endsWith(`__${tool}`) && !c.error && c.input.id === id);

export function sessionOf(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const m = JSON.parse(line) as { session_id?: unknown };
      if (typeof m.session_id === "string") return m.session_id;
    } catch {}
  }
  return undefined;
}
