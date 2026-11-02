let flusher: (() => Promise<void>) | null = null;

export function setFlusher(fn: (() => Promise<void>) | null): void {
  flusher = fn;
}

export async function flushEditor(): Promise<void> {
  await flusher?.();
}
