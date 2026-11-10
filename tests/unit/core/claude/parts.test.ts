import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askAgainLines, askParts, type Part, pack, readBlock } from "../../../../src/core/claude/parts.ts";

const part = (id: string, size = 10): Part => ({ id, size });
const ids = (groups: Part[][]) => groups.map((g) => g.map((p) => p.id));
const LIMITS = { parts: 4, size: 100 };

type Run = { n: number; asked: string[]; again: boolean; ok: boolean };

function asker(answers: (p: Part, run: Run) => boolean, fails: (run: Run) => boolean = () => false) {
  const sent: Run[] = [];
  return {
    sent,
    run: async (parts: Part[], again: boolean): Promise<Run> => {
      const r: Run = { n: sent.length + 1, asked: parts.map((p) => p.id), again, ok: true };
      r.ok = !fails(r);
      sent.push(r);
      return r;
    },
    answered: (p: Part, r: Run) => r.ok && answers(p, r),
  };
}

describe("pack: the parts of a request", () => {
  it("go in order, a new request once the next part would pass the number or the size", () => {
    expect(
      ids(
        pack(
          ["a", "b", "c", "d", "e"].map((x) => part(x)),
          LIMITS,
        ),
      ),
    ).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(ids(pack([part("a", 60), part("b", 40), part("c", 1), part("d", 99)], LIMITS))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(pack([], LIMITS)).toEqual([]);
  });

  it("one part alone always goes, however large", () => {
    expect(ids(pack([part("big", 500), part("b", 10), part("huge", 900), part("c", 10)], LIMITS))).toEqual([
      ["big"],
      ["b"],
      ["huge"],
      ["c"],
    ]);
  });
});

describe("askParts: each part is answered on its own", () => {
  it("what came back is kept; what did not is asked once more, alone", async () => {
    const a = asker((p, r) => p.id !== "b" || r.again);
    const out = await askParts(
      ["a", "b", "c"].map((x) => part(x)),
      { limits: LIMITS, ...a },
    );
    expect(a.sent.map((r) => [r.asked, r.again])).toEqual([
      [["a", "b", "c"], false],
      [["b"], true],
    ]);
    expect(out.runs).toEqual(a.sent);
    expect(out.missing).toEqual([]);
    expect([...out.answeredBy].map(([id, r]) => [id, r.n])).toEqual([
      ["a", 1],
      ["c", 1],
      ["b", 2],
    ]);
    expect(out.lastOf.get("b")?.n).toBe(2);
  });

  it("a part still unanswered after its second ask is told, never asked a third time; the others stand", async () => {
    const a = asker((p) => p.id === "a");
    const out = await askParts(
      ["a", "b", "c"].map((x) => part(x)),
      { limits: LIMITS, ...a },
    );
    expect(a.sent.map((r) => r.asked)).toEqual([["a", "b", "c"], ["b"], ["c"]]);
    expect(out.missing.map((p) => p.id)).toEqual(["b", "c"]);
    expect([...out.answeredBy.keys()]).toEqual(["a"]);
    expect(out.lastOf.get("c")).toMatchObject({ n: 3, again: true });
  });

  it("a failed request is not sent again when retry says so: its parts are missing at once", async () => {
    const a = asker(
      () => true,
      (r) => r.asked.includes("e"),
    );
    const out = await askParts(
      ["a", "b", "c", "d", "e"].map((x) => part(x)),
      {
        limits: LIMITS,
        ...a,
        retry: (r) => r.ok,
      },
    );
    expect(a.sent.map((r) => r.asked)).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(out.missing.map((p) => p.id)).toEqual(["e"]);
    expect(out.answeredBy.size).toBe(4);
    expect(out.lastOf.get("e")?.ok).toBe(false);
  });

  it("the requests are run the way the caller says: several at a time, each still answered on its own", async () => {
    const a = asker(() => true);
    let together = 0;
    const out = await askParts(
      ["a", "b", "c", "d", "e", "f"].map((x) => part(x)),
      {
        limits: { parts: 2, size: 100 },
        ...a,
        all: (jobs) => {
          together = Math.max(together, jobs.length);
          return Promise.all(jobs.map((j) => j()));
        },
      },
    );
    expect(together).toBe(3);
    expect(out.runs.map((r) => r.asked)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    expect(out.answeredBy.size).toBe(6);
  });

  it("nothing to ask sends nothing", async () => {
    const a = asker(() => true);
    expect(await askParts([], { limits: LIMITS, ...a })).toEqual({
      runs: [],
      answeredBy: new Map(),
      lastOf: new Map(),
      missing: [],
    });
    expect(a.sent).toEqual([]);
  });
});

describe("readBlock: an answer written in the reply", () => {
  const SHAPE = z.object({ tests: z.array(z.string()).default([]), n: z.number().int().min(1) });
  const block = (tag: string, body: string) => `\`\`\`${tag}\n${body}\n\`\`\``;

  it("is the last fenced block with its tag, read against its schema", () => {
    const reply = [
      "Voici.",
      block("answer", '{"n": 1}'),
      block("json", '{"n": 7}'),
      block("other", '{"n": 9}'),
      "Corrigé :",
      block("answer", '{"n": 2, "tests": ["a"]}'),
      "Fin.",
    ].join("\n");
    expect(readBlock(reply, "answer", SHAPE)).toEqual({ found: true, value: { n: 2, tests: ["a"] }, errors: [] });
    expect(readBlock('``` answer the rest of the line\n{"n": 3}\n```', "answer", SHAPE).value).toEqual({
      n: 3,
      tests: [],
    });
  });

  it("no block with the tag: not found, and it says which block is missing", () => {
    expect(readBlock(`Done.\n${block("json", '{"n": 1}')}`, "answer", SHAPE)).toEqual({
      found: false,
      errors: ["no ```answer block in the reply"],
    });
  });

  it("a block that is not JSON, or does not fit, is found and named field by field — twelve problems at most", () => {
    const broken = readBlock(block("answer", "{n: 1}"), "answer", SHAPE);
    expect(broken.found).toBe(true);
    expect(broken.value).toBeUndefined();
    expect(broken.errors).toEqual([expect.stringMatching(/^the answer block is not valid JSON: /)]);

    expect(readBlock(block("answer", '{"n": 0, "tests": [1]}'), "answer", SHAPE)).toEqual({
      found: true,
      errors: ["tests.0: Invalid input: expected string, received number", "n: Too small: expected number to be >=1"],
    });
    expect(readBlock(block("answer", "[]"), "answer", SHAPE).errors).toEqual([
      "(block): Invalid input: expected object, received array",
    ]);
    const many = JSON.stringify({ n: 1, tests: Array.from({ length: 20 }, () => 0) });
    expect(readBlock(block("answer", many), "answer", SHAPE).errors).toHaveLength(12);
  });
});

describe("askAgainLines: what a reply that cannot be read is told", () => {
  it("one problem is said in the sentence, several are listed; only the block is asked for", () => {
    expect(askAgainLines("gen-report", ["no ```gen-report block in the reply"])).toBe(
      "Your reply cannot be read: no ```gen-report block in the reply.\nDo no other work: reply with the corrected ```gen-report block only, valid JSON, nothing after it.\n",
    );
    expect(askAgainLines("test-plan", ["tests.0.summary: too small", "tests.1: not an object"]).split("\n")).toEqual([
      "Your reply cannot be read: its block has these problems.",
      "- tests.0.summary: too small",
      "- tests.1: not an object",
      "Do no other work: reply with the corrected ```test-plan block only, valid JSON, nothing after it.",
      "",
    ]);
  });
});
