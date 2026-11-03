import { existsSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import type { DoctorAction, DoctorCheck } from "../types.ts";

// ponytail: one row of the doctor, and what every group of checks shares to write one

const GB = 1024 ** 3;

export function row(
  id: string,
  label: string,
  state: DoctorCheck["state"],
  detail: string,
  fix?: string,
  action?: DoctorAction,
): DoctorCheck {
  if (state === "ok") return { id, label, state, detail };
  return { id, label, state, detail, ...(fix ? { fix } : {}), ...(action ? { action } : {}) };
}

export function message(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${err?.message ?? String(e)}${cause ? ` (${cause})` : ""}`;
}

function existing(dir: string): string {
  let cur = dir;
  while (!existsSync(cur) && dirname(cur) !== cur) cur = dirname(cur);
  return cur;
}

export function diskCheck(id: string, label: string, dir: string, needGb: number): DoctorCheck {
  try {
    const s = statfsSync(existing(dir));
    const free = (s.bavail * s.bsize) / GB;
    const detail = `${free.toFixed(1)} GB free at ${dir}`;
    if (free >= needGb) return row(id, label, "ok", detail);
    return row(id, label, free >= needGb / 3 ? "warn" : "fail", detail, `Free at least ${needGb} GB on that drive.`);
  } catch (e) {
    return row(id, label, "warn", message(e));
  }
}
