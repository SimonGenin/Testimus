import type { z } from "zod";

// ponytail: one request to Claude carries as many parts as fit (four tests to check, and what to say about the
// generation they come from), and each part is answered on its own — through a command of the app or in a block of
// the reply. What came back is kept; what did not is asked once more, alone; a part still unanswered then is told to
// whoever asked. A request never fails whole because one of its parts did

export type Part = {
  id: string;
  /** what this part costs the request: the characters Claude reads for it */
  size: number;
};

export type Limits = { parts: number; size: number };

// ponytail: in order, a new request once the next part would pass either limit — one part alone always goes
export function pack<P extends Part>(parts: P[], limits: Limits): P[][] {
  const out: P[][] = [];
  let size = 0;
  for (const p of parts) {
    const last = out.at(-1);
    if (!last || last.length >= limits.parts || size + p.size > limits.size) {
      out.push([p]);
      size = p.size;
    } else {
      last.push(p);
      size += p.size;
    }
  }
  return out;
}

export type Asked<P extends Part, R> = {
  /** every request sent, the second ones too */
  runs: R[];
  /** the request that answered each part */
  answeredBy: Map<string, R>;
  /** the last request each part went with, answered or not */
  lastOf: Map<string, R>;
  missing: P[];
};

export async function askParts<P extends Part, R>(
  parts: P[],
  o: {
    limits: Limits;
    /** sends one request for these parts; again is true for the parts asked a second time */
    run(parts: P[], again: boolean): Promise<R>;
    answered(part: P, run: R): boolean;
    /** false stops the second ask: a failed or cancelled run would fail again */
    retry?(run: R): boolean;
    /** how the requests are run: one after the other by default */
    all?<T>(jobs: (() => Promise<T>)[]): Promise<T[]>;
  },
): Promise<Asked<P, R>> {
  const all =
    o.all ??
    (async <T>(jobs: (() => Promise<T>)[]) => {
      const out: T[] = [];
      for (const j of jobs) out.push(await j());
      return out;
    });
  const out: Asked<P, R> = { runs: [], answeredBy: new Map(), lastOf: new Map(), missing: [] };
  const send = async (groups: P[][], again: boolean): Promise<P[]> => {
    const left: P[] = [];
    const runs = await all(groups.map((g) => () => o.run(g, again)));
    runs.forEach((r, k) => {
      out.runs.push(r);
      for (const p of groups[k]) {
        out.lastOf.set(p.id, r);
        if (o.answered(p, r)) out.answeredBy.set(p.id, r);
        else if (again || (o.retry && !o.retry(r))) out.missing.push(p);
        else left.push(p);
      }
    });
    return left;
  };
  const left = await send(pack(parts, o.limits), false);
  if (left.length)
    await send(
      left.map((p) => [p]),
      true,
    );
  return out;
}

const BLOCK = /```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g;

export type Block<T> = { found: boolean; value?: T; errors: string[] };

// ponytail: an answer written in the reply is the last fenced block with its tag, read against its schema — what does
// not fit is named field by field, so Claude can be asked again for exactly that
export function readBlock<T>(reply: string, tag: string, schema: z.ZodType<T>): Block<T> {
  const blocks = [...reply.matchAll(BLOCK)].filter((b) => b[1] === tag);
  const last = blocks.at(-1);
  if (!last) return { found: false, errors: [`no \`\`\`${tag} block in the reply`] };
  let raw: unknown;
  try {
    raw = JSON.parse(last[2]);
  } catch (e) {
    return { found: true, errors: [`the ${tag} block is not valid JSON: ${e instanceof Error ? e.message : e}`] };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { found: true, value: r.data, errors: [] };
  return {
    found: true,
    errors: r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(block)"}: ${i.message}`),
  };
}

export const askAgainLines = (tag: string, errors: string[]): string =>
  [
    `Your reply cannot be read: ${errors.length === 1 ? errors[0] : "its block has these problems"}.`,
    ...(errors.length > 1 ? errors.map((e) => `- ${e}`) : []),
    `Do no other work: reply with the corrected \`\`\`${tag} block only, valid JSON, nothing after it.`,
    "",
  ].join("\n");
