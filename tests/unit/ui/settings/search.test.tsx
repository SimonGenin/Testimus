// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchSection } from "../../../../src/ui/screens/settings/SearchSection.tsx";
import { calls, Fail, fakeNet, info, inputs, mountSettings, net, reset } from "./helpers.tsx";

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
  docs: [{ docId: "D1", indexed: "fresh" }],
  ...over,
});

const space = (over: Record<string, unknown> = {}) => ({
  id: "aaa111bbb222",
  model: "qwen3-embedding-0.6b-onnx-q8",
  runtime: "transformers",
  dims: 1024,
  chunks: 40,
  complete: true,
  active: true,
  builtAt: "2026-11-01T10:00:00Z",
  lastUsed: "2026-11-02T09:00:00Z",
  sizeMB: 0.16,
  ...over,
});

const SPACES = [
  space(),
  space({
    id: "ccc333ddd444",
    model: "bge-m3-q8",
    chunks: 30,
    complete: false,
    active: false,
    lastUsed: null,
    builtAt: null,
    sizeMB: 0.12,
  }),
];

beforeEach(() => {
  fakeNet();
  net.routes["project.info"] = () => info();
  net.routes["rag.status"] = () => status();
  net.routes["rag.spaces"] = () => SPACES;
  net.routes["models.catalog"] = () => [
    { id: "qwen3-embedding-0.6b-onnx-q8", label: "Qwen3 Embedding 0.6B (8-bit, CPU)" },
    { id: "bge-reranker-v2-m3-q8", label: "BGE Reranker v2 M3 (8-bit, CPU)" },
    { id: "bge-m3-q8", label: "BGE-M3 (8-bit, CPU)" },
  ];
});

afterEach(reset);

const row = (id: string) =>
  waitFor(() =>
    within(screen.getByRole("table", { name: "Vector spaces" })).getByRole("row", { name: new RegExp(`Space ${id}`) }),
  );

