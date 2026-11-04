import { useEffect, useRef } from "react";
import type { Job } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { onAnyEvent } from "../../lib/data/events.ts";
import { useCommand } from "../../lib/data/query.ts";
import {
  baseName,
  desktop,
  PROGRESS_KINDS,
  restoreAlwaysOnTop,
  showProject,
  type Tracked,
  taskbarFraction,
  tracked,
  windowTitle,
} from "../../lib/desktop.ts";
import { kindLabel, resultLine } from "../../lib/jobs.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { useRunningJobs } from "./Activity.tsx";

export function jobNotice(job: Job): { title: string; body: string } {
  const title = `${kindLabel(job.kind)} ${job.status === "failed" ? "failed" : "finished"}`;
  const body = [job.subject, resultLine(job)].filter(Boolean).join("\n");
  return { title: title.slice(0, 200), body: body.slice(0, 1000) };
}

// ponytail: what the page tells the desktop window — its title, the taskbar's progress of the long jobs, a
// notification when a job ends, a project handed by a second launch; in the browser only the title
export function DesktopBridge({ booted }: { booted: boolean }) {
  const app = useApp();
  const latest = useRef(app);
  latest.current = app;
  const p = app.info?.project;
  const name = p?.name || p?.jiraProject || (app.info?.dir ? baseName(app.info.dir) : "");
  const running = useRunningJobs();
  const open = useCommand("project.open", { invalidates: [["project.list"]] });
  const opening = useRef(open.mutateAsync);
  opening.current = open.mutateAsync;
  const jobs = useRef(new Map<string, Tracked>());
  const shown = useRef<number | null>(null);

  useEffect(() => {
    document.title = windowTitle(name);
  }, [name]);

  useEffect(() => {
    const d = desktop();
    if (!d || !booted) return;
    return d.onOpenProject((dir) => {
      opening
        .current({ dir })
        .then((r) => showProject(latest.current, r.dir))
        .then((opened) => {
          toast({ tone: "neutral", title: "Project opened", detail: opened });
          if (latest.current.route.screen === "setup") latest.current.navigate("documents");
        })
        .catch((e) => errorToast(e, "Could not open the project"));
    });
  }, [booted]);

  const show = () => {
    const d = desktop();
    const f = taskbarFraction([...jobs.current.values()]);
    if (!d || f === shown.current) return;
    shown.current = f;
    d.setProgress(f).catch(() => {});
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list of running jobs drives it; show reads refs
  useEffect(() => {
    if (!desktop()) return;
    const next = new Map<string, Tracked>();
    for (const j of running) if (PROGRESS_KINDS.has(j.kind)) next.set(j.id, jobs.current.get(j.id) ?? tracked(j));
    jobs.current = next;
    show();
  }, [running]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once — show reads refs
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    restoreAlwaysOnTop();
    const told = new Set<string>();
    const off = onAnyEvent((e) => {
      if (e.type === "progress") {
        const j = jobs.current.get(e.jobId);
        if (!j || !e.total) return;
        j.done = e.done ?? 0;
        j.total = e.total;
        show();
        return;
      }
      if (e.type !== "status" || e.job.status === "running") return;
      if (jobs.current.delete(e.job.id)) show();
      if (e.job.status === "cancelled" || told.has(e.job.id)) return;
      told.add(e.job.id);
      d.notify(jobNotice(e.job)).catch(() => {});
    });
    return () => {
      off();
      d.setProgress(null).catch(() => {});
    };
  }, []);

  return null;
}
