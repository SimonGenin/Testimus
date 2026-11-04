import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { mount } from "../../cov-uiscreens-helpers.tsx";
import { renderWithData } from "../../cov-uishell-helpers.tsx";
import { FakeEventSource, fakeFetch } from "../../ui-desktop-helpers.tsx";

let n = 0;

// ponytail: each test gets its own project, so the drafts of the request (kept for the page's life) never leak
export function freshPage(): void {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  setProject(`/p${++n}`);
}

export const renderData = renderWithData;

export const mountData = mount;

export const emit = (e: JobEvent) => act(() => FakeEventSource.last?.emit(e));
