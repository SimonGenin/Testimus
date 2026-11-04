import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { mount } from "../../cov-uiscreens-helpers.tsx";
import { FakeEventSource, fakeFetch } from "../../ui-desktop-helpers.tsx";

let n = 0;

// ponytail: each test gets its own project, so the drafts of the request (kept for the page's life) never leak
export function freshPage(): void {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  setProject(`/p${++n}`);
}

export const renderData = (ui: ReactNode) => render(<DataProvider>{ui}</DataProvider>);

export const mountData = (ui: ReactNode, over: Partial<AppState> = {}) =>
  mount(<DataProvider>{ui}</DataProvider>, over);

export const emit = (e: JobEvent) => act(() => FakeEventSource.last?.emit(e));
