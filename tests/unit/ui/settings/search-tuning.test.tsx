// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tuning } from "../../../../src/ui/screens/settings/search/Tuning.tsx";
import { choose } from "../../helpers/select.ts";
import { fakeJob, fakeNet, inputs, mountSettings, net, reset } from "./helpers.tsx";

const DEFAULTS = {
  candidates: 50,
  rrfK: 60,
  bm25Weights: [1, 1, 5],
  rrfWeights: [1, 1],
  rerank: { top: 30, mode: "topk" },
  expand: "none",
  typos: false,
  synonyms: [],
};

let project: Record<string, unknown> = {};

const settings = (
  over: Record<string, unknown> = project,
  reranker: string | null = null,
  pack: Record<string, unknown> | null = null,
) => ({
  defaults: DEFAULTS,
  pack,
  base: { ...DEFAULTS, ...pack },
  project: Object.keys(over).length ? over : null,
  effective: { ...DEFAULTS, ...pack, ...over },
  reranker,
  glossary: { documents: 38, project: 0 },
});

const setRetrieval = (input: Record<string, unknown>) => {
  const next: Record<string, unknown> = { ...project, ...(input.retrieval as Record<string, unknown>) };
  for (const key of input.unset as string[]) delete next[key];
  project = next;
  return settings();
};

const HITS = [
  {
    docId: "SOSIE_211",
    anchor: "§5.6.6",
    path: "5 > 5.6 > 5.6.6",
    text: "Le sectionneur…",
    header: "SOSIE_211 Traction — 5 > 5.6 > 5.6.6 Sectionneur avec TK",
    score: 0.03,
    kind: "section",
    why: {
      words: 1,
      meaning: 3,
      reranker: 0.91,
      matched: ["sectionneur"],
      stems: ["ouvr", "refus"],
      synonyms: ["TK → télécommande"],
      typos: [],
    },
  },
  {
    docId: "SOSIE_211",
    anchor: "fig:40",
    path: "5 > 5.6 > 5.6.6",
    text: "Figure 40 – Menu contextuel\nVisible text: Ouvrir",
    header: "SOSIE_211 Traction — 5 > 5.6 > 5.6.6 Sectionneur avec TK",
    score: 0.02,
    kind: "figure",
    why: { words: null, meaning: 1, reranker: null, matched: [], stems: [], synonyms: [], typos: ["ouvrr → ouvrir"] },
  },
];

beforeEach(() => {
  fakeNet();
  project = {};
  net.routes["rag.retrieval"] = () => settings();
  net.routes["docs.list"] = () => [{ id: "SOSIE_211", title: "Traction", code: "SOSIE_211" }];
  net.routes["rag.search"] = () => HITS;
  net.routes["jobs.list"] = () => [];
  net.routes["rag.setRetrieval"] = setRetrieval;
});

afterEach(reset);

const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

