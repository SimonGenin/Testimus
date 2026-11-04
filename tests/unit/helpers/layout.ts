import type { ColumnLayout, ColumnShow, StepColumn, XrayField } from "../../../src/core/types.ts";

export type OldPrefs = {
  order?: string[];
  collapsed?: string[];
  hidden?: string[];
  filled?: string[];
  open?: string[];
};
export type OldColumn = { name: string; id?: string; description?: string; referenceSource?: boolean };

// ponytail: the step layout a test used to write as xray.json { fields, prefs, columns } — the same columns, in the same
// order, each with the one mode it now carries (hidden first, then collapsed, filled, open; a field off in Xray folds)
export function layoutOf(
  fields: XrayField[],
  prefs: OldPrefs = {},
  columns: OldColumn[] = [],
  fetchedAt?: string,
): ColumnLayout {
  const has = (list: string[] | undefined, n: string) => !!list?.includes(n);
  const local = columns.filter(
    (c) =>
      !(c.id && fields.some((f) => f.id === c.id)) &&
      !fields.some((f) => f.name.toLowerCase() === c.name.toLowerCase()),
  );
  const names = [...fields.map((f) => f.name), ...local.map((c) => c.name)];
  const ordered = (prefs.order ?? []).filter((n) => names.includes(n));
  const all = [...ordered, ...names.filter((n) => !ordered.includes(n))];
  const out: StepColumn[] = all.map((name) => {
    const field = fields.find((f) => f.name === name);
    const def =
      (field && columns.find((c) => c.id === field.id)) ??
      columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const mode: ColumnShow = has(prefs.hidden, name)
      ? "hidden"
      : has(prefs.collapsed, name)
        ? "collapsed"
        : has(prefs.filled, name)
          ? "filled"
          : has(prefs.open, name)
            ? "open"
            : field?.disabled
              ? "filled"
              : "open";
    return {
      name,
      ...((field?.id ?? def?.id) ? { id: field?.id ?? def?.id } : {}),
      origin: field ? "xray" : "local",
      builtin: !!field?.builtin,
      status: field ? (!def && !field.builtin ? "new" : "ok") : def?.id ? "gone" : "ok",
      description: def?.description ?? "",
      mode,
      referenceSource: !!def?.referenceSource,
    };
  });
  return { ...(fetchedAt ? { fetchedAt } : {}), fields, columns: out };
}

// ponytail: a layout back as the old lists, so a test can replace one of them as it used to
export function prefsOf(x: ColumnLayout): Required<OldPrefs> {
  const of = (m: ColumnShow) => x.columns.filter((c) => c.mode === m).map((c) => c.name);
  return {
    order: x.columns.map((c) => c.name),
    hidden: of("hidden"),
    collapsed: of("collapsed"),
    filled: of("filled"),
    open: of("open"),
  };
}
