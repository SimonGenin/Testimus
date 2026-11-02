import { useEffect, useRef } from "react";
import type { Job } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import {
  baseName,
  desktop,
  openProject,
  PROGRESS_KINDS,
  restoreAlwaysOnTop,
  type Tracked,
  taskbarFraction,
  tracked,
  windowTitle,
} from "../../lib/desktop.ts";
import { kindLabel, resultLine } from "../../lib/jobs.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export function jobNotice(job: Job): { title: string; body: string } {
  const title = `${kindLabel(job.kind)} ${job.status === "failed" ? "failed" : "finished"}`;
  const body = [job.subject, resultLine(job)].filter(Boolean).join("\n");
  return { title: title.slice(0, 200), body: body.slice(0, 1000) };
}

export function DesktopBridge({ booted }: { booted: boolean }) {
  const app = useApp();
  const latest = useRef(app);
  latest.current = app;
  const p = app.info?.project;
  const name = p?.name || p?.jiraProject || (app.info?.dir ? baseName(app.info.dir) : "");

  useEffect(() => {
    document.title = windowTitle(name);
  }, [name]);

  useEffect(() => {
    const d = desktop();
    if (!d || !booted) return;
    return d.onOpenProject((dir) => {
      openProject(latest.current, dir)
        .then((opened) => {
          toast({ kind: "info", title: "Project opened", detail: opened });
          if (latest.current.route.screen === "setup") latest.current.navigate("documents");
        })
        .catch((e) => errorToast(e, "Could not open the project"));
    });
  }, [booted]);

  useEffect(() => {
    const d = desktop();
    if (!d) return;
    restoreAlwaysOnTop();
    const jobs = new Map<string, Tracked>();
    const told = new Set<string>();
    let shown: number | null | undefined;
    const show = () => {
      const f = taskbarFraction([...jobs.values()]);
      if (f === shown) return;
      shown = f;
      d.setProgress(f).catch(() => {});
    };
    call<Job[]>("jobs.list", { running: true })
      .then((list) => {
        for (const j of list ?? [])
          if (j.status === "running" && PROGRESS_KINDS.has(j.kind) && !jobs.has(j.id)) jobs.set(j.id, tracked(j));
        show();
      })
      .catch(() => {});
    const off = events((e) => {
      if (e.type === "progress") {
        const j = jobs.get(e.jobId);
        if (!j || !e.total) return;
        j.done = e.done ?? 0;
        j.total = e.total;
        show();
        return;
      }
      if (e.type !== "status") return;
      const job = e.job;
      if (job.status === "running") {
        if (!PROGRESS_KINDS.has(job.kind)) return;
        jobs.set(job.id, tracked(job));
        show();
        return;
      }
      if (jobs.delete(job.id)) show();
      if (job.status === "cancelled" || told.has(job.id)) return;
      told.add(job.id);
      d.notify(jobNotice(job)).catch(() => {});
    });
    return () => {
      off();
      d.setProgress(null).catch(() => {});
    };
  }, []);

  return null;
}
