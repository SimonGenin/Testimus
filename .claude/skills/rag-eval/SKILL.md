---
name: rag-eval
description: Measuring Testimus retrieval quality (benchmark v2, ARCHITECTURE.md §6) — the behavior set eval/behaviors.jsonl with all its evidence, rag.eval (L1 evidence recall@10/20/50, complete, recall by role, precision, nDCG@10, MRR, characters, for search and for search + related + mentions), rag.compare (paired bootstrap interval, adopt rule), gen.bench (L2 with Claude, costly), retrieval settings. Use before choosing or changing any retrieval setting or model, and when someone says search results are bad.
---

# Retrieval evaluation (benchmark v2)

A retrieval setting or model is chosen by this measurement, never by reputation or by one
good-looking answer (ARCHITECTURE.md §6). What counts is **complete evidence**: every passage a
tester needs to write the test, not the rank of the first hit.

## The behavior set — `<project>/eval/behaviors.jsonl`

One line per functional behavior, with **all** its evidence:

```json
{"id": "sectionneur-sans-tk-menu",
 "question": "Que propose le menu contextuel d'un sectionneur sans TK, et dans quels cas diffère-t-il ?",
 "queries": ["menu contextuel sectionneur", "sectionneur sans TK"],
 "evidence": [
   {"ref": "SOSIE_211_D401-1_3#§5.6.6", "role": "rule", "must": true},
   {"ref": "SOSIE_211_D401-1_3#fig:40", "role": "figure", "must": false}],
 "category": "one-section", "validated": false}
```

- `ref` is `docId#anchor` (`§x.y`, `fig:N`). Roles: `definition`, `rule`, `condition`,
  `exception`, `amendment`, `contradiction`, `figure`. `must` defaults to true; each line needs at
  least one `must`. `queries` (optional) are what a tester would type; `category` groups the report.
- Cover the categories of §10.2: one section; distant sections of one document; several documents;
  exceptions; PA amendments; figure-only facts; acronym-only queries. 30–60 behaviors.
- **Bootstrap without circularity**: Claude reads the *whole* document and proposes the evidence;
  the retriever under test never builds its own gold. Such lines carry `"validated": false` until a
  tester confirms them; any such line makes every report **provisional** (say so wherever a number
  is quoted). A tester validating a line removes the flag (or sets it true).
- Only this format is read: a line without `evidence` (the old `eval/questions.jsonl` form) is refused.
- The set is project data, versioned with the project folder. Never tune on behaviors you then report
  on: keep a held-out third.

## L1 — `rag.eval` (cheap, deterministic)

`testimus rag eval [--set eval/behaviors.jsonl] [--mode hybrid|bm25|vector] [--k 10]
[--embedding <catalog id>] [--reranker <catalog id>|none] [--retrieval.rrfK=20 …] --json`

Default set: `eval/behaviors.jsonl`. Every behavior runs under two
fixed policies:

- `search` — `rag.search` on the question and each query, fused by RRF; top k passages.
- `search+graph` — the same, then `rag.related` (depth 1) on the anchor of each top-k passage, then
  `rag.mentions` (every page) on the queries and the codes/acronyms of the question. Until `rag.related` / `rag.mentions` are built the report marks this policy
  `available: false` with the reason.

Per policy, at k = 10, 20, 50: **evidence recall** (mean share of `must` evidence found), **complete**
(share of behaviors with every `must` found), **precision** (share of returned items that are any
evidence), **characters** returned to Claude (passage text, related and mentions output); **recall by
role** pooled over all evidence items (exceptions, amendments, contradictions first); nDCG@10 and MRR
on the search ranking (kept for continuity, with the v1 recall@5/@10/MRR of the question alone).

A report is written to `.testimus/eval/<date>-<setting>.json` with everything needed to reproduce it:
chunker version (hash of chunk ids and hashes), header mode, vector space (id + fingerprint), effective
retrieval settings, reranker, ks, corpus hash, set hash and format, app version, `provisional`.

`--embedding` / `--reranker` take a catalog id installed on this PC: the
candidate is embedded into its own vector space of `index/rag.db` and searched there;
the active space, `index/state.json` and this PC's choice are not touched, and switching to it later
reuses those vectors. Without them the run measures this PC's active models. `--mode bm25` embeds
nothing.

## Retrieval settings

Order: defaults < the active pack's `retrieval` < `project.json.rag.retrieval` < the run override.
`project.json.rag.retrieval` — all optional, defaults = `{ candidates: 50, rrfK: 60,
bm25Weights: [1, 1, 5], rrfWeights: [1, 1], rerank: { top: 30, mode: "topk" }, expand: "none", typos: false,
synonyms: [] }`. `rag.eval --retrieval`
overrides any of them for one run (the setting name then ends in `-r<hash>`).
Reranker modes: `topk` reorders the top `max(k, top)` candidates; `threshold` scores every candidate
and keeps all those at or above the model's threshold — `rerank.thresholds[<model id>]`, else
`rerank.threshold`, else plain top-k. A threshold belongs to one reranker: set it from the benchmark,
never copy it to another model.
`testimus rag measure --retrieval.typos=true --json` (Settings › Search › « Measure on the benchmark ») runs
`rag.eval` with the saved settings and with these, then `rag.compare` on `search` @10: one call per setting tried.
`rag.search --explain` says why each passage came (rank by words, by meaning, reranker score, forms found).

## Deciding — `rag.compare`

`testimus rag compare --reports <baseline.json> <candidate.json> … [--k 10] [--policy search] --json`
(one name = compare it with the latest other report). Behaviors are paired by id; the mean difference
in `must` recall at k gets a bootstrap 95 % interval (fixed seed: same reports, same numbers).
**Adopt** only when the interval is above zero **and** no role goes down (exceptions first). Then
write the result and its numbers into ARCHITECTURE.md §6 (« Results so far ») and change `project.json.rag.reference`. On a
provisional set, the decision is provisional too.

## L2 — `gen.bench` (Claude, costly, explicit)

`testimus gen bench --behaviors a b c d --configs '[{"pack":"light"},{"pack":"performance"}]'
[--runs 3] [--keep] --json` — a job: for each configuration × behavior × run it activates the
configuration on this PC, updates the index, runs `gen.tests` on the question, and scores the run from
the evidence ledger (`.testimus/gen/<job>.json`, `consulted`): agentic recall (share of `must`
evidence Claude opened; `null` while the ledger has no `consulted` list), tests written, findings,
quote errors, cost and duration. The tests of each run are reverted once scored unless `--keep`;
the previously active configuration is restored at the end. Keep it sober: 4 behaviors × 2
configurations (the reference and the best in L1) × 3 runs.

## Order of experiments

1. today's system (baseline); 2. + graph, passage cap; 3. + related/mentions
(`search+graph`); 4. + French stemming, glossary, stop words; 5. embeddings (bge-m3, Qwen3 0.6B / 4B /
8B); 6. rerankers on the best of 5, `topk` vs `threshold`. One change per report.

## When search "is bad"

Before touching settings: add the failing behavior to the set with all its evidence, run the eval, and
look at which `must` items were missed and what beat them. Most failures are conversion (missing
anchor, figure without description, table flattened) — fix those in ingestion first.
