import type { Fit, MachineProfile } from "../types.ts";
import { gb } from "./fit/verdict.ts";
import type { Aside, Picked } from "./models-resolve.ts";

export const PROCESSOR_ONLY = "Made for a GPU: here it runs on the processor, several times slower.";

export const sizeOf = (mb: number): string => (mb >= 1024 ? gb(mb) : `${Math.max(0, Math.round(mb))} MB`);

export type Installed = "all" | "some" | "none";

/** what one pack is on this PC, as the notes are written from it */
export type PackFacts = {
  variants: number;
  available: boolean;
  /** the variant shown: the one in use when the pack is in use, else the one it resolves to here */
  shown: number | null;
  /** the variant a fresh resolution picks here, and how */
  resolved: number | null;
  picked: Picked | null;
  /** the variants before the resolved one, each with the one reason it was left aside */
  aside: Aside[];
  /** the pack's variants by index, named, for a variant that fits now but is not the one in use */
  names: string[];
  active: boolean;
  chosen: boolean;
  installed: Installed;
  downloadMB: number;
  fit: Fit | null;
  processorOnly: boolean;
  /** the pack (or « the X models ») search runs with for the project, when it is not this one */
  usedInstead: string | null;
  reference: boolean;
};

function where(fit: Fit | null, machine: MachineProfile | null): string {
  if (fit?.device === "gpu" && fit.totalMB.vram) return ` (${gb(fit.totalMB.vram)} GPU)`;
  if (fit?.device === "cpu" && machine) return ` (on the processor, ${gb(machine.ramTotalMB)} of memory)`;
  return "";
}

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

// Each line says one true thing about a pack on this PC: which variant it resolved to and how, why each variant before
// it was left aside (the one reason, with the numbers), whether it fits, what is left to download, and whether the
// project uses it — never a variant in use called too big, never a download the project's choice does not need
export function packNotes(f: PackFacts, machine: MachineProfile | null): string[] {
  if (!f.available) {
    const reasons = [...new Set(f.aside.map((a) => a.reason))];
    if (reasons.length === 1) return [`Not available on this PC: ${reasons[0]}.`];
    return ["Not available on this PC.", ...f.aside.map((x) => `Variant « ${x.models} »: ${x.reason}.`)];
  }
  const out: string[] = [];
  const several = f.variants > 1;
  const shown = f.shown ?? f.resolved;
  const resolvedHere = f.resolved === shown;
  if (several && f.active && !resolvedHere) out.push("In use here: the variant set up when the pack was chosen.");
  else if (several && f.picked === "kept") out.push("Chosen here: already on this PC, and it fits without the margin.");
  else if (several && f.picked === "fallback")
    out.push(
      f.fit?.verdict === "untested"
        ? "Chosen here: the lightest variant this system can run."
        : "Chosen here: no variant fits comfortably, this one runs with the least trouble.",
    );
  else if (several && f.picked === "first-fit")
    out.push(`Chosen here: the first variant that fits${where(f.fit, machine)}.`);
  for (const a of f.aside.filter((x) => shown === null || x.variant < shown))
    out.push(`Variant « ${a.models} » not chosen: ${a.reason}.`);
  if (f.active && f.resolved !== null && shown !== null && f.resolved < shown)
    out.push(`Variant « ${f.names[f.resolved]} » fits this PC now: use the pack again to switch to it.`);
  if (f.fit && f.fit.verdict !== "fits") out.push(f.fit.message);
  if (f.processorOnly) out.push(PROCESSOR_ONLY);
  if (f.installed !== "all") {
    const left = `${sizeOf(f.downloadMB)} ${f.installed === "some" ? "left " : ""}to download`;
    out.push(f.fit?.verdict === "fits" ? `Fits this PC · ${left}.` : `${capital(left)}.`);
    if (f.chosen && f.usedInstead)
      out.push(`Chosen for this project, not on this PC yet: search uses ${f.usedInstead} meanwhile.`);
    return out;
  }
  if (f.active) return out;
  const need = f.usedInstead ? `${f.usedInstead} does not need it` : "";
  if (f.reference) out.push(`Kept as the team reference${need ? `; ${need}` : ""}.`);
  else out.push(need ? `Installed, not in use: ${need}.` : "Installed, not in use by this project.");
  return out;
}