describe("Settings › Search", () => {
  it("has no hard-coded model list; shows the reference and the model used here with its origin", async () => {
    net.routes["project.info"] = () => info({ rag: { reference: { pack: "balanced" } } });
    mountSettings(<SearchSection />);
    expect(await screen.findByText("Balanced pack")).toBeInTheDocument();
    expect((await screen.findAllByText("Qwen3 Embedding 0.6B (8-bit, CPU)", { exact: false })).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("This PC's choice")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Index up to date · 40 passages/)).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("says when no reference is set and when search is degraded, with the reason and what is missing", async () => {
    net.routes["rag.status"] = () =>
      status({
        activation: "light",
        profileMatches: false,
        space: null,
        degraded: "No vectors for bge-m3-q8 yet: run rag index.",
        missing: ["qwen3-embedding-8b-q8"],
      });
    mountSettings(<SearchSection />);
    expect(await screen.findByText(/Not set: the Light pack/)).toBeInTheDocument();
    expect(await screen.findByText("The Light pack (default)")).toBeInTheDocument();
    const degraded = screen.getByRole("status");
    expect(degraded).toHaveTextContent("Search on words only");
    expect(degraded).toHaveTextContent("No vectors for bge-m3-q8 yet: run rag index.");
    expect(screen.getByText("qwen3-embedding-8b-q8")).toBeInTheDocument();
    expect(screen.getByText("Vectors missing for this model — reindex")).toBeInTheDocument();
  });

  it("says how many documents are behind, with no reranker and no origin", async () => {
    net.routes["rag.status"] = () =>
      status({
        reranker: null,
        activation: "none",
        docs: [
          { docId: "D1", indexed: "stale" },
          { docId: "D2", indexed: "fresh" },
        ],
      });
    mountSettings(<SearchSection />);
    expect(await screen.findByText("1 document to reindex")).toBeInTheDocument();
    expect(screen.getByText(/no reranker/)).toBeInTheDocument();
    expect(screen.getByText("None: lexical search only")).toBeInTheDocument();
  });

  it("says when there is no index, and without a model", async () => {
    net.routes["rag.status"] = () => status({ exists: false, embedding: "none" });
    net.routes["rag.spaces"] = () => [];
    mountSettings(<SearchSection />);
    expect(await screen.findByText("No index yet")).toBeInTheDocument();
    expect(screen.getByText("No embedding model")).toBeInTheDocument();
    expect(await screen.findByText(/None yet: the first index run/)).toBeInTheDocument();
  });

  it("shows why the state could not be read", async () => {
    delete net.routes["rag.status"];
    net.routes["rag.spaces"] = () => [];
    mountSettings(<SearchSection />);
    expect(await screen.findByText("The index state could not be read")).toBeInTheDocument();
    expect(screen.getByText("Unknown command rag.status")).toBeInTheDocument();
  });

  it("lists the vector spaces (last use, state) and drops one after a confirmation", async () => {
    net.routes["rag.dropSpace"] = (i) => ({ dropped: i.id, freedMB: 0.12 });
    mountSettings(<SearchSection />);
    const active = await row("aaa111bbb222");
    expect(within(active).getByText("In use here")).toBeInTheDocument();
    expect(within(active).getByText("Complete")).toBeInTheDocument();
    const old = await row("ccc333ddd444");
    expect(within(old).getByText("Incomplete")).toBeInTheDocument();
    expect(within(old).getByText("—")).toBeInTheDocument();
    fireEvent.click(within(old).getByRole("button", { name: "Drop space ccc333ddd444" }));
    const dlg = await screen.findByRole("alertdialog", { name: "Drop the BGE-M3 (8-bit, CPU) vectors?" });
    expect(dlg).not.toHaveTextContent("falls back to words only");
    expect(dlg).toHaveTextContent("vectors deleted from the index");
    expect(dlg).toHaveTextContent("0.12 MBfreed on this PC");
    expect(calls("rag.dropSpace")).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "Drop 0.12 MB" }));
    await waitFor(() => expect(inputs("rag.dropSpace")[0]).toEqual({ id: "ccc333ddd444", force: false }));
    expect(await screen.findByText("ccc333ddd444 · 0.12 MB freed")).toBeInTheDocument();
  });

  it("warns before dropping the active space and forces it; a cancel or a refusal drops nothing", async () => {
    mountSettings(<SearchSection />);
    fireEvent.click(within(await row("aaa111bbb222")).getByRole("button", { name: "Drop space aaa111bbb222" }));
    let dlg = await screen.findByRole("alertdialog", { name: /Drop the Qwen3/ });
    expect(within(dlg).getByText(/falls back to words only/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    net.routes["rag.dropSpace"] = () => {
      throw new Fail("Locked.");
    };
    fireEvent.click(screen.getByRole("button", { name: "Drop space aaa111bbb222" }));
    dlg = await screen.findByRole("alertdialog", { name: /Drop the Qwen3/ });
    fireEvent.click(within(dlg).getByRole("button", { name: "Drop 0.16 MB" }));
    expect(await screen.findByText("Could not drop the vector space")).toBeInTheDocument();
    expect(inputs("rag.dropSpace")[0]).toEqual({ id: "aaa111bbb222", force: true });
  });

  it("reindexes, showing the run, then reads the state again", async () => {
    net.routes["rag.index"] = () => ({ jobId: "rag-index-00000001" });
    net.routes["jobs.show"] = () => ({ job: { id: "rag-index-00000001", status: "running" } });
    mountSettings(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Reindex" }));
    expect(await screen.findByText("Indexing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
    const before = calls("rag.status").length;
    net.routes["jobs.show"] = () => ({ job: { id: "rag-index-00000001", status: "done", result: {} } });
    await waitFor(() => expect(screen.queryByText("Indexing…")).toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(calls("rag.status").length).toBeGreaterThan(before));
  });

  it("shows an empty state without spaces and goes to Models", async () => {
    net.routes["rag.spaces"] = () => [];
    const { app } = mountSettings(<SearchSection />);
    expect(await screen.findByText(/None yet: the first index run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose models…" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "models");
  });
});
