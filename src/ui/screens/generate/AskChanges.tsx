import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { CustomModel, cap, effortOptions, useModelChoice } from "../../components/claude/ModelPicker.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { UNTITLED_TEST, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { GenSuggestions } from "./GenSuggestions.tsx";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s6,
    paddingInline: space.s7,
    height: "100%",
    minHeight: 0,
    overflow: "auto",
  },
  head: { display: "flex", flexDirection: "column", gap: space.s1 },
  title: { margin: 0 },
  muted: { margin: 0, color: color.textMuted },
  request: { margin: 0, color: color.textMuted, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  picks: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: space.s3,
    borderWidth: 0,
    minWidth: 0,
  },
});

export type Scope = "all" | "add" | "pick";

export type AskInput = {
  generation: string;
  request: string;
  mode: "change" | "add";
  tests?: string[];
  model?: string;
  effort?: Effort;
};

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
// for more tests under the same generation — gen.revise; the original request stays folded (it may be pages long)
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
  const names = useTestNames();
  const [scope, setScope] = useState<Scope>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [model, setModel] = useState(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);
  const choice = useModelChoice(model, setModel);
  const request = shown.data?.request?.trim();
  const nothing = scope === "pick" && !picked.length ? "Pick the tests to change" : undefined;
  return (
    <section aria-label="Ask for changes" {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(type.titleSm, styles.title)}>Ask for changes</h2>
        <p {...stylex.props(type.small, styles.muted)}>On the {plural(tests.length, "test")} of this generation</p>
      </div>
      {request && (
        <Disclosure summary="The request" quiet>
          <p {...stylex.props(type.small, styles.request)}>{request}</p>
        </Disclosure>
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
          { value: "add", label: "Add tests" },
          { value: "pick", label: "Pick tests…" },
        ]}
        scopeValue={scope}
        onScope={(v) => setScope(v as Scope)}
        quickAsks={QUICK}
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
            ...(scope === "pick" ? { tests: picked } : {}),
            model,
            effort,
          })
        }
      >
        <CustomModel choice={choice} />
        {scope === "pick" && (
          <fieldset aria-label="Tests to change" {...stylex.props(styles.picks)}>
            {tests.map((id) => (
              <Checkbox
                key={id}
                label={names(id) ?? UNTITLED_TEST}
                checked={picked.includes(id)}
                onChange={(on) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)))}
              />
            ))}
          </fieldset>
        )}
      </ClaudeBlock>
      <GenSuggestions generation={generation} />
    </section>
  );
}
