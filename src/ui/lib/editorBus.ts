let flusher: (() => Promise<void>) | null = null;
let discarder: ((testId: string) => void) | null = null;

export function setFlusher(fn: (() => Promise<void>) | null): void {
  flusher = fn;
}

export async function flushEditor(): Promise<void> {
  await flusher?.();
}

export function setDiscarder(fn: ((testId: string) => void) | null): void {
  discarder = fn;
}

// ponytail: a test about to be deleted must not be written back by the editor's pending autosave —
// the unmount flush would recreate its folder
export function discardEditor(testId: string): void {
  discarder?.(testId);
}
