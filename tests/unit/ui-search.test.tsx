// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { SearchSection } from "../../src/ui/screens/settings/SearchSection.tsx";

type Call = { name: string; input: Record<string, unknown> };
let calls: Call[] = [];
let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const named = (n: string) => calls.filter((c) => c.name === n);

const status = (over: Record<string, unknown> = {}) => ({
  embedding: "qwen3-embedding-0.6b-onnx-q8",
  reranker: "bge-reranker-v2-m3-q8",
  dims: 1024,
  activation: "machine",
  missing: [],
  exists: true,
  indexEmbedding: "qwen3-embedding-0.6b-onnx-q8",
  profileMatches: true,
  space: { id: "aaa111bbb222", vectors: 40, complete: true },
  degraded: null,
  chunks: 40,
  builtAt: null,
  docs: [{ docId: "D1", indexed: "fresh", superseded: false }],
  ...over,
});

const spaces = [
  {
    id: "aaa111bbb222",
    model: "qwen3-embedding-0.6b-onnx-q8",
    runtime: "transformers",
    dims: 1024,
    chunks: 40,
    complete: true,
    active: true,
    unpinned: false,
    builtAt: "2026-11-01T10:00:00Z",
    lastUsed: "2026-11-02T09:00:00Z",
    sizeMB: 0.16,
  },
  {
    id: "ccc333ddd444",
    model: "bge-m3-q8",
    runtime: "transformers",
    dims: 1024,
    chunks: 30,
    complete: false,
    active: false,
    unpinned: true,
    builtAt: null,
    lastUsed: null,
    sizeMB: 0.12,
  },
];

function base() {
  routes["rag.status"] = () => status();
  routes["rag.spaces"] = () => spaces;
  routes["models.catalog"] = () => [
    { id: "qwen3-embedding-0.6b-onnx-q8", label: "Qwen3 Embedding 0.6B (8-bit, CPU)" },
    { id: "bge-reranker-v2-m3-q8", label: "BGE Reranker v2 M3 (8-bit, CPU)" },
    { id: "bge-m3-q8", label: "BGE-M3 (8-bit, CPU)" },
  ];
}

const app = (reference?: unknown): AppState =>
  ({
    info: {
      dir: "C:/p",
      project: { name: "P", rag: { embedding: "bge-m3", reranker: null, ...(reference ? { reference } : {}) } },
      xray: { fields: [], prefs: {} },
    },
    xray: { fields: [], prefs: { order: [], collapsed: [], hidden: [] } },
    route: { screen: "settings", arg: "search" },
    navigate: vi.fn(),
    refreshInfo: vi.fn(),
  }) as unknown as AppState;

const show = (state = app()) =>
  render(
    <AppContext.Provider value={state}>
      <SearchSection />
    </AppContext.Provider>,
  );

describe("Settings › Search", () => {
  it("has no hard-coded model list; shows the reference and the model used here with its origin", async () => {
    base();
    show(app({ pack: "balanced" }));
    expect(await screen.findByText("Balanced pack")).toBeInTheDocument();
    expect((await screen.findAllByText("Qwen3 Embedding 0.6B (8-bit, CPU)", { exact: false })).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("This PC's choice")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/bge-m3 \(default\)/)).toBeNull();
    expect(screen.getByText(/Index up to date/)).toBeInTheDocument();
  });

  it("says when no reference is set and when search is degraded, with the reason", async () => {
    base();
    routes["rag.status"] = () =>
      status({
        activation: "light",
        profileMatches: false,
        space: null,
        degraded: "No vectors for bge-m3-q8 yet: run rag index.",
        missing: ["qwen3-embedding-8b-q8"],
      });
    show();
    expect(await screen.findByText("Not set: the Light pack")).toBeInTheDocument();
    expect(await screen.findByText("The Light pack (default)")).toBeInTheDocument();
    expect(screen.getByText("Search on words only")).toBeInTheDocument();
    expect(screen.getByText("No vectors for bge-m3-q8 yet: run rag index.")).toBeInTheDocument();
    expect(screen.getByText("qwen3-embedding-8b-q8")).toBeInTheDocument();
  });

  it("lists the vector spaces and drops one after a confirmation", async () => {
    base();
    routes["rag.dropSpace"] = (i) => ({ dropped: i.id, freedMB: 0.12 });
    show();
    const table = await screen.findByRole("table", { name: "Vector spaces" });
    const active = within(table).getByRole("row", { name: "Space aaa111bbb222" });
    expect(within(active).getByText("In use here")).toBeInTheDocument();
    expect(within(active).getByText("Complete")).toBeInTheDocument();
    const old = within(table).getByRole("row", { name: "Space ccc333ddd444" });
    expect(within(old).getByText("Incomplete")).toBeInTheDocument();
    expect(within(old).getByText(/from v1/)).toBeInTheDocument();
    fireEvent.click(within(old).getByRole("button", { name: "Drop space ccc333ddd444" }));
    const dlg = await screen.findByRole("dialog", { name: "Drop the BGE-M3 (8-bit, CPU) vectors?" });
    expect(named("rag.dropSpace")).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "Drop 0.12 MB" }));
    await waitFor(() => expect(named("rag.dropSpace")[0]?.input).toEqual({ id: "ccc333ddd444", force: false }));
  });

  it("warns before dropping the active space and forces it", async () => {
    base();
    routes["rag.dropSpace"] = (i) => ({ dropped: i.id, freedMB: 0.16 });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Drop space aaa111bbb222" }));
    const dlg = await screen.findByRole("dialog", { name: /Drop the Qwen3/ });
    expect(within(dlg).getByText(/falls back to words only/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Drop 0.16 MB" }));
    await waitFor(() => expect(named("rag.dropSpace")[0]?.input).toEqual({ id: "aaa111bbb222", force: true }));
  });

  it("shows an empty state without spaces and goes to Models", async () => {
    base();
    routes["rag.spaces"] = () => [];
    const state = app();
    show(state);
    expect(await screen.findByText(/None yet: the first index run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose models…" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "models");
  });
});
