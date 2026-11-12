import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { plural } from "../../lib/format.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Disclosure } from "../ui/Disclosure.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", gap: space.s2 },
  list: { margin: 0, padding: 0 },
});

// ponytail: what the jobs inside a batch are called, counted (« 81 conversions »)
const NOUN: Record<string, string> = {
  "docs.convert": "conversion",
  "rag-index": "index run",
  "describe-figures": "figure description",
};

// ponytail: a job waits its turn while its running step is the queue or its line says it waits
export const queuedJob = (j: Job) =>
  j.steps?.find((s) => s.status === "running")?.id === "queue" || /^Waiting\b/.test(j.message ?? "");

export function groupLine(kids: Job[]): string {
  const kinds = [...new Set(kids.map((k) => k.kind))];
  const noun = kinds.length === 1 ? (NOUN[kinds[0]] ?? "job") : "job";
  const done = kids.filter((k) => k.status !== "running").length;
  const queued = kids.filter((k) => k.status === "running" && queuedJob(k)).length;
  const running = kids.length - done - queued;
  const parts = [done ? `${done} done` : "", running ? `${running} running` : "", queued ? `${queued} queued` : ""];
  return `${plural(kids.length, noun)}: ${parts.filter(Boolean).join(", ")}`;
}

// ponytail: the jobs running inside one (a folder import's 81 conversions) are one line under it — how many are done,
// running and queued — and open on the running ones
export function ActivityGroup({ kids, running, children }: { kids: Job[]; running: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div {...stylex.props(styles.group)}>
      <Disclosure quiet summary={groupLine(kids)} open={open} onOpenChange={setOpen}>
        {!running && <span {...stylex.props(type.small)}>None of them is running now.</span>}
        <ul {...stylex.props(styles.list)}>{children}</ul>
      </Disclosure>
    </div>
  );
}
