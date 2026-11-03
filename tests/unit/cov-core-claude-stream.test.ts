import { describe, expect, it } from "vitest";
import {
  calledFor,
  eventsOf,
  sessionOf,
  streamParser,
  tokensOf,
  toolCalls,
  writtenTests,
} from "../../src/core/claude/stream.ts";
import type { ClaudeEvent } from "../../src/core/types.ts";

const line = (m: unknown) => JSON.stringify(m);

describe("tokensOf", () => {
  it("adds cached input to input, ignores junk and reports nothing when nothing was counted", () => {
    expect(tokensOf(undefined)).toBeUndefined();
    expect(tokensOf("x")).toBeUndefined();
    expect(tokensOf({ input_tokens: 0, output_tokens: -3 })).toBeUndefined();
    expect(
      tokensOf({ input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: "9", output_tokens: 42 }),
    ).toEqual({ input: 210, output: 42 });
    const [r] = eventsOf(line({ type: "result", result: "ok", usage: { input_tokens: 5, output_tokens: 7 } }));
    expect(r).toMatchObject({ type: "result", tokens: { input: 5, output: 7 } });
  });
});

describe("eventsOf", () => {
  it("ignores lines that are not a JSON object or carry no content", () => {
    expect(eventsOf("not json")).toEqual([]);
    expect(eventsOf("null")).toEqual([]);
    expect(eventsOf("42")).toEqual([]);
    expect(eventsOf(line({ type: "assistant" }))).toEqual([]);
    expect(eventsOf(line({ type: "assistant", message: { content: "text" } }))).toEqual([]);
    expect(eventsOf(line({ type: "system", subtype: "init" }))).toEqual([]);
  });

  it("keeps non-empty text, names a nameless tool, cuts a long input and defaults a missing one", () => {
    const long = "x".repeat(400);
    const out = eventsOf(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "" },
            { type: "text", text: 3 },
            { type: "text", text: "hello" },
            { type: "tool_use" },
            { type: "tool_use", name: "Read", input: long },
          ],
        },
      }),
    );
    expect(out[0]).toEqual({ type: "text", text: "hello" });
    expect(out[1]).toEqual({ type: "tool", name: "", input: "{}" });
    expect(out[2].type === "tool" && out[2].input.length).toBe(300);
    expect(out[2].type === "tool" && out[2].input.endsWith("...")).toBe(true);
  });

  it("reads a result: failure subtypes, missing text, cost, session and duration", () => {
    expect(eventsOf(line({ type: "result", subtype: "error_max_turns" }))).toEqual([
      { type: "result", ok: false, text: "", costUsd: undefined, sessionId: undefined, durationMs: 0 },
    ]);
    expect(eventsOf(line({ type: "result", is_error: true, result: "boom" }))[0]).toMatchObject({
      ok: false,
      text: "boom",
    });
    expect(eventsOf(line({ type: "result", result: "ok" }))[0]).toMatchObject({ ok: true, text: "ok" });
  });
});

describe("streamParser", () => {
  it("parses cut lines, several lines per chunk, a complete JSON tail and flushes the rest at the end", () => {
    const seen: ClaudeEvent[] = [];
    const p = streamParser((e) => seen.push(e));
    const a = line({ type: "assistant", message: { content: [{ type: "text", text: "a" }] } });
    const b = line({ type: "assistant", message: { content: [{ type: "text", text: "b" }] } });
    p.push(`${a}\r\n${b.slice(0, 10)}`);
    expect(seen).toHaveLength(1);
    p.push(b.slice(10));
    expect(seen).toHaveLength(2);
    p.push("\n\n   \n");
    p.push('{"type":"res');
    expect(seen).toHaveLength(2);
    p.push('ult","result":"done"}');
    expect(seen).toHaveLength(3);
    p.push("trailing");
    p.end();
    expect(seen).toHaveLength(3);
    p.end();
  });
});

describe("toolCalls and writtenTests", () => {
  it("pairs results with calls, skips noise, flattens result arrays", () => {
    const stdout = [
      "",
      "plain text",
      "{broken",
      line({ type: "assistant" }),
      line({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "1", name: "mcp__testimus__tests_create", input: { summary: "s" } },
            { type: "tool_use", name: "Write", input: "not an object" },
            { type: "tool_use", id: "3" },
          ],
        },
      }),
      line({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: [{ type: "text", text: '{"id": "local-' }, null, 7, { text: 'aabbccdd"}' }],
            },
            { type: "tool_result", tool_use_id: "nope", content: "x" },
            { type: "tool_result", content: "no id" },
            { type: "tool_result", tool_use_id: "3", content: { odd: true }, is_error: true },
          ],
        },
      }),
    ].join("\n");
    const calls = toolCalls(stdout);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ result: '{"id": "local-aabbccdd"}', error: false });
    expect(calls[1]).toEqual({ name: "Write", input: {} });
    expect(calls[2]).toMatchObject({ name: "", result: "", error: true });
    expect(writtenTests(calls)).toEqual(["local-aabbccdd"]);
  });

  it("collects test ids from file tools, notebook paths and tests_* tools, ignoring failed calls", () => {
    expect(
      writtenTests([
        { name: "Write", input: { file_path: "C:\\p\\tests\\local-1\\test.md" } },
        { name: "NotebookEdit", input: { notebook_path: "tests/local-2/x.ipynb" } },
        { name: "Edit", input: { file_path: 5 } },
        { name: "Edit", input: { file_path: "docs/a/doc.md" } },
        { name: "mcp__testimus__tests_edit", input: { id: "LFRPS12-1" } },
        { name: "mcp__testimus__tests_save", input: {} },
        { name: "mcp__testimus__tests_clone", input: { id: "LFRPS12-1" }, result: "no id here" },
        { name: "mcp__testimus__tests_clone", input: {} },
        { name: "Write", input: { file_path: "tests/local-3/test.md" }, error: true },
        { name: "Read", input: { file_path: "tests/local-4/test.md" } },
      ]),
    ).toEqual(["LFRPS12-1", "local-1", "local-2"]);
  });

  it("calledFor matches the tool suffix, the id and success", () => {
    const calls = [
      { name: "mcp__testimus__tests_push", input: { id: "A" } },
      { name: "mcp__testimus__tests_push", input: { id: "B" }, error: true },
    ];
    expect(calledFor(calls, "tests_push", "A")).toBe(true);
    expect(calledFor(calls, "tests_push", "B")).toBe(false);
    expect(calledFor(calls, "tests_pull", "A")).toBe(false);
  });
});

describe("sessionOf", () => {
  it("returns the first session id, skipping bad lines, else undefined", () => {
    expect(
      sessionOf(["x", line({ session_id: 3 }), line({ session_id: "s1" }), line({ session_id: "s2" })].join("\n")),
    ).toBe("s1");
    expect(sessionOf("nothing\n{}")).toBeUndefined();
  });
});
