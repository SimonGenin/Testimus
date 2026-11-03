import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Toaster, useToasts } from "../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { closeToast } from "../../../../src/ui/lib/toast.ts";
import { app } from "../../ui-desktop-helpers.tsx";

let live: number[] = [];

function Seen() {
  live = useToasts().map((t) => t.id);
  return null;
}

// ponytail: a shell piece drawn as the app draws it — inside the data layer, with the app's context and the toasts
export function withData(ui: ReactNode, over: Partial<AppState> = {}) {
  const state = app(over);
  const tree = (s: AppState) => (
    <DataProvider>
      <AppContext.Provider value={s}>
        {ui}
        <Toaster />
        <Seen />
      </AppContext.Provider>
    </DataProvider>
  );
  const r = render(tree(state));
  return {
    ...r,
    state,
    rerenderWith: (more: Partial<AppState>) => {
      Object.assign(state, more);
      r.rerender(tree({ ...state }));
    },
  };
}

// ponytail: the app itself draws its toasts; this only lists them for a cleanup
export function withToasts(ui: ReactNode) {
  return render(
    <>
      {ui}
      <Seen />
    </>,
  );
}

export function clearAllToasts(): void {
  act(() => {
    for (const id of live) closeToast(id, true);
  });
  live = [];
}
