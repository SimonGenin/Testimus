import { useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { Button } from "../ui/Button.tsx";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/Popover.tsx";
import { CustomModel, effortOptions, useModelChoice } from "./ModelPicker.tsx";
import type { DockJob } from "./useDockRuns.ts";

// ponytail: « Ask Claude » on a step or on the whole test — a Claude block in a popover; the run goes to the dock,
// where it is followed, shown and reverted like any other
export function AskClaude({
  testId,
  step,
  disabled,
}: {
  testId: string;
  /** a step's number; left out, the whole test */
  step?: number;
  /** true, or the reason (Claude is working, not connected) */
  disabled?: boolean | string;
}) {
  const app = useApp();
  const cfg = app.info?.project.claude;
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(cfg?.model ?? "opus");
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? "high");
  const choice = useModelChoice(model, setModel);
  const scope = step === undefined ? "Whole test" : `Step ${step}`;
  const presets = cfg?.presets ?? [];
  return (
    <Popover
      trigger={<Button size="sm" variant="claude-quiet" icon="claude" label="Ask Claude" disabled={disabled} />}
      title={`Ask Claude · ${scope}`}
      icon="claude"
      width="md"
      flush
      open={open}
      onOpenChange={setOpen}
      foot={
        <>
          <Icon name="info" size="sm" />
          Runs in the dock with this test's contexts
        </>
      }
    >
      <ClaudeBlock
        frameless
        ariaLabel={`Ask Claude about ${scope.toLowerCase()}`}
        placeholder={step === undefined ? "Ask Claude to change or explain this test…" : "Ask Claude about this step…"}
        value=""
        quickAsks={presets}
        model={{ value: choice.selected, options: choice.options, onChange: choice.pick }}
        effort={{ value: effort, options: effortOptions, onChange: (e) => setEffort(e as Effort) }}
        scope={scope}
        allowEmpty
        onSubmit={(prompt) => {
          const asked = presets.find((q) => q.prompt === prompt)?.label;
          const job: DockJob = {
            name: "claude.run",
            input: {
              scope: step === undefined ? { kind: "test", testId } : { kind: "step", testId, step },
              prompt,
              model: model || undefined,
              effort,
            },
            label: `${scope}${asked ? ` · ${asked}` : ""}`,
            text: prompt,
            testId,
          };
          app.runInDock(job);
          setOpen(false);
        }}
      >
        <CustomModel choice={choice} />
      </ClaudeBlock>
    </Popover>
  );
}
