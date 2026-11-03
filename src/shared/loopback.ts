export const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

// ponytail: Node 26 sends even 127.0.0.1 through HTTP_PROXY under NODE_USE_ENV_PROXY=1 unless NO_PROXY names it; the
// user's own NO_PROXY is kept and the loopback names appended (the core and the desktop shell both build it)
export function withLoopback(value: string | undefined): string {
  const have = (value ?? "").split(",").map((s) => s.trim().toLowerCase());
  const missing = LOOPBACK.filter((h) => !have.includes(h));
  if (!missing.length) return value ?? "";
  return value?.trim() ? `${value},${missing.join(",")}` : missing.join(",");
}
