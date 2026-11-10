import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Disclosure } from "../../../components/ui/Disclosure.tsx";
import { Field } from "../../../components/ui/Field.tsx";
import { Segmented, type SegmentedOption } from "../../../components/ui/Segmented.tsx";
import { Select } from "../../../components/ui/Select.tsx";
import { type } from "../../../components/ui/type.ts";
import { color } from "../../../styles/tokens.stylex.ts";
import { Group, Row, Stack } from "../Section.tsx";
import { type Draft, type Retrieval, same } from "./draft.ts";
import { NumbersField } from "./NumbersField.tsx";

const styles = stylex.create({
  unit: { color: color.textMuted, whiteSpace: "nowrap" },
});

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

// ponytail: how the passages are ranked, in words, one row each — the numbers behind each choice and the reranker's
// depth are folded under Advanced
export function Ranking({ draft, reranker }: { draft: Draft; reranker: string | null }) {
  const r = draft.value as Retrieval;
  const fusion = pick(FUSION, r.rrfWeights);
  const codes = pick(CODES, r.bm25Weights[2]);
  const tops = TOPS.includes(r.rerank.top) ? TOPS : [...TOPS, r.rerank.top].sort((a, b) => a - b);
  return (
    <Group
      id="ranking"
      title="Ranking"
      actions={<Button size="sm" variant="quiet" label="Back to the defaults" onClick={draft.reset} />}
    >
      <Row>
        <Field aside label="Words or meaning" hint="How the word ranking and the model's ranking are mixed.">
          <div>
            <Segmented
              label="Words or meaning"
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
          </div>
        </Field>
      </Row>
      <Row>
        <Field aside label="Codes and ids" hint="An exact code (EXI_…, an alarm code) found first.">
          <div>
            <Segmented
              label="Weight of codes and ids"
              size="sm"
              value={codes}
              options={withCustom(
                [
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "First" },
                ],
                codes,
              )}
              onChange={(v) =>
                CODES[v] && draft.change({ bm25Weights: r.bm25Weights.map((w, j) => (j === 2 ? CODES[v] : w)) })
              }
            />
          </div>
        </Field>
      </Row>
      <Row>
        <Field aside label="Also bring" hint="What comes with each passage found.">
          <div>
            <Segmented
              label="Also bring"
              size="sm"
              value={r.expand}
              options={[
                { value: "none", label: "Nothing more" },
                { value: "section", label: "Its section" },
                { value: "graph", label: "Sections it cites" },
              ]}
              onChange={(expand) => draft.change({ expand })}
            />
          </div>
        </Field>
      </Row>
      <Row>
        <NumbersField
          aside
          label="Candidates"
          hint="More finds more, and is slower to rerank."
          trailing={<span {...stylex.props(type.small, styles.unit)}>per search</span>}
          values={[r.candidates]}
          count={[1, 1]}
          min={1}
          max={1000}
          integer
          onChange={([candidates]) => draft.change({ candidates })}
        />
      </Row>
      <Row>
        <Disclosure summary="Advanced: reranker depth, fusion weights" quiet>
          <Stack>
            <Select
              aside
              label="Reranker depth"
              showLabel
              block
              size="sm"
              hint={reranker ? "The reranker in use reorders the best candidates." : "Only with a reranker in use."}
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
            <NumbersField
              aside
              label="Fusion constant (rrfK)"
              hint="Higher: the lower ranks of each list count more."
              values={[r.rrfK]}
              count={[1, 1]}
              onChange={([rrfK]) => draft.change({ rrfK })}
            />
            <NumbersField
              aside
              label="Fusion weights · words, meaning"
              values={r.rrfWeights}
              count={[2, 2]}
              onChange={(rrfWeights) => draft.change({ rrfWeights })}
            />
            <NumbersField
              aside
              label="Word weights · title, text, codes, forms"
              hint="Forms: the French stems; 0 turns a column off."
              values={r.bm25Weights}
              count={[3, 4]}
              onChange={(bm25Weights) => draft.change({ bm25Weights })}
            />
          </Stack>
        </Disclosure>
      </Row>
    </Group>
  );
}
