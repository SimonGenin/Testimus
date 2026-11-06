import { statSync } from "node:fs";

// ponytail: a version of a file is its size, mtime and inode (an atomic write is a new inode); a file that is not
// there is a version too
export function fileStamp(path: string): string {
  try {
    const s = statSync(path, { bigint: true, throwIfNoEntry: false });
    return s ? `${s.size}:${s.mtimeNs}:${s.ino}` : "-";
  } catch {
    return "-";
  }
}

// ponytail: what is worked out from a few files (a test's row, a job's summary) is worked out once per version of
// them — the files stay the truth, each read only stats them; the oldest entries go past `max`
export function fileMemo<T>(max = 20_000): (key: string, files: readonly string[], compute: () => T) => T {
  const cache = new Map<string, { stamp: string; value: T }>();
  return (key, files, compute) => {
    const stamp = files.map(fileStamp).join("|");
    const hit = cache.get(key);
    if (hit?.stamp === stamp) return hit.value;
    const value = compute();
    cache.delete(key);
    cache.set(key, { stamp, value });
    if (cache.size > max) cache.delete(cache.keys().next().value as string);
    return value;
  };
}
