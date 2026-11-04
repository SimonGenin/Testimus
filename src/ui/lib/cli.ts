// ponytail: the command line that does what a form or a plan does — « testimus xray push --id LFRPS12-1420 » — so a
// gesture of the page can be repeated in a terminal or by Claude
const quote = (v: string) => (/^[\w.:@/\\#§-]+$/.test(v) ? v : `"${v.replace(/(["\\$`])/g, "\\$1")}"`);

export function cliLine(name: string, input: Record<string, unknown> = {}): string {
  const [group, verb] = name.split(".");
  const flags = Object.entries(input).flatMap(([k, v]) => {
    if (v === undefined || v === null || v === false) return [];
    if (v === true) return [`--${k}`];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [`--${k} ${quote(v.join(","))}`];
    if (typeof v === "object") return [`--${k} ${quote(JSON.stringify(v))}`];
    return [`--${k} ${quote(String(v))}`];
  });
  return ["testimus", group, verb, ...flags].join(" ");
}
