import type { CheckState, DoctorCheck } from "../../../core/types.ts";
import type { HEALTH } from "../../components/ui/Badge.tsx";

/** a check's word in the kit's HEALTH vocabulary */
export type Look = keyof typeof HEALTH;

const INFO_IDS = new Set(["proxy"]);

export const lookOf = (c: DoctorCheck): Look => (c.state === "ok" && INFO_IDS.has(c.id) ? "info" : c.state);

export const isOpen = (s: CheckState) => s === "warn" || s === "fail";

// ponytail: the order and the names of the sections of the system check (presentation of the rows the core gives)
const GROUPS: { title: string; of: (id: string) => boolean }[] = [
  { title: "Claude", of: (id) => id.startsWith("claude") },
  { title: "Jira and Xray", of: (id) => id === "jira" || id === "xray" },
  { title: "Search models", of: (id) => id.startsWith("model") || id === "llamacpp" },
  { title: "This project", of: (id) => id.startsWith("index") || id.startsWith("disk") },
];

const PC = "Testimus on this PC";

/** the sections in their order: the loading view draws them before the rows come */
export const TITLES = [PC, ...GROUPS.map((g) => g.title)];

export function sections(checks: DoctorCheck[]): { title: string; checks: DoctorCheck[] }[] {
  const titleOf = (id: string) => GROUPS.find((g) => g.of(id))?.title ?? PC;
  return TITLES.map((title) => ({ title, checks: checks.filter((c) => titleOf(c.id) === title) })).filter(
    (s) => s.checks.length > 0,
  );
}

export function counts(checks: DoctorCheck[]): { look: Look; n: number }[] {
  return (["fail", "warn", "ok", "skip", "info"] as Look[])
    .map((look) => ({ look, n: checks.filter((c) => lookOf(c) === look).length }))
    .filter((x) => x.n > 0);
}

// ponytail: a run without the sign-in probe says « not checked » for it — the last real sign-in answer is shown instead
export function merged(plain: DoctorCheck[], probed: DoctorCheck[] | undefined): DoctorCheck[] {
  if (!probed) return plain;
  return plain.map((c) =>
    c.state === "skip" && c.id === "claudeLogin" ? (probed.find((p) => p.id === c.id) ?? c) : c,
  );
}

// ponytail: a path inside a check's words (« D:\models — 640 GB free », « 21 GB free at /home/x ») — a token that starts
// with a drive, a share, ~/ or / after a space, its last stop or comma left out
const PATH = /(^|\s)((?:[A-Za-z]:[\\/]|\\\\|~\/|\/)\S+?)(?=[.,;:)]?(?:\s|$))/g;

/** the words of a detail, with the paths apart (drawn in the mono face) */
export function pathPieces(text: string): { text: string; path?: true }[] {
  const out: { text: string; path?: true }[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH)) {
    const at = m.index + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[2], path: true });
    last = at + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
