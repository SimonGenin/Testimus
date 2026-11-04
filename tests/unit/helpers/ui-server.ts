import { vi } from "vitest";

export type Call = { name: string; input: Record<string, unknown>; project?: string };

export class Fail extends Error {
  status: number;
  fix?: string;
  code?: string;
  constructor(message: string, fix?: string, status = 500, code?: string) {
    super(message);
    this.status = status;
    this.fix = fix;
    this.code = code;
  }
}

export const server = {
  calls: [] as Call[],
  routes: {} as Record<string, (input: Record<string, unknown>) => unknown>,
};

export const callsTo = (name: string) => server.calls.filter((c) => c.name === name);

export function stubServer(): void {
  server.calls = [];
  server.routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const where = init?.headers?.["X-Testimus-Project"];
      server.calls.push(where ? { name, input, project: decodeURIComponent(where) } : { name, input });
      const h = server.routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      try {
        const v = await h(input);
        return new Response(v === undefined ? "" : JSON.stringify(v), { status: 200 });
      } catch (e) {
        const f = e as Fail;
        return new Response(JSON.stringify({ error: f.message, fix: f.fix, code: f.code }), {
          status: f.status ?? 500,
        });
      }
    }),
  );
}

export function deferred<T = unknown>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
