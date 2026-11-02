import { act, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { Toasts } from "../../src/ui/components/ui/index.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { app } from "./ui-desktop-helpers.tsx";

configure({ asyncUtilTimeout: 4000 });

export function mount(ui: ReactNode, over: Partial<AppState> = {}) {
  const a = app(over);
  const r = render(
    <AppContext.Provider value={a}>
      {ui}
      <Toasts />
    </AppContext.Provider>,
  );
  const rerender = (next: ReactNode, more: Partial<AppState> = {}) => {
    Object.assign(a, more);
    r.rerender(
      <AppContext.Provider value={{ ...a }}>
        {next}
        <Toasts />
      </AppContext.Provider>,
    );
  };
  return { app: a, ...r, rerender };
}

type Refusal = { refused: { error: string; fix?: string } };

export const failing = (error: string, fix?: string): Refusal => ({ refused: { error, fix } });

export const models = {
  calls: [] as { name: string; input: Record<string, unknown> }[],
  routes: {} as Record<string, (input: Record<string, unknown>) => unknown>,
  gate: null as Promise<void> | null,
};

export const modelsNamed = (n: string) => models.calls.filter((c) => c.name === n);

export function modelsFetch(): void {
  models.calls = [];
  models.routes = {};
  models.gate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      models.calls.push({ name, input });
      if (models.gate) await models.gate;
      const h = models.routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      let out: unknown;
      try {
        out = h(input);
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
      const refused = (out as Refusal | null)?.refused;
      if (refused) return new Response(JSON.stringify(refused), { status: 400 });
      return new Response(JSON.stringify(out ?? null), { status: 200 });
    }),
  );
}

let ids: number[] = [];

function ToastIds() {
  ids = useToasts().map((t) => t.id);
  return null;
}

export function clearToasts(): void {
  const r = render(<ToastIds />);
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  r.unmount();
}
