export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const cx = (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(" ");

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function relTime(ms: number): string {
  const s = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
