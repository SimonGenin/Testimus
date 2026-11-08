import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Disclosure } from "../../../components/ui/Disclosure.tsx";
import { Field } from "../../../components/ui/Field.tsx";
import { Segmented, type SegmentedOption } from "../../../components/ui/Segmented.tsx";
import { Select } from "../../../components/ui/Select.tsx";
import { Grid, Stack } from "../Section.tsx";
import { type Draft, type Retrieval, same } from "./draft.ts";
import { NumbersField } from "./NumbersField.tsx";

const FUSION: Record<string, number[]> = { words: [2, 1], balanced: [1, 1], meaning: [1, 2] };
const CODES: Record<string, number> = { normal: 1, high: 5 };
const TOPS = [10, 20, 30, 50];
const CUSTOM = { value: "custom", label: "Custom", disabled: "Set in Advanced" } as const;

function pick<V>(table: Record<string, V>, value: V): string {
  return Object.entries(table).find(([, v]) => same(v, value))?.[0] ?? "custom";
}

function withCustom<V extends string>(options: SegmentedOption<V>[], chosen: string): SegmentedOption<string>[] {
  return chosen === "custom" ? [...options, CUSTOM] : options;
}

const rerankValue = (r: Retrieval) => (r.rerank.mode === "threshold" ? "threshold" : `top:${r.rerank.top}`);

// ponytail: how the passages are ranked, in words — the numbers behind each choice are under Advanced
export function Ranking({ draft, reranker }: { draft: Draft; reranker: string | null }) {
  const r = draft.value as Retrieval;
  const fusion = pick(FUSION, r.rrfWeights);
  const codes = pick(CODES, r.bm25Weights[2]);
  const tops = TOPS.includes(r.rerank.top) ? TOPS : [...TOPS, r.rerank.top].sort((a, b) => a - b);
  const weights = (i: number, v: number) => r.bm25Weights.map((w, j) => (j === i ? v : w));
  return (
    <Card title="Ranking" actions={<Button size="sm" variant="quiet" label="Reset ranking" onClick={draft.reset} />}>
      <Stack>
        <Grid>
          <NumbersField
            label="Candidates per search"
            hint="More finds more, slower to rerank."
            values={[r.candidates]}
            count={[1, 1]}
            min={1}
            max={1000}
            integer
            onChange={([candidates]) => draft.change({ candidates })}
          />
          <Field label="Words vs meaning" hint="How the word ranking and the model's ranking are fused.">
            <Segmented
              label="Words vs meaning"
              size="sm"
              value={fusion}
              options={withCustom(
                [
                  { value: "words", label: "Words" },
                  { value: "balanced", label: "Balanced" },
                  { value: "meaning", label: "Meaning" },
                ],
                fusion,
              )}
              onChange={(v) => FUSION[v] && draft.change({ rrfWeights: FUSION[v] })}
            />
          </Field>
          <Field label="Weight of codes and ids" hint="An exact code (EXI_…, alarm code) found first.">
            <Segmented
              label="Weight of codes and ids"
              size="sm"
              value={codes}
              options={withCustom(
                [
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                ],
                codes,
              )}
              onChange={(v) => CODES[v] && draft.change({ bm25Weights: weights(2, CODES[v]) })}
            />
          </Field>
          <Select
            label="Reranker"
            showLabel
            block
            size="sm"
            hint={reranker ? "The pack's reranker reorders the best candidates." : "Only when the pack has one."}
            disabled={reranker ? false : "The models in use have none"}
            value={rerankValue(r)}
            options={[
              ...tops.map((top) => ({ value: `top:${top}`, label: `Top ${top}` })),
              { value: "threshold", label: "Above its threshold", hint: "The threshold the benchmark set for it" },
            ]}
            onChange={(v) =>
              draft.change({
                rerank:
                  v === "threshold"
                    ? { ...r.rerank, mode: "threshold" }
                    : { ...r.rerank, mode: "topk", top: Number(v.slice(4)) },
              })
            }
          />
        </Grid>
        <Field label="Also bring">
          <Segmented
            label="Also bring"
            size="sm"
            value={r.expand}
            options={[
              { value: "none", label: "Nothing more" },
              { value: "section", label: "The parent section" },
              { value: "graph", label: "Referenced sections" },
            ]}
            onChange={(expand) => draft.change({ expand })}
          />
        </Field>
        <Disclosure summary="Advanced" quiet>
          <Grid>
            <NumbersField
              label="Fusion constant (rrfK)"
              hint="Higher: the lower ranks of each list count more."
              values={[r.rrfK]}
              count={[1, 1]}
              onChange={([rrfK]) => draft.change({ rrfK })}
            />
            <NumbersField
              label="Fusion weights · words, meaning"
              values={r.rrfWeights}
              count={[2, 2]}
              onChange={(rrfWeights) => draft.change({ rrfWeights })}
            />
            <NumbersField
              label="Word weights · title, text, codes, forms"
              hint="Forms: the French stems; 0 turns a column off."
              values={r.bm25Weights}
              count={[3, 4]}
              onChange={(bm25Weights) => draft.change({ bm25Weights })}
            />
          </Grid>
        </Disclosure>
      </Stack>
    </Card>
  );
}
