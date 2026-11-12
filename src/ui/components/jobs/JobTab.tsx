import { useEffect } from "react";
import type { Screen } from "../../lib/app.ts";
import { useBar } from "../../lib/workspace/signals.ts";
import { useSideTab } from "../ui/workspace/useSideTab.tsx";
import { JobPanel } from "./JobPanel.tsx";

export const JOB_TAB = "job";

// ponytail: a job opened anywhere is read in the Job tab of the screen shown — beside the work, never over it, as a
// source is; a screen without sections (Setup) shows it in a dialog
export function JobTab({
  opened,
  onClose,
  onGo,
}: {
  /** a new object each time a job is opened, so the same job opened again is shown again */
  opened: { id: string } | null;
  onClose: () => void;
  onGo: (screen: Screen, id?: string) => void;
}) {
  const bar = useBar();
  const panel = (frame: "modal" | "tab") =>
    opened && <JobPanel key={opened.id} id={opened.id} frame={frame} onClose={onClose} onGo={onGo} />;
  const side = useSideTab({ id: JOB_TAB, label: "Job", icon: "jobs" }, !!opened && !!bar, panel("tab"), bar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: shown each time a job is opened, not at each change of the sections
  useEffect(() => {
    if (opened) side.reveal();
  }, [opened]);
  return bar ? side.node : panel("modal");
}
