// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchSection } from "../../../../src/ui/screens/settings/SearchSection.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { calls, Fail, fakeJob, fakeNet, info, inputs, mountSettings, net, reset } from "./helpers.tsx";

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

const use = (id: string, who: string, over: Record<string, unknown> = {}) => ({
  id,
  who,
  when: `when ${id}`,
  words: "always",
  embedding: { use: "uses", model: "qwen3-embedding-0.6b-onnx-q8", label: "Qwen3 Embedding 0.6B (8-bit, CPU)" },
  reranker: { use: "uses", model: "bge-reranker-v2-m3-q8", label: "BGE Reranker v2 M3 (8-bit, CPU)", why: null },
  ...over,
});

const USAGE = [
  use("claude", "Claude, while it writes or checks tests", {
    reranker: { use: "no", model: null, label: null, why: "not in Claude's loop" },
  }),
  use("palette", "Search everything (Ctrl K)"),
  use("index", "The index of the documents", {
    words: "builds",
    embedding: { use: "builds", model: null, label: null },
    reranker: { use: "no", model: null, label: null, why: null },
  }),
  use("light", "Light user", { words: "no", reranker: { use: "uses", model: null, label: null, why: null } }),
];

const RETRIEVAL = {
  candidates: 50,
  rrfK: 60,
  bm25Weights: [1, 1, 5],
  rrfWeights: [1, 1],
  rerank: { top: 30, mode: "topk" },
  expand: "none",
  typos: false,
  synonyms: [],
};

beforeEach(() => {
  fakeNet();
  net.routes["models.usage"] = () => USAGE;
  net.routes["project.info"] = () => info();
  net.routes["rag.status"] = () => status();
  net.routes["rag.spaces"] = () => SPACES;
  net.routes["rag.retrieval"] = () => ({
    defaults: RETRIEVAL,
    pack: null,
    base: RETRIEVAL,
    project: null,
    effective: RETRIEVAL,
    reranker: null,
    glossary: { documents: 0, project: 0 },
  });
  net.routes["docs.list"] = () => [];
  net.routes["jobs.list"] = () => [];
  net.routes["models.catalog"] = () => [
    { id: "qwen3-embedding-0.6b-onnx-q8", label: "Qwen3 Embedding 0.6B (8-bit, CPU)" },
    { id: "bge-reranker-v2-m3-q8", label: "BGE Reranker v2 M3 (8-bit, CPU)" },
    { id: "bge-m3-q8", label: "BGE-M3 (8-bit, CPU)" },
  ];
});

afterEach(reset);

const row = (id: string) =>
  waitFor(() =>
    within(screen.getByRole("table", { name: "Vector spaces" })).getByRole("row", {
      name: new RegExp(`${id}, 1024 dims`),
    }),
  );

const openUses = async () =>
  fireEvent.click(await screen.findByRole("button", { name: /^Where search is used, and the filters it takes/ }));

describe("Settings › Search › Who uses what on this PC", () => {
  it("folded at first, then one row per user of the search, in the core's words: words, embedding, reranker or never, and when", async () => {
    mountSettings(<SearchSection />);
    const fold = await screen.findByRole("button", { name: /^Where search is used, and the filters it takes/ });
    await waitFor(() => expect(fold).toHaveTextContent(`${USAGE.length} places`));
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Who uses what on this PC" })).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByText(/Claude's search tool takes the same filters/)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Who uses what on this PC" });
    const row = (who: string) => within(table).getByRole("row", { name: new RegExp(`^${who}`) });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(USAGE.length + 1));
    const claude = row("Claude");
    expect(claude).toHaveTextContent("Always");
    expect(claude).toHaveTextContent("Qwen3 Embedding 0.6B (8-bit, CPU)");
    expect(claude).toHaveTextContent("Never");
    expect(claude).toHaveTextContent("not in Claude's loop");
    expect(claude).toHaveTextContent("when claude");
    expect(row("Search everything")).toHaveTextContent("BGE Reranker v2 M3 (8-bit, CPU)");
    const index = row("The index");
    expect(index).toHaveTextContent("Builds it");
    expect(index).toHaveTextContent("None on this PC: words only");
    expect(row("Light user")).toHaveTextContent("None in the models in use");
    expect(row("Light user")).toHaveTextContent("—");
  });

  it("says so when it cannot be read", async () => {
    net.routes["models.usage"] = () => {
      throw new Fail("usage down");
    };
    mountSettings(<SearchSection />);
    await openUses();
    expect(await screen.findByText("Who uses what could not be read")).toBeInTheDocument();
    expect(screen.getByText("usage down")).toBeInTheDocument();
  });
});