describe("Settings › Search › Ranking and Words", () => {
  it("shows the settings in words, the reranker only when the pack has one", async () => {
    mountSettings(<Tuning />);
    expect(await screen.findByRole("textbox", { name: "Candidates per search" })).toHaveValue("50");
    expect(radio("Words vs meaning", "Balanced")).toHaveAttribute("aria-checked", "true");
    expect(radio("Weight of codes and ids", "High")).toHaveAttribute("aria-checked", "true");
    expect(radio("Also bring", "Nothing more")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Reranker" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /French forms/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Accents and case ignored" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Typos forgiven/ })).not.toBeChecked();
    expect(screen.getByText(/Also 38 acronyms read from the documents/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to project.json" })).toBeNull();
  });

  it("a pack with a reranker lets the top N or its threshold be chosen", async () => {
    net.routes["rag.retrieval"] = () => settings({}, "qwen3-reranker-0.6b");
    mountSettings(<Tuning />);
    const select = await screen.findByRole("combobox", { name: "Reranker" });
    expect(select).toBeEnabled();
    choose(select, /Above its threshold/);
    fireEvent.click(await screen.findByRole("button", { name: "Save to project.json" }));
    await waitFor(() =>
      expect(inputs("rag.setRetrieval")).toEqual([{ retrieval: { rerank: { mode: "threshold" } }, unset: [] }]),
    );
  });

  it("saves only what the draft changed; Reset ranking gives the ranking back to the defaults and the pack", async () => {
    project = { candidates: 80 };
    mountSettings(<Tuning />);
    fireEvent.click(await screen.findByRole("radio", { name: "Meaning" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Typos forgiven/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /French forms/ }));
    expect(screen.getByText(/Not saved: Try it and Measure use these settings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save to project.json" }));
    await waitFor(() =>
      expect(inputs("rag.setRetrieval")).toEqual([
        { retrieval: { rrfWeights: [1, 2], typos: true, bm25Weights: [1, 1, 5, 0] }, unset: [] },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save to project.json" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reset ranking" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save to project.json" }));
    await waitFor(() =>
      expect(inputs("rag.setRetrieval")[1]).toEqual({ retrieval: {}, unset: ["candidates", "rrfWeights"] }),
    );
    await waitFor(() => expect(project).toEqual({ typos: true, bm25Weights: [1, 1, 5, 0] }));
    expect(screen.getByRole("checkbox", { name: /Typos forgiven/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /French forms/ })).not.toBeChecked();
  });

  it("a key the team set that this PC's pack matches stays in project.json when something else is saved", async () => {
    project = { candidates: 80 };
    net.routes["rag.retrieval"] = () => settings(project, null, { candidates: 80 });
    mountSettings(<Tuning />);
    const chips = await screen.findByRole("textbox", { name: "Synonyms and acronyms" });
    fireEvent.change(chips, { target: { value: "TK = télécommande" } });
    fireEvent.keyDown(chips, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Save to project.json" }));
    await waitFor(() =>
      expect(inputs("rag.setRetrieval")).toEqual([{ retrieval: { synonyms: [["TK", "télécommande"]] }, unset: [] }]),
    );
    expect(project).toEqual({ candidates: 80, synonyms: [["TK", "télécommande"]] });
  });

  it("Discard goes back to what is saved", async () => {
    mountSettings(<Tuning />);
    fireEvent.click(await screen.findByRole("radio", { name: "Referenced sections" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(radio("Also bring", "Nothing more")).toHaveAttribute("aria-checked", "true");
    expect(inputs("rag.setRetrieval")).toEqual([]);
  });

  it("a number that does not parse is refused in the field and changes nothing", async () => {
    mountSettings(<Tuning />);
    const field = await screen.findByRole("textbox", { name: "Candidates per search" });
    fireEvent.change(field, { target: { value: "abc" } });
    expect(await screen.findByText(/Type a number \(whole\) from 1 to 1000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to project.json" })).toBeNull();
    fireEvent.change(field, { target: { value: "120" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save to project.json" }));
    await waitFor(() => expect(inputs("rag.setRetrieval")).toEqual([{ retrieval: { candidates: 120 }, unset: [] }]));
  });

  it("a synonym is a chip « a = b », saved as a group", async () => {
    mountSettings(<Tuning />);
    const chips = await screen.findByRole("textbox", { name: "Synonyms and acronyms" });
    fireEvent.change(chips, { target: { value: "TK = télécommande" } });
    fireEvent.keyDown(chips, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Save to project.json" }));
    await waitFor(() =>
      expect(inputs("rag.setRetrieval")).toEqual([{ retrieval: { synonyms: [["TK", "télécommande"]] }, unset: [] }]),
    );
  });
});

describe("Settings › Search › Try it", () => {
  it("searches with the settings being edited and the filters, and says why each passage came", async () => {
    mountSettings(<Tuning />);
    fireEvent.click(await screen.findByRole("radio", { name: "Words" }));
    choose(screen.getByRole("combobox", { name: "Kind of passage" }), "Figures only");
    fireEvent.change(screen.getByRole("textbox", { name: "Section" }), { target: { value: "5.6" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Try a search" }), {
      target: { value: "ouverture sectionneur TK" },
    });
    const list = await screen.findByRole("list", { name: "Passages found" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(inputs("rag.search").at(-1)).toEqual({
      query: "ouverture sectionneur TK",
      k: 10,
      explain: true,
      retrieval: { ...DEFAULTS, rrfWeights: [2, 1] },
      kinds: ["figure"],
      section: "5.6",
    });
    const [text, figure] = within(list).getAllByRole("listitem");
    expect(text).toHaveTextContent("SOSIE_211#§5.6.6 Sectionneur avec TK");
    expect(text).toHaveTextContent(
      "words #1 · meaning #3 · reranker 0.91 · words « sectionneur » · forms « ouvr », « refus » · synonym TK → télécommande",
    );
    expect(figure).toHaveTextContent("SOSIE_211#fig:40 Figure 40 – Menu contextuel");
    expect(figure).toHaveTextContent("not by its words · meaning #1 · typo ouvrr → ouvrir");
  });

  it("Measure runs rag.measure with the settings being edited and shows the verdict", async () => {
    const job = fakeJob({ id: "j-measure", kind: "rag-measure" });
    net.routes["rag.measure"] = () => ({ jobId: job.id });
    mountSettings(<Tuning />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Typos forgiven/ }));
    fireEvent.click(screen.getByRole("button", { name: "Measure on the benchmark" }));
    await waitFor(() => expect(inputs("rag.measure")).toEqual([{ retrieval: { ...DEFAULTS, typos: true } }]));
    expect(await screen.findByRole("status", { name: "Measuring on the benchmark" })).toBeInTheDocument();
    await job.finish({
      status: "done",
      result: {
        baseline: { report: "a.json", setting: "bge-m3-q8-hybrid", recall: 0.88 },
        candidate: { report: "b.json", setting: "bge-m3-q8-hybrid-rabc123", recall: 0.87 },
        k: 10,
        policy: "search",
        n: 100,
        diff: -0.01,
        low: -0.04,
        high: 0.02,
        adopt: false,
        why: "The 95 % interval [-0.040, 0.020] does not exclude zero upwards.",
        provisional: false,
        byRole: {},
      },
    });
    expect(await screen.findByText("Not better than the saved settings")).toBeInTheDocument();
    expect(
      screen.getByText(/0\.880 saved → 0\.870 with these settings \(−0\.010, 95 % interval −0\.040 to \+0\.020/),
    ).toBeInTheDocument();
  });
});
