// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { List } from "../../../../src/ui/components/ui/List.tsx";
import { Loading } from "../../../../src/ui/components/ui/Loading.tsx";
import { createQueryClient, key } from "../../../../src/ui/lib/data/query.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const line = () => screen.queryAllByRole("status").find((s) => /loading/i.test(s.textContent ?? "")) ?? null;
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// ponytail: a read that never answers on its own — each call is one more request, never settled
const calls: { signal: AbortSignal }[] = [];

function Waits() {
  useQuery({
    queryKey: key("tests.list", {}),
    queryFn: ({ signal }) => {
      calls.push({ signal });
      return new Promise<never>(() => {});
    },
  });
  return <Loading read="tests.list" />;
}

function Two() {
  const [first, setFirst] = useState(true);
  return (
    <>
      {first && <Loading read="docs.list" />}
      <Loading read="docs.list" />
      <Loading read="docs.show" />
      <button type="button" onClick={() => setFirst(false)}>
        drop
      </button>
    </>
  );
}

describe("Loading", () => {
  it("says nothing for a second, then what loads and the seconds, counting", () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Waits />
      </QueryClientProvider>,
    );
    expect(line()).toBeNull();
    tick(999);
    expect(line()).toBeNull();
    tick(1);
    expect(line()).toHaveTextContent("Loading the tests… 1 s");
    tick(3000);
    expect(line()).toHaveTextContent("Loading the tests… 4 s");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("from 10 s says the answer is slow, and Try again asks the read again and counts from zero", async () => {
    vi.useFakeTimers();
    calls.length = 0;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Waits />
      </QueryClientProvider>,
    );
    tick(9000);
    expect(screen.queryByText("Testimus is answering slowly. The page keeps waiting.")).toBeNull();
    tick(1000);
    expect(line()).toHaveTextContent("Still loading the tests… 10 s");
    expect(screen.getByText("Testimus is answering slowly. The page keeps waiting.")).toBeVisible();
    expect(calls).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    expect(line()).toBeNull();
    tick(1000);
    expect(line()).toHaveTextContent("Loading the tests… 1 s");
  });

  it("says a read once on the page: the next skeleton waiting on it takes over when the first goes", () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Two />
      </QueryClientProvider>,
    );
    tick(2000);
    expect(screen.getAllByText(/Loading the documents…/)).toHaveLength(1);
    expect(screen.getAllByText(/Loading the document…/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "drop" }));
    const said = screen.getAllByRole("status").map((s) => s.textContent);
    expect(said).toEqual(["Loading the documents… 2 s", "Loading the document… 2 s"]);
  });

  it("a List's loading rows say their read under them (reading)", () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <List
          label="Jobs"
          items={[]}
          getKey={String}
          renderItem={() => ({ title: "" })}
          loading={3}
          reading="jobs.list"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("listbox", { name: "Jobs" })).toHaveAttribute("aria-busy", "true");
    tick(1000);
    expect(line()).toHaveTextContent("Loading the jobs… 1 s");
  });

  it("the catalogue's states show at once", () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Loading read="review.queue" debugState="status" />
      </QueryClientProvider>,
    );
    expect(line()).toHaveTextContent("Loading the review queue… 2 s");
  });
});