describe("Settings › Search", () => {
  it("has no hard-coded model list and no pack; reads out the embedding and the reranker in use", async () => {
    net.routes["project.info"] = () => info({ rag: { reference: { pack: "balanced" } } });
    mountSettings(<SearchSection />);
    const models = await screen.findByRole("region", { name: "Search models" });
    expect(await within(models).findByText("Embedding: Qwen3 Embedding 0.6B (8-bit, CPU)")).toBeInTheDocument();
    expect(within(models).getByText("Reranker: BGE Reranker v2 M3 (8-bit, CPU)")).toBeInTheDocument();
    expect(screen.queryByText(/pack|team/i)).toBeNull();
    const lists = ["Documents", "Kind of passage"].map((name) => screen.getByRole("combobox", { name }));
    expect(screen.getAllByRole("combobox")).toEqual(lists);
    expect(
      screen.getByText(
        "40 passages from 1 document, with Qwen3 Embedding 0.6B (8-bit, CPU), BGE Reranker v2 M3 (8-bit, CPU)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("says when search is degraded, with the reason and what is missing", async () => {
    net.routes["rag.status"] = () =>
      status({
        activation: "light",
        profileMatches: false,
        space: null,
        degraded: "No vectors for bge-m3-q8 yet: run rag index.",
        missing: ["qwen3-embedding-8b-q8"],
      });
    const { app } = mountSettings(<SearchSection />);
    const degraded = await screen.findByRole("alert");
    expect(degraded).toHaveTextContent("Search on words only");
    expect(within(degraded).getByText("No vectors for bge-m3-q8 yet: run rag index.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reindex" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reindex" })).toBeEnabled();
    expect(screen.getByText("Not on this PC: qwen3-embedding-8b-q8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "models");
    expect(screen.getByText("Words only")).toBeInTheDocument();
    expect(screen.getByText(/no vectors for the active model/)).toBeInTheDocument();
  });

  it("while an index run builds the vectors: its progress, no words-only warning, the space being built", async () => {
    net.routes["rag.status"] = () =>
      status({
        activation: "light",
        profileMatches: false,
        space: { id: "ccc333ddd444", vectors: 0, complete: false },
        degraded: "The vectors of bge-m3-q8 are incomplete: run rag index.",
        indexing: { state: "running", doc: 1, docs: 2, done: 16, total: 40 },
        docs: [
          { docId: "D1", indexed: "stale" },
          { docId: "D2", indexed: "missing" },
        ],
      });
    net.routes["rag.spaces"] = () => [space({ id: "ccc333ddd444", model: "bge-m3-q8", complete: false })];
    mountSettings(<SearchSection />);
    const bar = await screen.findByRole("progressbar", { name: "Index" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("Indexing 1 of 2 documents · 16 of 40 passages")).toBeInTheDocument();
    expect(screen.queryByText("Search on words only")).toBeNull();
    for (const w of ["Words only", "To reindex", "No index yet"]) expect(screen.queryByText(w)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
    const built = await row("ccc333ddd444");
    expect(within(built).getByText("Building")).toBeInTheDocument();
    expect(within(built).queryByText("Incomplete")).toBeNull();
  });

  it("says how many documents are behind, with no reranker", async () => {
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
    expect(screen.getByText("To reindex")).toBeInTheDocument();
    expect(screen.getByText("Reranker: none")).toBeInTheDocument();
  });

  it("says when there is no index, and without a model", async () => {
    net.routes["rag.status"] = () => status({ exists: false, embedding: "none" });
    net.routes["rag.spaces"] = () => [];
    mountSettings(<SearchSection />);
    expect(await screen.findByText("No index yet")).toBeInTheDocument();
    expect(screen.getByText("No embedding model")).toBeInTheDocument();
    expect(await screen.findByText(/None yet: the first index run/)).toBeInTheDocument();
  });

  it("a project without a document has an empty index, nothing to reindex (audit icons 109)", async () => {
    net.routes["rag.status"] = () => status({ exists: false, docs: [], chunks: 0 });
    net.routes["rag.spaces"] = () => [];
    mountSettings(<SearchSection />);
    const empty = await screen.findByText("Empty");
    expect(iconsIn(empty)).toEqual(["circle-dashed"]);
    expect(screen.getByText("No document yet — nothing to index.")).toBeInTheDocument();
    expect(screen.queryByText("No index yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
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
    expect(iconsIn(within(active).getByText("In use here")), "audit icons 108").toEqual(["target"]);
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

  it("warns before dropping the active space and forces it; a cancel or a refusal drops nothing, said in the dialog", async () => {
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
    expect(await within(dlg).findByText("Locked.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: /Drop the Qwen3/ })).toBe(dlg);
    expect(inputs("rag.dropSpace")[0]).toEqual({ id: "aaa111bbb222", force: true });
  });

  it("reindexes, showing the run with its progress and Cancel, then reads the state again", async () => {
    const j = fakeJob({ id: "rag-index-00000001", kind: "rag-index" });
    net.routes["rag.index"] = () => ({ jobId: j.id });
    net.routes["jobs.cancel"] = () => ({ cancelled: true });
    mountSettings(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Reindex" }));
    const run = await screen.findByRole("status", { name: "Indexing the documents" });
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
    await j.progress("Embedding", 1, 4);
    expect(await within(run).findByText("Indexing the documents · 25 %")).toBeInTheDocument();
    fireEvent.click(within(run).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: j.id }]));
    const before = calls("rag.status").length;
    await j.finish({ status: "done", result: {} });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Indexing the documents" })).toBeNull());
    await waitFor(() => expect(calls("rag.status").length).toBeGreaterThan(before));
  });

  it("a reindex that fails says so here, with the reason", async () => {
    const j = fakeJob({ id: "rag-index-00000002", kind: "rag-index" });
    net.routes["rag.index"] = () => ({ jobId: j.id });
    mountSettings(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Reindex" }));
    await screen.findByRole("status", { name: "Indexing the documents" });
    await j.finish({ status: "failed", error: "No space left" });
    expect(await screen.findByText("Indexing the documents: stopped")).toBeInTheDocument();
    expect(screen.getByText("No space left")).toBeInTheDocument();
  });

  it("a reindex already running when the page opens is shown", async () => {
    net.routes["jobs.list"] = () => [
      { id: "rag-index-00000003", kind: "rag-index", subject: "", status: "running", startedAt: "" },
    ];
    fakeJob({ id: "rag-index-00000003", kind: "rag-index" });
    mountSettings(<SearchSection />);
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
  });

  it("shows an empty state without spaces and goes to Models", async () => {
    net.routes["rag.spaces"] = () => [];
    const { app } = mountSettings(<SearchSection />);
    expect(await screen.findByText(/None yet: the first index run/)).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Search models" })).getByRole("button", { name: "Models" }),
    );
    expect(app.navigate).toHaveBeenCalledWith("settings", "models");
  });
});
