import { useEffect, useState } from "react";
import type { AgentsMeasure, Settings } from "../../../core/types.ts";
import { call, run } from "../../api.ts";
import { Button } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { errorToast, toast } from "../../lib/toast.ts";

const DEFAULT = 5;
const CAP = 32;

type Tested = AgentsMeasure & { applied: boolean };

export const measureLine = (m: AgentsMeasure) =>
  `${m.limit} agent${m.limit > 1 ? "s" : ""} on ${new Date(m.at).toLocaleDateString("en-GB")} — ${m.reason}`;

export function AgentsField({ s, setS }: { s: Settings | null; setS: (s: Settings) => void }) {
  const app = useApp();
  const [max, setMax] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const saved = s ? (s.agents?.max ?? DEFAULT) : null;
  useEffect(() => {
    if (saved !== null) setMax(String(saved));
  }, [saved]);

  const save = async (patch: Record<string, unknown>) => {
    const r = await call<Settings>("system.saveSettings", patch).catch((e) => {
      errorToast(e, "Could not save the settings");
      return null;
    });
    if (r) {
      setS(r);
      setMax(String(r.agents?.max ?? DEFAULT));
    }
  };
  const commit = () => {
    const n = Math.round(Number(max));
    if (!Number.isFinite(n) || n < 1 || n > CAP) return setMax(String(s?.agents?.max ?? DEFAULT));
    if (n !== (s?.agents?.max ?? DEFAULT)) void save({ agentsMax: n });
  };
  const test = async () => {
    setTesting("Measuring the PC at rest");
    try {
      const r = await run<Tested>(
        "system.testAgents",
        {},
        (e) => e.type === "progress" && setTesting(e.message),
        setJobId,
      );
      toast({
        kind: "ok",
        title: r.applied ? `Maximum set to ${r.limit} agents` : `This PC holds ${r.limit} agents`,
        detail: r.reason,
      });
      setS(await call<Settings>("system.settings", {}));
    } catch (e) {
      errorToast(e, "The test of this PC's limits stopped");
    } finally {
      setTesting(null);
      setJobId(null);
    }
  };
  const measured = s?.agents?.measured;

  return (
    <div className="formfield agents">
      <span className="label" id="set-agents-label">
        Agents at the same time
      </span>
      <div className="pickrow agents-row">
        <input
          id="set-agents-max"
          className="field agents-max"
          type="number"
          min={1}
          max={CAP}
          aria-labelledby="set-agents-label"
          disabled={!s}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <label className="agents-adapt">
          <input
            type="checkbox"
            checked={s?.agents?.adaptive ?? true}
            disabled={!s}
            onChange={(e) => void save({ agentsAdaptive: e.target.checked })}
          />{" "}
          Adapt to the PC's load
        </label>
        <Button size="sm" disabled={!!testing || !app.info} onClick={() => void test()}>
          {testing ? "Testing…" : "Test this PC's limits"}
        </Button>
        {testing && (
          <Button
            tone="quiet"
            size="sm"
            disabled={!jobId}
            onClick={() => jobId && call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel"))}
          >
            Cancel
          </Button>
        )}
      </div>
      {testing && (
        <span className="muted" role="status">
          {testing}
        </span>
      )}
      <span className="muted">
        The most Claude runs a generation or a check starts at once. Adapting, Testimus starts with 2 and adds one while
        the CPU and the memory have room; while the PC is busy it starts none, and lets one finish without a successor
        when it struggles. The test starts the project's search server again and again, as each agent does, until the
        CPU, the memory or the search time says stop — a few minutes, no Claude credit spent.
      </span>
      {measured && <span className="muted agents-measured">Last test: {measureLine(measured)}</span>}
    </div>
  );
}
