import type { JobEvent } from "../../../core/types.ts";
import { clock, logLines } from "../../lib/jobs.ts";
import { Raw } from "../ui/Raw.tsx";

// ponytail: a job's log as it comes, kept scrolled to the end unless the reader scrolled up
export function JobLog({ events: list, label = "Live log" }: { events: JobEvent[]; label?: string }) {
  const lines = logLines(list).map((l) => ({ text: l.text, level: l.level, at: clock(l.at) }));
  return <Raw lines={lines} follow maxLines={24} label={label} empty="Nothing logged yet." />;
}
