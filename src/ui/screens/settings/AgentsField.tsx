import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { AgentsMeasure } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { useCancel, useJob, useRunning } from "./jobs.ts";
import { useSetSettings, useSetting, useSettings } from "./machine.ts";
import { Fact, Hint, Row } from "./Section.tsx";

const styles = stylex.create({
  row: { display: "flex", alignItems: "center", gap: space.s4, flexWrap: "wrap" },
});

const DEFAULT = 5;
const CAP = 32;

type Tested = AgentsMeasure & { applied: boolean };

export const measureLine = (m: AgentsMeasure) =>
  `${m.limit} agent${m.limit > 1 ? "s" : ""} on ${new Date(m.at).toLocaleDateString("en-GB")} — ${m.reason}`;

const MAX_KEY: Key = [null, "system.settings", { field: "agentsMax" }];
const jobKey = (): Key => [project(), "settings.agents", { f: "job" }];

const valid = (typed: string) => {
  const n = Math.round(Number(typed));
  return typed.trim() !== "" && Number.isFinite(n) && n >= 1 && n <= CAP ? n : null;
};

function AgentsTest({ jobId, onEnd }: { jobId: string; onEnd: () => void }) {
  const cancel = useCancel();
  const { live } = useJob(jobId, (job) => {
    onEnd();
    if (job.status === "done") {
      const r = job.result as Tested;
      toast({
        tone: "success",
        title: r.applied ? `Maximum set to ${r.limit} agents` : `This PC holds ${r.limit} agents`,
        detail: r.reason,
      });
    } else if (job.status === "failed")
      errorToast(new Error(job.error ?? "The test failed."), "The test of this PC's limits stopped");
  });
  return (
    <div {...stylex.props(styles.row)}>
      <Hint>
        <span role="status">{live.message === "Starting" ? "Measuring the PC at rest" : live.message}</span>
      </Hint>
      <Button size="sm" variant="quiet" icon="stop" label="Cancel" onClick={() => cancel(jobId)} />
    </div>
  );
}

// ponytail: the most Claude runs at once — typed, saved when the field is left; the test is a job (system.testAgents)
// whose end the event bridge reports, settings.json re-read with it; a test still running when the section opens again
// is found in jobs.list (it cannot be started twice)
export function AgentsField() {
  const app = useApp();
  const client = useQueryClient();
  const settings = useSettings();
  const setSettings = useSetSettings();
  const setting = useSetting();
  const [starting, setStarting] = useState(false);
  const [kept, setJob, clearJob] = useDraft(jobKey());
  const ended = useRef(new Set<string>());
  const found = useRunning("agents-test", !!app.info);
  const jobId = kept || (found && !ended.current.has(found.id) ? found.id : null);
  const [typed, setTyped] = useState<string | null>(null);
  const s = settings.data;
  const saved = s?.agents?.max ?? DEFAULT;

  const test = async () => {
    setStarting(true);
    try {
      const { jobId: id } = await execute(client, "system.testAgents", {}, { invalidates: [["jobs.list"]] });
      setJob(id);
    } catch (e) {
      errorToast(e, "The test of this PC's limits stopped");
    } finally {
      setStarting(false);
    }
  };

  const measured = s?.agents?.measured;
  const testing = starting || !!jobId;
  return (
    <>
      <Row>
        <Text
          aside
          id="settings-claude-agents"
          label="Agents at once"
          hint={`The most Claude runs a generation or a check starts together. From 1 to ${CAP}.`}
          value={String(saved)}
          saveKey={MAX_KEY}
          delay="blur"
          disabled={!s}
          onChange={setTyped}
          error={typed !== null && valid(typed) === null ? `A number from 1 to ${CAP}` : undefined}
          save={async (value) => {
            const n = valid(value);
            if (n === null) throw new Error(`A number from 1 to ${CAP}`);
            if (n !== saved) await setSettings({ agentsMax: n });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLElement).blur();
          }}
        />
      </Row>
      <Row>
        <Field
          aside
          label="Follow the PC's load"
          hint="Starts with 2 and adds one while the processor and the memory have room; starts none while the PC is busy."
        >
          <div>
            <Switch
              label="Adapt to the PC's load"
              on={s?.agents?.adaptive ?? true}
              disabled={!s}
              onChange={(on) => void setting({ agentsAdaptive: on })}
            />
          </div>
        </Field>
      </Row>
      <Row>
        <Fact
          label="This PC's limits"
          hint="Starts the project's search server again and again, as agents do, until the processor, the memory or the search time says stop. A few minutes, no Claude credit."
        >
          <div {...stylex.props(styles.row)}>
            <Button
              size="sm"
              icon="cpu"
              label={testing ? "Testing…" : "Test this PC's limits"}
              disabled={!app.info ? "Open a project first: the test searches its index" : testing}
              onClick={() => void test()}
            />
            {!jobId && <Hint>{measured ? `Last test: ${measureLine(measured)}` : "Not tested yet."}</Hint>}
          </div>
          {jobId && (
            <AgentsTest
              jobId={jobId}
              onEnd={() => {
                ended.current.add(jobId);
                clearJob();
              }}
            />
          )}
        </Fact>
      </Row>
    </>
  );
}
