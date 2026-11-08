export type DiffLine = { kind: "same" | "added" | "removed"; text: string };
export type DiffPart = DiffLine | { kind: "skipped"; count: number };

// ponytail: a line diff by the longest common sequence of lines — the texts a person reads side by side (a few hundred
// lines), so the plain table is enough
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n+$/, "").split("\n");
  const b = after.replace(/\n+$/, "").split("\n");
  if (!before.trim()) a.length = 0;
  if (!after.trim()) b.length = 0;
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m)
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "removed", text: a[i++] });
    else out.push({ kind: "added", text: b[j++] });
  while (i < n) out.push({ kind: "removed", text: a[i++] });
  while (j < m) out.push({ kind: "added", text: b[j++] });
  return out;
}

// ponytail: the unchanged lines far from any change fold into « N unchanged lines »
export function withContext(lines: DiffLine[], context: number): DiffPart[] {
  const near = lines.map((_, k) =>
    lines.slice(Math.max(0, k - context), k + context + 1).some((l) => l.kind !== "same"),
  );
  const out: DiffPart[] = [];
  lines.forEach((l, k) => {
    const last = out[out.length - 1];
    if (l.kind !== "same" || near[k]) out.push(l);
    else if (last?.kind === "skipped") last.count++;
    else out.push({ kind: "skipped", count: 1 });
  });
  return out;
}
