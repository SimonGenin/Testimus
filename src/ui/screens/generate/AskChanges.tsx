import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { cap, effortOptions, useModelChoice } from "../../components/claude/ModelPicker.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { GenSuggestions } from "./GenSuggestions.tsx";
import { PickTests } from "./PickTests.tsx";
import { useGenFixes } from "./useGenFixes.ts";

const styles = stylex.create({
  pane: { boxSizing: "border-box", height: "100%", minHeight: 0, overflowY: "auto" },
  stack: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s6,
    paddingInline: space.s7,
  },
  head: { display: "flex", flexDirection: "column", gap: space.s1 },
  title: { margin: 0 },
  muted: { margin: 0, color: color.textMuted },
  line: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    color: color.textMuted,
  },
  request: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
});

export type Scope = "all" | "fixes" | "add" | "pick";

export type AskInput = {
  generation: string;
  request: string;
  mode: "change" | "add";
  tests?: string[];
  model?: string;
  effort?: Effort;
};

// ponytail: what anyone may ask after a generation — shown until Claude wrote this generation's own (gen.show
// suggestions, at the end of its last run)
const QUICK = [
  { label: "Add the negative paths", prompt: "Add the negative paths the documents describe and the tests leave out." },
  { label: "Split steps longer than 15", prompt: "Split a test longer than 15 steps where it splits cleanly." },
  { label: "Use the project's wording", prompt: "Use the words of the documents and of the project's tests." },
  {
    label: "Cover the skipped items",
    prompt: "Write tests for the items not written, where a source now supports them.",
    scope: "add",
  },
];

// ponytail: after a generation, its column asks Claude for changes on the tests it wrote (all, or the ones picked) or
// for more tests under the same generation — gen.revise; the original request opens in a dialog (it may be pages long),
// the fixes Claude proposes sit on their tests' cards and are only counted here
export function AskChanges({
  generation,
  running,
  unavailable,
  defaults,
  onAsk,
}: {
  generation: string;
  /** seconds since the revision started, while it runs */
  running: number | null;
  unavailable?: string;
  defaults: { model: string; effort: Effort };
  onAsk: (input: AskInput) => void;
}) {
  const shown = useRead("gen.show", { generation });
  const tests = shown.data?.tests ?? [];
  const [scope, setScope] = useState<Scope>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [model, setModel] = useState(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);
  const choice = useModelChoice(model, setModel);
  const fixes = useGenFixes(generation);
  const [reading, setReading] = useState(false);
  const request = shown.data?.request?.trim();
  const suggestions = shown.data?.suggestions ?? [];
  const nothing = scope === "pick" && !picked.length ? "Pick the tests to change" : undefined;
  return (
    <section aria-label="Ask for changes" {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.head)}>
          <h2 {...stylex.props(type.titleSm, styles.title)}>Ask for changes</h2>
          <p {...stylex.props(type.small, styles.line)}>
            <span>On the {plural(tests.length, "test")} of this generation</span>
            {request && <Button size="sm" variant="link" label="Read the request" onClick={() => setReading(true)} />}
          </p>
        </div>
        {reading && request && (
          <Modal title="The request" subtitle="What this generation was asked" onClose={() => setReading(false)}>
            <p {...stylex.props(type.reading, styles.request)}>{request}</p>
          </Modal>
        )}
        <ClaudeBlock
          id="gen-revise"
          ariaLabel="What should change?"
          value=""
          placeholder={
            scope === "add"
              ? "What tests should be added? e.g. « les cas où la TK est en défaut »"
              : "What should change? e.g. « ajoute les cas où la TK est en défaut »"
          }
          scopes={[
            { value: "all", label: `All ${plural(tests.length, "test")}` },
            ...(fixes.tests.length ? [{ value: "fixes", label: `The ${fixes.tests.length} with a fix` }] : []),
            picked.length
              ? { value: "pick", label: `${plural(picked.length, "test")} picked` }
              : { value: "pick", label: "Pick tests…", hint: "Opens the picker" },
            ...(picked.length ? [{ value: "repick", label: "Change the picked tests…" }] : []),
            { value: "add", label: "New tests", hint: "Under this generation" },
          ]}
          scopeValue={scope}
          onScope={(v) => {
            if (v === "repick" || (v === "pick" && !picked.length)) setPicking(true);
            else setScope(v as Scope);
          }}
          quickAsks={suggestions.length ? suggestions : QUICK}
          model={{
            value: choice.selected,
            shown: cap(model),
            options: choice.options,
            onChange: choice.pick,
          }}
          effort={{ value: effort, options: effortOptions, onChange: (e) => setEffort(e as Effort) }}
          submitLabel="Ask Claude"
          running={running}
          unavailable={unavailable ?? nothing}
          onSubmit={(prompt) =>
            onAsk({
              generation,
              request: prompt,
              mode: scope === "add" ? "add" : "change",
              ...(scope === "pick" ? { tests: picked } : scope === "fixes" ? { tests: fixes.tests } : {}),
              model,
              effort,
            })
          }
        ></ClaudeBlock>
        {picking && (
          <PickTests
            tests={tests}
            fixes={fixes.tests}
            picked={picked}
            onClose={() => setPicking(false)}
            onPick={(ids) => {
              setPicked(ids);
              setScope("pick");
              setPicking(false);
            }}
          />
        )}
        <GenSuggestions fixes={fixes} />
      </div>
    </section>
  );
}
