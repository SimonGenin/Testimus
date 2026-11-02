# Testimus — RAG v2: complete evidence, verifiable sources, interchangeable models

Status: **built (R1–R9; R10 measured, see SPEC §5 « Benchmark results »), 2026-11-02 — see SPEC.md §4, §5, §7, §8, §9,
§11, §12, §13, §14.** What follows is kept as the design record (findings, reasons, measurements); SPEC.md is the
contract and wins where they differ. It extended SPEC.md §4, §5, §8, §11, §12,
§13 and §14. When a part is built, its behavior moves into SPEC.md in the same change and leaves this
file; SPEC.md stays the contract. The models and runtimes below are installed on the dev PC (LINKS.md,
« Local models and runtimes ») and were tried there on 2026-11-02 (§16).

**Removed by decision of 2026-11-02 (D-12): Testimus does not use Ollama.** GGUF models run on llama.cpp only, which
Testimus downloads itself (same files as Ollama's `qwen3-embedding` tags); the Ollama parts below (§1.3, §7, §8.3,
§16.2, §16.4) are kept as history.

Marks used below: ✅ verified in the code, on real data or on the dev PC on 2026-11-02 · ⚠️ hypothesis,
secondary source or to be checked when built.

## 0. Why this change

Testimus writes French end-to-end functional tests from French specifications of about 900 pages
(RATP Sosie: requirement ids, tables, screenshots, diagrams, amendments, sometimes contradictions).
Claude Code reasons and writes; the local index supplies the evidence. Two things matter more than
anything else:

1. **Completeness**: find *every* rule, condition, exception, amendment and contradiction that
   bears on a behavior, wherever it sits in the corpus, not only the passages most similar to the
   question.
2. **Traceability**: every statement, step and expected result points at its source
   (`docId#anchor "quote"`), and Claude or a human can reopen and check that source — text,
   requirement or image.

And two architecture goals:

3. **Interchangeable models**: embedding and reranking models are chosen, installed, switched,
   updated and removed as data, from a local path, by an in-app download, or through **Ollama**;
   several configurations coexist without rebuilding everything. Most users choose a **pack**
   (Light · Performance · Balanced · Quality, §7.12) rather than models one by one.
4. **Hardware independence**: the dev PC (RTX 5080 16 GB, Core Ultra 9 285K, 64 GB RAM) can run 4B–8B
   models, but a tester's laptop without GPU must keep a working, equally *traceable* Testimus.

Not goals: a hosted embedding or vector service; replacing Claude's own reading by injected context;
multi-vector (ColBERT) storage; multimodal embeddings in this round (§11).

## 1. Where we stand (baseline, verified)

### 1.1 The pipeline today ✅

| Stage | Today |
|---|---|
| Extraction | mammoth docx → HTML → `docs/<id>/doc.md`; anchors `<!-- § x.y -->`, `<!-- req EXI_… -->`, `<!-- fig N -->`; tables as markdown (colspan/rowspan expanded); figures in reading order; Claude describes figures into `figures.json`; losses in `doc.json.warnings`. |
| Chunking | [chunk.ts](src/core/rag/chunk.ts): one chunk per lowest section, split above `MAX_TOKENS = 800` (chars/4) by paragraphs; long tables by lines with the header repeated; one chunk per figure (caption + description); deterministic context header; Claude headers off by default. |
| Index | [db.ts](src/core/rag/db.ts): one SQLite file `index/rag.db` — `chunks`, FTS5 `chunks_fts(header, text, codes)` (unicode61, diacritics removed), one sqlite-vec `vecs` table (cosine, exhaustive). |
| Embedding | [embed.ts](src/core/rag/embed.ts): transformers.js 4, bge-m3 q8 by default, `device: "cpu"`. Profiles in [models.ts](src/core/rag/models.ts). |
| Search | [search.ts](src/core/rag/search.ts): BM25 top 50 + vectors top 50, RRF k=60, optional cross-encoder reranker on the top 30, k=10; superseded documents left out. |
| Sources | `docId#anchor "quote"`; [check.ts](src/core/lib/check.ts) checks anchor existence and the quote verbatim. Sources do not depend on chunks or vectors. |
| Claude | Nothing is injected: the `generate-tests`, `check-test`, `ask-docs` skills make Claude call `rag_search` → `rag_passage` → `Read`/`Grep` on `doc.md`. |
| Models on disk | [models-store.ts](src/core/lib/models-store.ts): lookup `TESTIMUS_MODELS` → `%LOCALAPPDATA%\Testimus\models` → release `models/`; download through transformers.js from Hugging Face when `settings.models.allowRemote`; `system.pullModel`; a doctor row per profile. |

### 1.2 Strengths to keep ✅

- S1 — Extracted content is model-independent: `doc.md`, anchors, requirement ids, figures and
  `doc.json` never depend on the embedding; a model change only re-embeds (chunks and FTS5 are kept).
- S2 — Sources point at `doc.md` anchors, not at chunks: the index is disposable.
- S3 — One SQLite file for text, BM25 and vectors; exhaustive vector search is exact and instant at
  this scale (≈ 2,000 chunks for the corpus ⚠️ estimated from the docx metadata: ≈ 1.8–2 M characters
  in the current documents; D401-1_3 alone gives 169 chunks ✅).
- S4 — The mechanical quote check runs before any model looks at a test.
- S5 — Claude searches and reads for itself, and a separate run checks each test.
- S6 — One command registry: anything added here reaches CLI, MCP and UI together.

### 1.3 Findings that this proposal fixes ✅

Measured on the real conversion of SOSIE_211_D401-1_3 01.01 (`.sandbox/D/run/doc.md`, 116 sections,
324 requirement ids, 43 figures).

| # | Finding | Where |
|---|---|---|
| F1 | §6.1 « Exigences » is the traceability matrix: one section of 105,072 characters holding 153 of the 324 `req` anchors (ids that appear nowhere else). `rag_passage …#req:EXI_MOP_SPF_531_A_1670` returns **93,996 characters** of text and 93,950 of `focus`. | `passage()` in search.ts |
| F2 | For a requirement defined in the body, `focus` is the id line only (24 characters for `EXI_MOP_SPF_511_A_10`); the statement is the next paragraph. | `passage()` |
| F3 | The matrix has a **Section** column (`EXI_MOP_SPF_511_A_10 … \| 3.2.4`): explicit requirement → section traceability, unused. The 34 parts of §6.1 are all indexed as « 6.1 Exigences »; the parts holding the rows carry `reqIds: []`. | chunk.ts |
| F4 | A quote is searched in the **whole document**, not in the cited passage: a quote from §3.2 cited as §5.6.6 passes. | [check.ts:203](src/core/lib/check.ts:203) |
| F5 | `rag.eval` scores the rank of the **first** expected hit; it cannot see whether all the evidence was found. The set has 5 questions over 7 chunks. | [eval.ts:96](src/core/rag/eval.ts:96) |
| F6 | Switching the embedding **drops** the vectors (`drop table if exists vecs`). Other configurations live only in eval scratch DBs, which `rag.search` cannot use. | [db.ts:57](src/core/rag/db.ts:57) |
| F7 | An index is validated by profile name and dimension only: a changed `dtype`, prefix or downloaded revision goes unnoticed; no revision is pinned. | db.ts, models.ts |
| F8 | `device: "cpu"` is hard-coded. onnxruntime-node 1.30 ships **DirectML** on win-x64 (`DirectML.dll` present) and transformers.js accepts `dml` / `webgpu` on win32; there is no CUDA on Windows. | [embed.ts:45](src/core/rag/embed.ts:45), [embed.ts:62](src/core/rag/embed.ts:62) |
| F9 | Inputs are cut at `MAX_EMBED_CHARS = 4000`; `profile.maxTokens` is ignored for embeddings; last-token pooling forces batches of 1. | [embed.ts:72](src/core/rag/embed.ts:72), [embed.ts:85](src/core/rag/embed.ts:85) |
| F10 | The reranker path takes only sequence-classification cross-encoders (one logit → sigmoid). Qwen3-Reranker (an LM scored on yes/no) needs another implementation. | embed.ts |
| F11 | Profiles are code (models.ts), duplicated in the UI (`PROFILES` in [SearchSection.tsx:18](src/ui/screens/settings/SearchSection.tsx:18)); the Qwen query instruction (« railway simulator ») is in code, not in the project. | models.ts |
| F12 | Models default to `%LOCALAPPDATA%\Testimus\models` — on the dev PC that is **C:, 24–27 GB free**; the doctor asks for 3 GB. Ollama installs per user in `%LOCALAPPDATA%\Programs\Ollama` (no admin) and stores in `%USERPROFILE%\.ollama\models` unless `OLLAMA_MODELS` is set (was `D:\ollama-models` on the dev PC during the tests; Ollama has since been uninstalled there). | [env.ts:93](src/core/env.ts:93), [doctor.ts:287](src/core/lib/doctor.ts:287) |
| F13 | BM25 has no French stemming (a trailing s/x is cut and `*` added), no acronym expansion; **« ne » and « pas » are stop words**, so negations and exceptions weigh nothing. | [search.ts:27](src/core/rag/search.ts:27) |
| F14 | `check-test` looks for contradictions with one `rag_search` (top 10). | check-test skill |
| F15 | A `fig:` source proves only the caption; what the picture shows is checked only by the semantic pass. | check.ts |
| F16 | `MAX_TOKENS`, `RRF_K`, `CANDIDATES`, `RERANK_TOP` and the BM25 column weights are constants; the eval can vary only the embedding, the reranker and the mode. | chunk.ts, search.ts |
| F17 | On the Transurb network, `curl.exe` (Windows schannel) fails every Hugging Face download with `CRYPT_E_NO_REVOCATION_CHECK`; PowerShell's HTTP client downloads fine. Downloads are done by Node's own `fetch`, never by shelling out to `curl.exe`, and no download switches off a certificate check. | dev PC |

## 2. Principles

- **P1 — Completeness never depends on the embedding model.** Structural tools (requirement graph,
  section tree, amendments) and exhaustive lexical tools return the same result on every machine.
  Embeddings and rerankers only speed up discovery and ranking. A tester on a CPU laptop gets the
  same evidence as the GPU machine, sometimes in a different order.
- **P2 — Extraction is done once.** Changing a model regenerates vectors, never `doc.md`, figures,
  anchors or requirement data.
- **P3 — An index holds several vector spaces.** Activating a model never destroys another one.
- **P4 — Models are data.** A catalog entry describes a model; nothing in the code or the UI names one.
- **P5 — Everything runs on this machine.** Files on disk, an in-app download, or a local Ollama.
  A runtime on another host is refused unless SPEC decides otherwise (documents would leave the PC).
- **P6 — The user decides where big files go.** No model is written to disk before the user has
  chosen the storage folder.
- **P7 — Measured before adopted.** A model, reranker or retrieval setting becomes a default only by
  winning on the benchmark of §10.
- **P8 — Ollama is a convenience, never a requirement.** Every model in every pack can be downloaded
  and run by Testimus alone: ONNX files through transformers.js (inside the app), GGUF files through
  llama.cpp (a zip the app downloads, no installer, no admin, no CUDA toolkit — the NVIDIA driver is
  enough ✅). When Ollama is there, Testimus may use the models it already has instead of downloading
  them again. A catalog or pack that breaks this rule fails a unit test (§7.12).

## 3. Evidence model

The three anchor kinds of SPEC §4 stay as they are (`§x.y`, `req:ID`, `fig:N`); no source written
today becomes invalid.

### 3.1 Requirement statement

For each requirement id the converter or indexer records its **statement** — the text that defines it:

1. Defined in the body: the block the `<!-- req ID -->` marker precedes; when that block is only the id
   (RATP style: `**EXI_…**` alone on its line), the statement is the id block plus the following
   block(s) up to the next requirement marker, heading or figure.
2. Defined only in a matrix: the matrix row, rendered `ID — <Objet> (section <x.y>)`.
3. Both: the body statement is the definition; the matrix row is kept as a trace (§3.3).

`rag_passage DOC#req:ID` returns `focus` = the statement (never the id alone, never a whole table)
and `text` = the owning section, capped (§3.4).

### 3.2 Matrix detection

A table is a **requirement matrix** when one column holds requirement ids (REQ_PATTERN or
`project.json.requirementPatterns`) on most rows and another column holds section numbers.
Recognised headers (case- and accent-insensitive): ids `Code Exigence`, `Exigence`, `Requirement`,
`Id`; sections `Section`, `Chapitre`, `§`, `Paragraphe`. A project can name them in
`project.json.requirementMatrix: { idColumn, sectionColumn, textColumn? }`. Each row becomes one
`matrix-row` chunk (`docId#req:ID@matrix`) whose text is the row, whose path is the **traced section**
(`3 > 3.2 > 3.2.4`), and whose `reqIds` is `[ID]`.

⚠️ To be checked on the other document families (PR2I, PCC NG, Instructeur, PTL…) before the rule is
fixed in SPEC §4.

### 3.3 Requirement graph

Derived at index time, model-independent, stored in `rag.db` table `edges(from, to, kind, docId)`,
rebuilt with the chunks:

| kind | from → to | source |
|---|---|---|
| `defines` | req → section | where its statement sits (§3.1) |
| `traces` | req → section | the matrix Section column (§3.2), and `requirements/requirements.csv` (`doc`, `chapter`) — for RATP, from the RATP matrix (3,717 rows, LINKS.md) |
| `mentions` | section → req | an id written in the section text |
| `refers` | section → section | cross-references in the text: `§ 5.6.6`, `cf. 5.6`, `voir le chapitre 3.2`, `section 4.1` (same document; `<code> §x` for another) |
| `parent` / `sibling` | section → section | the section numbers |
| `shows` | section → figure | figure markers in the section |
| `amends` | document → document | `doc.json.amends` (PA documents); section-level when the amending text names the section it changes ⚠️ to study on the PA documents |

A traced section that differs from the defining section is reported (`info`) by `docs.show`: it is
often the sign that the matrix and the body disagree.

### 3.4 Passage size

Every passage returned to Claude is capped (`project.json.rag.passageMaxChars`, default 12,000). Above
the cap the answer carries `truncated: true`, the focus, the section outline (sub-sections with their
size, requirement ids and figures) and how to read the rest (`Read docs/<id>/doc.md` lines a–b).
Claude still reads `doc.md` freely: the cap protects its context, not access.

## 4. Retrieval

### 4.1 Tools (commands of the registry, hence CLI, MCP and HTTP)

| Command | What it returns | Why |
|---|---|---|
| `rag.search` (exists) | top-k passages, hybrid by default; new `expand: none \| section \| graph` adds the related passages (parent, traced section, statements of the requirements in the hit) flagged `via` | ranking, quick discovery |
| `rag.mentions` (new) | **every** passage of every current document that contains a term, an identifier or an acronym — exact phrase, stemmed form and glossary expansions, optional regex — grouped by document and section with counts and one line of context per hit; paginated, no top-k | completeness: scattered rules, distant exceptions, other documents on the same object |
| `rag.related` (new) | the graph neighbours of `docId#anchor` or of a requirement id: statement, defining and traced sections, requirements mentioned, cross-references both ways, siblings, figures, the same section in amending documents | completeness along the document's own structure |

`rag.mentions` and `rag.related` use no model at all (P1).

### 4.2 Lexical search in French

- A second FTS5 column holds the **stemmed** text (French Snowball stemmer in pure JS, ⚠️ library to
  choose; no native code, SPEC §14); the query is stemmed the same way. The unicode61 column stays for
  exact forms.
- **Glossary**: acronyms parsed from sections titled « Acronymes », « Abréviations », « Glossaire »
  (D401-1_3 §1.4 holds 3,323 characters of them ✅), plus `project.json.glossary`; a query term is
  expanded both ways (DSO ↔ its long form).
- Stop words: articles and prepositions only. **Negation and restriction words stay searchable**
  (`ne`, `pas`, `sauf`, `excepté`, `uniquement`, `seulement`, `interdit`, `jamais`, `sans`) because
  they mark exceptions.

### 4.3 Retrieval settings

`project.json.rag.retrieval` (all optional, defaults = today's constants):
`{ candidates: 50, rrfK: 60, bm25Weights: [1, 1, 5], rerank: { top: 30, mode: "topk" | "threshold",
threshold?: number }, expand: "none" }`. `rag.eval` can override every one of them for a run (F16).

### 4.4 Dense search

Unchanged in principle: sqlite-vec, exhaustive, cosine, in `rag.db` — but per vector space (§6).
When the active space is missing or incomplete, `hybrid` falls back to BM25 with `degraded: true`
and a warning in the output instead of an error, so Claude keeps working while vectors build.

### 4.5 Reranking

Optional, off by default, **never in Claude's generation loop by default**: Claude reads the passages
and is a better judge than any reranker; a reranker improves the order, not the recall. Two uses are
kept: the UI search box (`topk`), and filtering a large candidate set by score (`threshold`), which
helps recall instead of truncating it.

**A threshold belongs to one model.** On the same question and passages (§16.3) the four rerankers all
put the answer first, but score the related-but-not-answering passages 0.95 (Qwen3 0.6B), 0.86 (4B),
0.22 (8B) and 0.01 (bge-reranker-v2-m3). A threshold is therefore stored per reranker fingerprint
(`project.json.rag.retrieval.rerank.thresholds[<model id>]`), set by the benchmark (§10), never shared
between models.

### 4.6 Skills

- `generate-tests`: for each requirement in scope → `rag.related`; for each object, screen, gesture and
  acronym → `rag.mentions` across all documents; read the sections in full; then design. The
  `gen-report` adds `consulted` (§5.3).
- `check-test`: contradictions are looked for with `rag.mentions` on the step's objects in the
  **other** documents and in amending documents, not with one top-10 search.
- `ask-docs`: same order — `rag.mentions` / `rag.related` before concluding « the documents do not
  say ».

## 5. Traceability

### 5.1 Quote at its anchor

The mechanical check looks for the quote **inside the cited passage**: the section's own text for
`§`, the statement or the owning section for `req:`, the caption for `fig:`. Found elsewhere in the
document → `quote-not-at-anchor` (error, naming the anchor where it was found); not found → the existing
`quote-not-found`. The review panel highlights it only when it is at the anchor.

### 5.2 Weak quotes

A quote shorter than 4 words, or found more than once in its passage, gets `quote-weak` (warning): it
proves little.

### 5.3 Evidence ledger

For each generation the core derives, from the run's `stream-json` (not from the model's word), the
passages Claude actually opened (`rag_passage` refs, `Read` ranges of `doc.md` mapped to anchors) and
the searches it made. Stored in `.testimus/gen/<jobId>.json` as `consulted` and `searched`. The check
adds an `info` finding `related-unread` when a section `rag.related` links to a covered requirement was
never opened. The Review screen shows « sources read / sources related ».

### 5.4 Figures

- A claim that only a picture shows is cited `fig:N` with its caption quote, and `check-test` must
  `Read` the image before accepting it.
- Figure descriptions v2: `{ description, labels: [text visible in the picture, verbatim],
  kind: screen | diagram | symbol | table-image | photo }`. `labels` are indexed in FTS5 so a
  button label or a symbol name finds its screenshot. They are Claude-derived: never quotable as a
  source.

## 6. Indexes and vector spaces

### 6.1 Fingerprint

A **vector space** is identified by the sha256 (12 hex) of:
runtime · model identity (the SHA-256 of the model's weight files — never their path, so moving a
model keeps its spaces; for an Ollama model, its layer digest, which is the same SHA-256) · pooling · normalize · query and document instructions · dimension ·
max input tokens · text recipe version (how header and text are joined).
Any change among these makes a new space (fixes F7).

### 6.2 Layout of `rag.db`

`chunks`, `chunks_fts` (+ stemmed column), `edges`, `docs`, `meta` — model-independent — plus
`spaces(id, fingerprint json, model id, dims, built_at, complete, last_used)` and one sqlite-vec table
per space `vec_<id>`. Size per space ≈ chunks × dims × 4 bytes (2,000 × 4,096 ≈ 32 MB).

### 6.3 Life of a space

- `rag.index` updates chunks, FTS and edges once, then embeds what the **active** space lacks.
- A changed chunk deletes its vectors in every space; inactive spaces become `complete: false` and are
  completed when activated again.
- Switching back to a previous model reuses its space: only changed chunks are re-embedded.
- `rag.spaces` lists them (model, size, complete, last used); `rag.dropSpace` deletes one.
- Migration: today's `vecs` table becomes a space whose identity is marked `unpinned`.
- `rag.eval` uses spaces of the live `rag.db` when only the model changes; a scratch DB under
  `.testimus/eval/` remains only for chunking experiments (the chunks differ).

### 6.4 Which space a machine uses

`project.json` is shared, machines differ. So:

- `project.json.rag.reference = { pack } | { embedding, reranker }`: the team's reference
  configuration, the one the benchmark measures and the one recommended. A pack (§7.12) is the usual
  form: each PC resolves it for its own hardware.
- `settings.json.rag.byProject[<project folder>] = { pack } | { embedding, reranker }`: what **this
  PC** uses. Default: the reference when it resolves and is installed here, else the Light pack when
  installed, else BM25 only (degraded, §4.4).
- The index stays per machine and is not shared (SPEC §3, unchanged). Two colleagues on different
  models produce sources of the same kind, checked the same way (P1).

## 7. Model management

### 7.1 Three notions

- **Catalog entry** — what a model is (data, §7.2).
- **Installation** — where it is on this PC, or which runtime serves it (§7.3).
- **Activation** — which installed model a project uses on this PC (§6.4).

### 7.2 Catalog

`models/catalog.json` shipped with the app, plus the user's own entries in
`%APPDATA%\Testimus\models.json`. One entry:

```json
{
  "id": "qwen3-embedding-4b-q8",
  "kind": "embedding",
  "label": "Qwen3 Embedding 4B (8-bit)",
  "family": "qwen3-embedding",
  "licence": "Apache-2.0",
  "commercialUse": true,
  "runtimes": ["llamacpp", "ollama"],
  "source": {
    "hf": { "repo": "Qwen/Qwen3-Embedding-4B-GGUF", "path": "Qwen3-Embedding-4B-Q8_0.gguf" },
    "ollama": "qwen3-embedding:4b-q8_0"
  },
  "quantization": "Q8_0",
  "dims": 2560,
  "dimsOptions": [256, 512, 1024, 2560],
  "maxInputTokens": 8192,
  "pooling": "last",
  "normalize": true,
  "queryInstruction": "Instruct: {task}\nQuery: ",
  "docInstruction": "",
  "size": { "downloadMB": 4090, "ramMB": 4600, "vramMB": 4600 },
  "devices": ["gpu", "cpu"],
  "tier": "quality",
  "lighter": "qwen3-embedding-4b-q4",
  "heavier": "qwen3-embedding-8b-q8"
}
```

- **A catalog entry names an exact quantization.** Ollama's bare tags `qwen3-embedding:4b` and `:8b`
  are Q4_K_M ✅, not 8-bit; a bare tag may also point elsewhere tomorrow. Entries use explicit tags
  (`:4b-q8_0`) and record the digest at install.
- **A GGUF model is a file, served by one of two runtimes.** The model layers of Ollama's
  `qwen3-embedding` tags are byte-identical to Qwen's official GGUF files on Hugging Face ✅ (same
  SHA-256: `:0.6b` = `Qwen3-Embedding-0.6B-Q8_0.gguf`, `:4b` = `4B-Q4_K_M`, `:4b-q8_0` = `4B-Q8_0`,
  `:8b` = `8B-Q4_K_M`, `:8b-q8_0` = `8B-Q8_0`). So a GGUF entry lists its **sources** and its
  **runtimes** instead of being an « Ollama model »:

  ```json
  "source": {
    "file": { "sha256": "…", "size": 7674000000 },
    "hf": { "repo": "Qwen/Qwen3-Embedding-8B-GGUF", "path": "Qwen3-Embedding-8B-Q8_0.gguf" },
    "ollama": "qwen3-embedding:8b-q8_0"
  },
  "runtimes": ["llamacpp", "ollama"]
  ```

  The model's identity (in the fingerprint of §6.1) is the file's SHA-256; the runtime is a separate
  part of the fingerprint, since two runtimes may compute slightly different vectors from the same file
  (§16.4 measures it).
- **Which source and runtime on a PC** (first that applies): the file already registered (path A or an
  earlier download); Ollama running and already holding that tag (no download); else download the file
  from Hugging Face (B) and serve it with llama.cpp. `settings.json.models.useOllama: "auto" | "never"`
  (`auto` by default) lets a user keep Ollama out entirely.
- `lighter` / `heavier` chain the entries of a family from the lightest to the heaviest; the advice of
  §7.10 walks this chain.
- `size` starts from the catalog and is replaced by what was measured on this PC (§7.9).

- transformers entries carry `source.hf = { repo, revision, files }` and `dtypeByDevice`
  (`{ "cpu": "q8", "dml": "fp16" }` ⚠️ q8 is an int8 CPU quantisation and is expected to run poorly on
  DirectML).
- reranker entries carry `rerankerKind: "cross-encoder" | "yes-no-lm" | "http"`.
- `{task}` is filled from `project.json.rag.queryTask` (the domain sentence leaves the code, F11).
- First catalog — every entry below is installed on the dev PC and was tried (§16):

  | Kind | Runtime | Entries (quantization) |
  |---|---|---|
  | embedding | transformers | bge-m3 (q8, fp16) · Qwen3-Embedding-0.6B (q8, fp16) |
  | embedding | llamacpp **or** ollama (same files) | Qwen3-Embedding 0.6B Q8_0 · 4B Q4_K_M · 4B Q8_0 · 8B Q4_K_M · 8B Q8_0 — from `Qwen/Qwen3-Embedding-{0.6B,4B,8B}-GGUF` (Apache-2.0, not gated) or Ollama `qwen3-embedding:{0.6b,4b,4b-q8_0,8b,8b-q8_0}` |
  | reranker | transformers | bge-reranker-v2-m3 (q8, fp16, `cross-encoder`) · Qwen3-Reranker-0.6B ONNX (q8, `yes-no-lm`, needs the second implementation of §8.2) |
  | reranker | llamacpp | Qwen3-Reranker 0.6B · 4B · 8B (GGUF Q8_0) |

  Sizes and dimensions are confirmed by a probe when installed.
- Excluded as today: licences that forbid commercial use.

### 7.3 Three ways to get a model

**A — From a path.** The user points at a folder already on disk (a team share, a manual download):
Hugging Face layout (`config.json`, `tokenizer.json`, `onnx/*.onnx`). The app checks the files,
embeds one probe sentence to read the real dimension, and registers the installation
`{ via: "path", path, filesHash }`. It never copies the folder unless asked (« Copy into my models
folder »). A path on a share may be read-only.

**B — Downloaded by the app.** From Hugging Face, at the pinned revision, only the files the chosen
dtype needs, resumable, with progress and cancel (a job). Each file is written as `<name>.part` and
renamed only when complete; its SHA-256 is compared with the `lfs.oid` of the Hugging Face tree API
(`/api/models/<repo>/tree/<revision>`) ✅ — a mismatch deletes the file and fails the job. **Before the first download the app asks
where to store models** (P6):

- UI: a dialog lists the drives with their free space and the size needed, preselects the drive with
  the most room (D: on the dev PC), and saves the choice as `settings.json.models.dir`.
- CLI and MCP: without `models.dir`, `models pull` stops with « Choose where models are stored:
  `testimus models setDir <folder>` » (or `--dir` on the command). Claude may not choose it.
- Before every download: free space ≥ 1.2 × the size, else refused with the numbers.
- `TESTIMUS_MODELS` and the release `models/` keep working as read-only roots.

**Changing the download folder — at any time** (`models.setDir`, Settings › Models › « Models folder:
D:\transformers-models · Change… »):

- Two folders are set, each changeable on its own: `models.dir` (model files) and `models.runtimesDir`
  (llama.cpp builds; default `<models.dir>\runtimes`).
- The dialog shows the new folder's drive, its free space and the size of what is installed, then asks
  what to do with the models already downloaded:

  | Choice | Effect |
  |---|---|
  | **Move** (default) | a job: same drive → rename; other drive → copy, SHA-256 check of every file, then delete the old copy; progress and cancel (a cancel leaves the old copy intact and the registry unchanged) |
  | **Keep where they are** | nothing moves; they stay registered by their path (A); only new downloads go to the new folder |
  | **Copy** | as Move, without deleting the old copy (e.g. to prepare a USB key or a team share) |

- Refused, with the reason: not enough free space on the target; target not writable; a job using one
  of the models (an index run, a search server) — retried once it ends; the target inside the project
  folder (models are not project data and would be synced).
- The registry (§7.4) stores each installation's own path, so models may live in several folders;
  `models.list` shows where each one is. Vector spaces (§6) do not depend on the path: moving a model
  never triggers a reindex (the fingerprint uses the file's SHA-256, not its location).
- CLI and MCP: `models setDir <folder> --move | --keep | --copy [--dry-run]`; without one of the three
  the command stops and asks. Claude does not change the folder unless the user asked for it in the
  conversation.
- **Ollama's folder is Ollama's** (`OLLAMA_MODELS`): Testimus shows it and explains how to change it
  (stop Ollama, move `models`, set the user variable `OLLAMA_MODELS`, restart Ollama). It does not do
  it itself in this round: Ollama does not move its own files, and a half-done move would break it.

**C — Through Ollama.** Ollama owns its models and their storage; Testimus lists and uses them and asks
no storage question, but shows where Ollama keeps them (`OLLAMA_MODELS`, default
`%USERPROFILE%\.ollama\models` ✅; Ollama reads the variable at start, so a change needs an Ollama
restart) and warns when that drive is short of space, with how to move it
(set `OLLAMA_MODELS`, restart Ollama). « Install » on an Ollama catalog entry runs `ollama pull`
through the API (a job with progress); « Remove » runs Ollama's delete after a confirmation. A model
pulled outside Testimus (`ollama pull` in a terminal) appears by itself: if Ollama manages a model, the
app picks it up from there.

### 7.4 Machine registry

`%APPDATA%\Testimus\models.json`:

```json
{
  "dir": "D:\\transformers-models",
  "runtimesDir": "D:\\transformers-models\\runtimes",
  "allowRemote": true,
  "installs": [
    { "model": "bge-m3", "via": "download", "path": "D:\\Testimus\\models\\Xenova\\bge-m3",
      "revision": "…", "dtype": "q8", "status": "verified", "verifiedAt": "…" },
    { "model": "qwen3-embedding-4b-q4", "via": "ollama", "ollama": "qwen3-embedding:4b",
      "sha256": "…", "status": "verified" },
    { "model": "qwen3-embedding-8b-q8", "via": "download", "runtime": "llamacpp",
      "path": "D:\\transformers-models\\Qwen\\Qwen3-Embedding-8B-GGUF\\Qwen3-Embedding-8B-Q8_0.gguf",
      "sha256": "…", "status": "verified" }
  ],
  "ollama": { "enabled": true, "host": "http://127.0.0.1:11434" }
}
```

`settings.json.models.allowRemote` moves here; the old key is still read.

### 7.5 States

`available` (in the catalog) → `downloading` → `installed` → `verified` (probe passed) → `active`
(used by a project on this PC). Also `broken` (files missing or changed, Ollama model gone) and
`outdated` (newer catalog revision, or a new Ollama digest). An update is a new revision, hence a new
space (§6.1); the old space stays until dropped, so a regression can be measured and undone.

### 7.6 Commands (group `models`)

| Verb | Does |
|---|---|
| `catalog` | the catalog with, per entry, whether it fits this PC (RAM, GPU) and its tier |
| `list` | installed models: where, how (path · download · ollama), size, state, used by which projects |
| `add`* | register a folder (A) |
| `pull`* | download (B) or Ollama pull (C); a job; `--dir` |
| `remove`* | B: delete the files; A: unregister only; C: Ollama delete after confirmation |
| `verify` | probe: load, embed one sentence, check dimension and fingerprint |
| `setDir`* | choose or change the models folder or the runtimes folder; `--move` · `--keep` · `--copy`, `--dry-run` (§7.3) |
| `use`* | activate an embedding and/or a reranker for the open project on this PC (§6.4) — the « Custom » pack |
| `packs` | the packs (§7.12), each with the variant it resolves to on this PC, its fit, what is left to download, measured speed and quality |
| `usePack`* | install what the pack's variant needs, activate it, start the index job; `--dry-run` shows the plan |
| `hardware` | the machine profile of §7.8: RAM, CPU, GPUs with total and free VRAM, free disk per drive |
| `fit` | for one model, or an embedding + reranker pair: fits · tight · GPU too small (runs on CPU) · RAM too small, with the numbers (§7.8) |
| `perf` | the timings recorded on this PC, per operation and model: count, p50, p95, throughput, memory (§7.9) |
| `advice` | upgrade or downgrade suggestions from the timings, the fit and the benchmark (§7.10) |
| `ollama` | Ollama state: not installed · installed, not running · running `<version>`, host, models, storage folder |

`system.pullModel` stays as an alias of `models.pull`.

### 7.7 UI — Settings › Models

- **Pack cards first** (§7.12): Light · Performance · Balanced · Quality · Custom, the active one
  marked, each with its variant for this PC, fit, download left, speed and quality when measured, and
  « Use this pack ».
- Below, « Models » (folded by default): a table of the catalog: state chip, size, tier, a **fit chip**
  (§7.8), the measured speed on this PC when known (§7.9), actions Install · Use for this project ·
  Verify · Remove.
- Choosing a model whose fit is not « fits » opens a confirmation that states the problem in numbers
  (« Your GPU has 16 GB, 7.2 GB free. Qwen3 Embedding 8B (8-bit) needs about 9.1 GB: it will run partly
  on the processor, about N times slower. ») with Use anyway · Choose a lighter one. Only « RAM too
  small » refuses.
- An **advice banner** shows the current suggestion of §7.10, with its reason, Apply (= `models.use`
  plus the reindex it implies) and Dismiss.
- « Add from a folder… » (A). The storage dialog of §7.3 B on the first download.
- An **Ollama** panel: state (not installed → link to ollama.com; installed, not running → « Start
  Ollama, then Refresh »; running → version, host, its embedding models, its storage folder), Refresh.
- Settings › Search shows the reference and the model used here, from `models.list` (the hard-coded
  `PROFILES` list goes, F11), the vector spaces (`rag.spaces`) and Reindex.

### 7.8 Will it fit? — hardware check before choosing

**Machine profile** (`models.hardware`, refreshed at start and before a choice; no native tool, no admin):

| Item | How |
|---|---|
| RAM total / free, CPU | Node `os.totalmem()`, `os.freemem()`, `os.cpus()` |
| NVIDIA GPU: name, driver, VRAM total / used | `nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used --format=csv` when present ✅ (dev PC: RTX 5080, 591.44, 16,303 MiB) |
| Other GPUs (DirectML) | adapter names from WMI (`Win32_VideoController`); its `AdapterRAM` stops at 4 GB, so VRAM is « unknown » ⚠️ — the registry's 64-bit `HardwareInformation.qwMemorySize` is to be tried |
| What is already loaded | Ollama `/api/ps`: `size` and `size_vram` per loaded model ✅ |
| Disk | free space of the models folder's drive and Ollama's |

**Needs of a model** (in this order, the first known wins):
1. measured on this PC: Ollama `size_vram` while loaded, process peak RSS for transformers.js,
   `nvidia-smi` memory delta for llama.cpp (§7.9);
2. the catalog's `size.ramMB` / `size.vramMB`;
3. estimated: file size × 1.2.

Measured on the dev PC ✅ (Ollama, fully on the GPU): 0.6b 1.23 GB · 4b Q4 3.43 GB · 8b Q4 5.73 GB ·
8b Q8 9.10 GB of VRAM.

**Verdict**, for the embedding and the reranker **together** (both stay loaded during a search, and
other loaded models count):

| Verdict | Rule | Effect |
|---|---|---|
| fits | needs ≤ free VRAM (or RAM for CPU) − 15 % margin | none |
| tight | within the margin, or fits only once other loaded models are unloaded | warning, the models to unload named |
| GPU too small | VRAM need > total VRAM, RAM enough | warning: runs partly or fully on CPU, slower |
| RAM too small | RAM need > total RAM | refused |
| unknown | no VRAM figure (non-NVIDIA without Ollama) | info: « cannot check, try it; Testimus measures it on first use » |

After the first use, **Ollama tells the truth**: `size_vram < size` in `/api/ps` means the model is
split between GPU and CPU; Testimus shows it as « partly on the processor » and the advice of §7.10
proposes a lighter entry.

**Several runtimes share one GPU** ✅ (§16.4: 333 ms instead of 35 ms when Ollama still held a 9 GB
model while llama.cpp loaded another). So:
- the fit counts what Ollama has loaded (`/api/ps`) and what Testimus' own llama.cpp servers hold, not
  only the models about to be used;
- Testimus calls Ollama with an explicit `keep_alive` (the length of the job for an index run, `5m` for
  search) and unloads a model it no longer uses (`keep_alive: 0`) when it switches runtime or pack;
- a model Testimus did not load (the user's own Ollama session) is never unloaded: the fit verdict
  says « tight — Ollama holds <model>, <size> » instead.

### 7.9 Timings journal

Every model operation is timed and kept, per machine, so that speed is known instead of guessed.

- File: `%LOCALAPPDATA%\Testimus\perf\journal.jsonl` (per machine, never in the project folder:
  timings belong to the hardware). Kept 90 days, at most 100,000 lines, oldest dropped.
- One line per operation: `{ at, op, model, fingerprint, runtime, device, quantization, items,
  tokens?, ms, loadMs?, peakRssMB?, vramMB?, partialOffload?, project?, jobId? }`.
- `op` ∈ `embed.query`, `embed.index` (per batch), `rerank`, `search.bm25`, `search.vector`,
  `search.total`, `model.load`, and for context `claude.run` (the Claude part of a generation, so the
  share of retrieval in a whole run is visible).
- **No document text** and no query text in the journal: only ids, counts and times.
- `models.perf` aggregates per `op` × model × device: count, p50, p95, items per second, peak memory.
  The benchmark's resource figures (§10.4) come from the same journal: one way of measuring.
- Settings › Models shows, per installed model, « on this PC: query 40 ms, index 120 passages/s ».

### 7.10 Upgrade / downgrade advice

Testimus suggests, it never switches by itself. A suggestion names its reason with numbers.

- **Budgets** (`settings.json.rag.budgets`, per machine, defaults): `queryMs: 1000` (p95 of
  `embed.query` + `rerank`), `indexPassagesPerSec: 5` (whole corpus in under 10 minutes at
  ≈ 2,000 passages), `headroom: 0.15`.
- **Downgrade** when, over the last 50 operations of a kind: the p95 exceeds the budget; or the model
  ran partly on the CPU; or a load failed for memory. With a pack active (§7.12), the next variant of
  the pack first, then the next lighter pack (Quality → Balanced → Performance → Light). With
  hand-picked models, the `lighter` entry of §7.2 (8B Q8 → 8B Q4 → 4B Q8 → 4B Q4 → 0.6B). Always the
  first whose fit (§7.8) is « fits ».
- **Upgrade** when the p95 stays under 20 % of the budget over 50 operations and the heavier pack (or
  `heavier` entry) fits with the reranker in place.
- **Quality side**: when the benchmark (§10) has reports for both fingerprints on this project, the
  suggestion carries the measured difference (« −3 points of evidence recall, interval −5…−1 »);
  without them it says « quality difference not measured » and proposes `rag.eval` on the candidate.
- A suggestion dismissed is not shown again for that pair until the numbers change by more than 25 %.
- `models.advice` returns the same suggestions to the CLI and to Claude.

### 7.11 Doctor

New rows: models folder chosen and free space; active embedding installed and verified; its space
complete; Ollama reachable when a project on this PC uses an Ollama model; the llama.cpp build found
when a reranker needs it; a model on C: with less than 10 GB free is a warning; the active embedding +
reranker fit (§7.8); a model that Ollama reports as partly on the CPU (§7.8) is a warning.

### 7.12 Packs

Most users should not pick an embedding, a reranker, a quantization and a runtime one by one. The app
offers **packs**: a named intent that resolves to a concrete configuration on this PC. Choosing models
one by one stays possible (« Custom »).

**A pack** is data in the catalog (`catalog.json.packs`):

```json
{
  "id": "quality",
  "label": "Quality",
  "intent": "The most complete and precise search this PC can run; slower to index.",
  "variants": [
    { "embedding": "qwen3-embedding-8b-q8", "reranker": "qwen3-reranker-4b-q8" },
    { "embedding": "qwen3-embedding-8b-q4", "reranker": "qwen3-reranker-4b-q8" },
    { "embedding": "qwen3-embedding-4b-q8", "reranker": "qwen3-reranker-0.6b-q8" }
  ],
  "retrieval": { "candidates": 80, "rerank": { "top": 40, "mode": "topk" } }
}
```

- A variant names models, not runtimes: each model then gets its source and runtime by the rule of §7.2
  (already here · Ollama if it holds it and `useOllama` is `auto` · else download + llama.cpp or
  transformers.js).
- `variants` are tried in order; the pack **resolves** to the first variant whose embedding and reranker
  are installable here and fit together (§7.8).
- **Ollama-free rule (P8), checked by a unit test over `catalog.json`:** every pack resolves on a PC
  where Ollama is absent — every model it names has a Hugging Face source and a runtime among
  `transformers` / `llamacpp`; and Light and Performance resolve with **transformers.js alone**
  (nothing to download but model files, no llama.cpp). The card says which variant applies on this PC and why
  the ones above it were skipped (« 8B + 4B reranker: 13.9 GB needed, 12.7 GB usable »).
- `retrieval` overrides the retrieval settings of §4.3 for this pack; thresholds stay per model (§4.5).
- A pack never names a model that is not in the catalog; a pack whose every variant fails to fit is shown
  as « not available on this PC » with the reason.

**First packs** (a proposal: the variants and their order are fixed by the benchmark, R10):

| Pack | For | Variants, in order (embedding + reranker) |
|---|---|---|
| **Light** | any PC, no GPU, smallest download — today's default | bge-m3 q8 (transformers, CPU) + none |
| **Performance** | the fastest search with good quality; a GPU helps but is not required | Qwen3-Embedding 0.6B ONNX fp16 (transformers.js, DirectML) + none · Qwen3-Embedding 0.6B ONNX q8 (transformers.js, CPU) + none |
| **Balanced** | a GPU with ≥ 8 GB | Qwen3-Embedding 4B Q8_0 + Qwen3-Reranker 0.6B Q8_0 · Qwen3-Embedding 4B Q4_K_M + bge-reranker-v2-m3 (transformers.js, CPU) |
| **Quality** | a GPU with ≥ 12 GB | Qwen3-Embedding 8B Q8_0 + Qwen3-Reranker 4B Q8_0 · Qwen3-Embedding 8B Q4_K_M + Qwen3-Reranker 4B Q8_0 · Qwen3-Embedding 4B Q8_0 + Qwen3-Reranker 0.6B Q8_0 |

Light and Performance need transformers.js only (inside the app). In Balanced and Quality, every
GGUF model runs with llama.cpp downloaded by the app, or with Ollama when it already holds the same
file (§7.2). **No pack needs Ollama.**

On the dev PC ⚠️ to measure: Quality's first variant needs 9.1 GB (measured) + ≈ 4.5–5 GB for the 4B
reranker (estimated from its 4.1 GB file) against ≈ 15 GB free with the desktop running: « tight » by
the 15 % margin of §7.8. Whether it resolves to variant 1 or 2 is decided by the measured figure, not by
this estimate.

**Choosing a pack** (`models.usePack`): shows what will be downloaded (size, where — the storage
question of §7.3 if not answered yet; Ollama pulls through Ollama), what will be reindexed (a new vector
space, §6, the previous one kept), and the expected speed when the journal knows it; then installs what
is missing, activates the variant for the open project on this PC (§6.4) and starts the index job.

**What a pack card shows** (Settings › Models, top of the page): the pack's intent; the variant that
applies here and its fit; download size still needed; on this PC, measured query time and indexing
speed (§7.9); on this project, measured evidence recall from the benchmark (§10) when a report exists,
else « quality not measured yet ».

**Packs and the rest:**
- The team reference (`project.json.rag.reference`, §6.4) may name a pack (`{ "pack": "balanced" }`)
  instead of two models; each PC resolves it for its own hardware. Two PCs on the same pack may then run
  different variants: the evidence is the same (P1), the ranking may differ.
- The advice of §7.10 speaks in packs first (« move to Performance: queries take 2.4 s at p95 here »),
  and walks the variants inside a pack before proposing another pack.
- The benchmark measures each **variant** (it is what has a fingerprint) and reports it under its pack.
- Hand-picked models show as the « Custom » pack.

## 8. Runtimes

### 8.1 Seam

The existing `Embedder` type becomes two small interfaces chosen by the catalog entry's `runtime`:

```ts
type EmbeddingRuntime = { probe(m): Promise<{ dims: number; maxTokens: number }>; embed(m, texts: string[], mode: "query" | "doc"): Promise<Float32Array[]> };
type RerankRuntime = { rerank(m, query: string, texts: string[]): Promise<number[]> };
```

Implementations: `transformers` (exists), `ollama` (new), `llamacpp` (later, experimental), `mock`
(exists, for tests).

### 8.2 transformers.js

- `device` per installation: `cpu` (default), `dml` (DirectML, shipped in onnxruntime-node on
  Windows ✅), `webgpu` (experimental); `dtype` per device from the catalog.
- Truncation by tokens (`maxInputTokens`), not by 4,000 characters (F9).
- Last-token pooling: left padding so batches work again (⚠️ check transformers.js padding-side support),
  else batches of 1.
- Rerankers: `cross-encoder` as today; `yes-no-lm` (Qwen3-Reranker) only if the benchmark asks for it.

### 8.3 Ollama ✅ API (docs/api.md of the Ollama repository)

**Removed by decision of 2026-11-02 (D-12): Testimus does not use Ollama.**

- Host: `OLLAMA_HOST` or `models.json.ollama.host`, default `http://127.0.0.1:11434`. A host that is
  not loopback is refused (P5).
- Detection: `GET /api/version`; if it fails, look for `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`
  (present on the dev PC ✅) to tell « not running » from « not installed ».
- Listing: `GET /api/tags` → `models[{ name, model, digest, size, details }]` (`details`:
  `parameter_size`, `quantization_level`); `POST /api/show` → `model_info` and `capabilities`. For the
  Qwen3 embeddings ✅: `capabilities` contains `"embedding"`, `model_info` gives
  `qwen3.embedding_length` (1024 / 2560 / 4096), `qwen3.context_length` (32,768 for 0.6b, 40,960 for
  4b and 8b) and `qwen3.pooling_type` 3 (last token). An entry is offered for search when its
  capabilities contain `"embedding"`.
- Embedding: `POST /api/embed { model, input: string[], truncate, dimensions, keep_alive }` →
  `embeddings` ✅ (tried with the instruction prefix added by the app). Batches of 16–32.
  `prompt_eval_count` is logged to spot truncation. ⚠️ Still to check: that Ollama's Qwen3 template does
  not add an instruction of its own.
- Measured on the dev PC ✅: once loaded, 4 short texts in 1.7 s with the 8B Q4 (load included in the
  first call: 1.5–17 s depending on the model and the disk); the first timings were inflated by
  downloads running at the same time, which is why the journal of §7.9 keeps percentiles, not one value.
- Pull: `POST /api/pull { model, stream: true }` → `status`, `total`, `completed` as job progress.
- Delete: `DELETE /api/delete { model }`, only after the user confirms.
- Fingerprint uses the `digest`: a model updated by `ollama pull` is a new space.
- **No rerank endpoint is documented**: rerankers run through transformers.js or llama.cpp.
- Ollama is never required (SPEC §14): a project whose model is served by Ollama on a PC without it
  falls back as §6.4 says, and the doctor says what to do.

### 8.4 llama.cpp (GGUF embeddings and rerankers)

llama.cpp is the runtime that makes P8 true for the 4B and 8B models: it serves the GGUF embeddings
(`--embedding --pooling last -ub 8192`, OpenAI-style `POST /v1/embeddings { input: string[] }` →
`data[].embedding`) and the GGUF rerankers (below), from files the app downloaded itself. Tried for
embeddings ✅ in §16.4.

Tried on the dev PC ✅ with the official ggml-org build b12032 (CUDA 13.4 + cudart, Windows x64, a zip:
no installer, no admin). It runs on the RTX 5080 with driver 591.44 (CUDA 13.1); `--list-devices`
shows `CUDA0: NVIDIA GeForce RTX 5080`. The Vulkan build is the fallback for other GPUs, the CPU
build for none.

- **Testimus starts and stops the server itself**, like a model load, one server per loaded model:
  `llama-server.exe -m <gguf> (--reranking --pooling rank | --embedding --pooling last -ub 8192) -ngl 99
  --host 127.0.0.1 --port <free port> -c 8192 --api-key <random per start>` (a request without the key
  gets HTTP 401 ✅), waits for `GET /health` = `{"status":"ok"}`, calls `POST /v1/rerank { query, documents,
  top_n }` → `results[{ index, relevance_score }]`, and stops the process after 10 idle minutes or on
  exit. The server warns that, without an API key, it answers any origin (CORS `*`): a web page open in
  the browser could call it. Hence loopback only **and** a random key.
- The build is a runtime installation like a model: `models.json.llamacpp = { exe, build, backend:
  "cuda" | "vulkan" | "cpu" }`, found by path (A) or downloaded from the GitHub releases of
  `ggml-org/llama.cpp` (B). The backend is chosen from the machine profile (§7.8): CUDA when an NVIDIA
  driver supports the build's CUDA major version, else Vulkan, else CPU.
- Results ✅ (§16.3): the three Qwen3-Reranker GGUF Q8_0 rank the answer first; ready in 1.1 / 2.5 /
  4.1 s, 5 passages in 27 / 60 / 99 ms (0.6B / 4B / 8B), each pair about 106–156 tokens (Qwen3's
  instruction template applied). The bad rankings of llama.cpp issue #16407 did not show on this build
  and these files; the benchmark keeps watching for them.
- Offload is not written in the log at the default verbosity: the measured speed shows the GPU; the
  journal reads `nvidia-smi` memory before and after the load (§7.9).

## 9. Hardware tiers

Suggestions shown by `models.catalog`, never requirements:

| Tier | Machine | Suggested |
|---|---|---|
| light | CPU only, ≥ 8 GB RAM | bge-m3 q8 or Qwen3-Embedding-0.6B q8 (transformers, CPU) |
| standard | ≥ 16 GB RAM, or a GPU with ≥ 4 GB | Qwen3-Embedding-0.6B fp16 on DirectML, or `qwen3-embedding:4b` (Q4_K_M, 3.4 GB VRAM) via Ollama |
| quality | GPU ≥ 12 GB VRAM | `qwen3-embedding:4b-q8_0` / `:8b-q8_0` (9.1 GB VRAM) via Ollama; reranker optional, checked together with the embedding (§7.8) |

On the dev PC (RTX 5080 16 GB) ✅: the 8B embedding in 8-bit takes 9.1 GB of VRAM; with the 8B
reranker in 8-bit (7.7 GB file) the pair does **not** fit together (§7.8 would say « tight » or « GPU
too small »); 8B embedding Q8 + 4B reranker Q8 does. The 8B in fp16 (14.1 GB) leaves no room for
anything else. The corpus is small (≈ 2,000 chunks), so indexing time is
not the question; quality and portability are.

Position until measured: **8B is the ceiling probe of the benchmark** (if it barely beats 0.6B on
evidence recall, the embedding is not the bottleneck); **4B is the quality candidate**; 0.6B or bge-m3
is the light default. Published gaps between 4B and 8B (≈ 1–2 MMTEB points ⚠️) are below what a
50-behavior set can detect.

## 10. Benchmark

### 10.1 Gold set v2 — `eval/behaviors.jsonl`

One line per functional behavior, with **all** its evidence:

```json
{"id": "sectionneur-sans-tk-menu",
 "question": "Que propose le menu contextuel d'un sectionneur sans TK, et dans quels cas diffère-t-il ?",
 "queries": ["menu contextuel sectionneur", "sectionneur sans TK"],
 "evidence": [
   {"ref": "SOSIE_211_D401-1_3#req:EXI_MOP_SPF_511_A_1670", "role": "rule", "must": true},
   {"ref": "SOSIE_211_D401-1_3#§5.6.6", "role": "condition", "must": true},
   {"ref": "SOSIE_211_D401-1_3#fig:40", "role": "figure", "must": false}
 ]}
```

Roles: `definition`, `rule`, `condition`, `exception`, `amendment`, `contradiction`, `figure`.
`eval/questions.jsonl` stays readable (each expected anchor = a `rule`, `must: true`).

### 10.2 Building it

- 30–60 behaviors chosen by the testers, covering: one section; distant sections of one document;
  several documents; exceptions; PA amendments; figure-only facts; acronym-only queries.
- Bootstrap without circularity: Claude reads the **whole** document (the largest is ≈ 90k tokens ⚠️)
  and proposes the candidate evidence; a tester validates each item. The retriever under test never
  builds its own gold.

### 10.3 Two levels

- **L1 — retrieval alone** (cheap, deterministic, many configurations): for each behavior, the
  question and the `queries`, under a fixed policy (`search`, then `search` + `related` + `mentions`).
  - evidence recall@k (share of `must` evidence in the top k; k = 10, 20, 50);
  - complete@k (every `must` found);
  - recall by role (exceptions, amendments and contradictions reported on their own);
  - precision@k, nDCG@10, MRR (kept for continuity);
  - characters returned to Claude (context cost).
- **L2 — end to end with Claude** (expensive, few configurations, at least 3 runs each because Claude
  is not deterministic): `gen.tests` on the behavior; from the ledger (§5.3) the agentic recall (share
  of the evidence actually opened); then requirement coverage, mechanical and semantic findings,
  quote errors, the review verdict on a sample, cost and duration.

### 10.4 Resources

Index time and vectors per second; query latency p50 / p95 (embedding, search, rerank); peak RAM
(`process.resourceUsage().maxRSS`); VRAM (Ollama `/api/ps` `size_vram` ✅, `nvidia-smi` for llama.cpp
✅; ⚠️ not measurable from Node under DirectML on a non-NVIDIA GPU); disk (model + space); download
size. All read from the timings journal (§7.9).

### 10.5 Reports

Every report stores the full configuration: chunker version, header mode, space fingerprint, retrieval
settings, reranker, k, corpus hash, gold hash, app version. Reports in `.testimus/eval/`.

### 10.6 Deciding

Comparisons are paired per behavior with a bootstrap 95 % interval on the difference in `must`
recall. A configuration is adopted only when the interval excludes zero and no role (exceptions first)
goes down. Then SPEC §5 records the result and `project.json.rag.reference` changes.

### 10.7 Commands

`rag.eval` v2 (L1; set; any retrieval or model override), `rag.compare` (reports → table with
intervals), `gen.bench` (L2; a job; explicit and costly). Later: an Eval view under Settings › Search.

### 10.8 First experiments, in order

1. Today's system (baseline).
2. + requirement statements, matrix rows, graph, passage cap (§3).
3. + `rag.mentions` / `rag.related` in the L1 policy (§4.1).
4. + French stemming, glossary, stop words (§4.2).
5. Embeddings: bge-m3 · Qwen3-0.6B (transformers) · Qwen3-4B · Qwen3-8B (Ollama).
6. Rerankers on the best of 5: none · bge-reranker-v2-m3 · Qwen3-Reranker 0.6B / 4B; `topk` vs `threshold`.

## 11. Figures and visual retrieval

- Upstream losses come first: `.emf` / `.wmf` kept unconverted, shapes drawn in Word, captions whose
  picture was pasted as text (Figures 22–42 of D401-1_3; the `--pdf` recovery exists). ⚠️ An EMF/WMF
  renderer without native tools is an open question.
- Descriptions v2 with verbatim `labels` (§5.4) make screenshots findable by the words on them.
- **Multimodal embeddings are deferred.** Qwen3-VL-Embedding (2B and 8B, January 2026 ⚠️) would be a
  second space in another vector geometry for a few hundred pictures, and Claude can already open any
  image. Reopen if, after descriptions v2, L1 recall on the `figure` role stays poor.

## 12. Deliberately unchanged

- `doc.md` with its three anchor kinds, and the verbatim-quote rule.
- One SQLite file per project index; FTS5 + sqlite-vec in exhaustive mode; no vector server.
- Claude searches and reads for itself; no context stuffing.
- RRF as the fusion.
- One command registry; no route, tool or button outside it.
- No hosted service; nothing leaves the PC except inside Claude runs.
- The index stays per machine and is not shared.
- No ColBERT / multi-vector, no multimodal embedding, no reranker in the generation loop, in this round.

## 13. Phases

Each ends on SPEC §15 and moves its behavior into SPEC.md.

| Phase | Content |
|---|---|
| R1 | Benchmark v2: gold format, L1 metrics, `rag.compare`, reports with fingerprints. **Before any model choice.** **Built — SPEC §5 « Benchmark ».** |
| R2 | Evidence model: statements, matrix rows, graph, passage cap, `quote-not-at-anchor`, `quote-weak`. **Built — SPEC §4, §5, §8.** |
| R3 | `rag.mentions`, `rag.related`, `expand`; skills updated; evidence ledger. **Built — SPEC §5, §7, §8, §9, §11.** |
| R4 | French lexical search: stemmed column, glossary, stop words. **Built — SPEC §5.** |
| R5 | Vector spaces by fingerprint, migration, per-machine activation, BM25 fallback. **Built — SPEC §5.** |
| R6 | Model manager: catalog, `models.*`, storage folder question, path and download (SHA-256 checked), Settings › Models, doctor rows. **Built — SPEC §5, §13, §14.** |
| R7 | Ollama runtime: detection, listing, embedding, pull and delete, UI panel. **Removed (D-12)**: built, then removed by decision of 2026-11-02; GGUF runs on llama.cpp only. |
| R8 | Hardware fit (§7.8), timings journal (§7.9), upgrade / downgrade advice (§7.10), packs (§7.12). **Built — SPEC §5, §13.** |
| R9 | llama.cpp runtime for rerankers: managed server, backend choice (§8.4). **Built — SPEC §5, §14.** |
| R10 | Run the experiments of §10.8; set reranker thresholds per model; adopt by evidence; record in SPEC §5. |
| R11 (optional) | Qwen3-Reranker through transformers.js (`yes-no-lm`), figure descriptions v2, multimodal reconsidered. |

R6–R9 do not depend on R2–R4 and can run beside them. The journal (R8) should land before R10 so the
benchmark's resource figures come from it. R10 needs R1, R5 and R9 (R7 removed, D-12).

## 14. Open questions

1. Per-machine activation keyed by the project folder path: the same SharePoint project syncs to a
   different path per user. Key by path, or by `project.json.name` + path?
2. An Ollama on another host (a team GPU server) would send document text over the network: allowed or
   not? Needs a SPEC decision (today: no, P5).
3. Sharing a built vector space between PCs with the same fingerprint (export / import), to spare a
   laptop the embedding run: worth it at ≈ 2,000 chunks?
4. Matrix detection on the other document families (§3.2) and section-level amendments in PA
   documents (§3.3).
5. VRAM on non-NVIDIA GPUs without native tools (§7.8); NVIDIA is solved by `nvidia-smi`.
6. EMF/WMF rendering without native tools (§11).
7. Qwen3 recommends English instructions ⚠️: keep `queryTask` in English for French documents? The
   benchmark decides.
8. Which French stemmer library (pure JS, licence, maintenance).
9. Default budgets of §7.10 (`queryMs: 1000`, `indexPassagesPerSec: 5`): to be set from the first weeks
   of the timings journal on the testers' PCs, not only on the dev PC.
10. Shipping llama.cpp: by download on demand (B) only, or inside the release for the CPU build
    (≈ 23 MB)? The CUDA build with its runtime is ≈ 560 MB.
11. Packs: are four the right number, and their names (Light · Performance · Balanced · Quality)? The
    first-run screen could ask « Which pack? » with the one that fits best preselected, or start on
    Light and let the advice of §7.10 propose more after the first searches.

## 15. Sources outside the code

- llama.cpp releases (Windows builds `win-cuda-13.4-x64`, `cudart-…`, `win-vulkan-x64`, `win-cpu-x64`):
  https://github.com/ggml-org/llama.cpp/releases
- Ollama tags with explicit quantizations (`qwen3-embedding:4b-q8_0`, `:8b-q8_0`, `:…-fp16`), read from
  the registry manifests `https://registry.ollama.ai/v2/library/qwen3-embedding/manifests/<tag>`.
- Hugging Face tree API with SHA-256 per file: `https://huggingface.co/api/models/<repo>/tree/main`.

- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md (`/api/embed`, `/api/tags`,
  `/api/show`, `/api/pull`, `/api/delete`, `/api/version`, `/api/ps`; no rerank endpoint).
- Ollama `qwen3-embedding` tags 0.6b / 4b / 8b: https://registry.ollama.ai/library/qwen3-embedding/tags
- Qwen3 embedding sizes and MMTEB scores (secondary):
  https://www.glukhov.org/post/2025/06/qwen3-embedding-qwen3-reranker-on-ollama/
- No native rerank in Ollama (secondary, 2025):
  https://glukhov.org/fr/rag/reranking/reranking-with-ollama-qwen3-reranker-golang/
- Third-party ONNX export of Qwen3-Embedding-4B for transformers.js:
  https://huggingface.co/dssjon/Qwen3-Embedding-4B-ONNX
- llama.cpp rerank issue: https://github.com/ggml-org/llama.cpp/issues/16407
- Qwen3-VL-Embedding report: https://arxiv.org/abs/2601.04720

## 16. Tried on the dev PC (2026-11-02)

Smoke tests, not a benchmark: they prove each model and runtime works here, not which one is best.
Machine: RTX 5080 16 GB (driver 591.44, CUDA 13.1), Core Ultra 9 285K (24 threads), 64 GB RAM,
Windows 11. Locations in LINKS.md.

### 16.1 Installed

| What | Where | Size |
|---|---|---|
| ONNX embeddings and rerankers (q8 + fp16), Qwen3-Reranker GGUF 0.6B / 4B / 8B Q8_0, official Qwen3-Embedding GGUF 0.6B Q8_0 · 4B and 8B Q4_K_M + Q8_0 | `D:\transformers-models` | 37 GB |
| Ollama `qwen3-embedding` 0.6b, 4b, 8b (Q4_K_M) and 4b-q8_0, 8b-q8_0 — used for §16.2 and the parity column of §16.4, then **Ollama uninstalled** (same files kept as Qwen GGUF above) | (removed) | — |
| llama.cpp b12032 CUDA 13.4 and Vulkan builds | `D:\llama.cpp` | 1.4 GB |

Every Hugging Face file matches its published SHA-256.

### 16.2 Embeddings (Ollama, all fully on the GPU)

Question « Que se passe-t-il pour les DSO quand on met hors tension les voies principales ? » (with the
Qwen3 instruction prefix) against three passages of D401-1_3: the answer (EXI_MOP_SPF_511_A_20), a
neighbour (disjunction alert) and an unrelated one (sectionneur menu). Cosine similarity:

| Model | Dims | VRAM | Answer | Neighbour | Unrelated |
|---|---|---|---|---|---|
| 0.6b (Q8_0) | 1024 | 1.23 GB | 0.816 | 0.438 | 0.182 |
| 4b (Q4_K_M) | 2560 | 3.43 GB | 0.791 | 0.577 | 0.362 |
| 4b-q8_0 | 2560 | — | 0.812 | 0.566 | 0.345 |
| 8b (Q4_K_M) | 4096 | 5.73 GB | 0.829 | 0.572 | 0.331 |
| 8b-q8_0 | 4096 | 9.10 GB | 0.815 | 0.538 | 0.297 |

All five rank the answer first.

### 16.3 Rerankers

Same question against five passages: the answer, « L'actionnement d'un DG permet … la mise hors tension
de l'ensemble de la ligne », the ways the contact rail is de-energised, the disjunction alert, the
sectionneur menu.

| Passage | Qwen3 0.6B | Qwen3 4B | Qwen3 8B | bge-reranker-v2-m3 |
|---|---|---|---|---|
| Answer (DSO rule) | 0.9999 | 0.9999 | 0.9996 | 0.9945 |
| DG | 0.9958 | 0.8953 | 0.7130 | 0.0093 |
| Ways of de-energising | 0.9517 | 0.8562 | 0.2156 | 0.0106 |
| Disjunction alert | 0.0019 | 0.0234 | 0.0281 | 0.0000 |
| Sectionneur menu | 0.0001 | 0.0023 | 0.0005 | 0.0000 |
| 5 passages | 27 ms | 60 ms | 99 ms | 152 ms |

Qwen3 through llama.cpp on the GPU (GGUF Q8_0); bge-reranker-v2-m3 through today's Testimus code on the
CPU (q8). Not tried: Qwen3-Reranker-0.6B ONNX, which needs the `yes-no-lm` implementation (§8.2).

### 16.4 Without Ollama — official Qwen GGUF on llama.cpp alone

Files downloaded from `Qwen/Qwen3-Embedding-{0.6B,4B,8B}-GGUF` (Apache-2.0, not gated) into
`D:\transformers-models\Qwen\`, SHA-256 checked; served by `llama-server` b12032 CUDA (no CUDA toolkit
installed on the PC: the zip and the NVIDIA driver are enough). Same question and passages as §16.2.

| File | Ready | 4 texts | Dims | Answer | Neighbour | Unrelated | Same vector as Ollama? |
|---|---|---|---|---|---|---|---|
| 0.6B Q8_0 | 1.1 s | 9 ms | 1024 | 0.815 | 0.440 | 0.181 | cos 0.9996–0.9997 |
| 4B Q4_K_M | 2.1 s | 22 ms | 2560 | 0.790 | 0.581 | 0.357 | cos 0.9985–0.9991 |
| 4B Q8_0 | 2.6 s | 22 ms | 2560 | 0.815 | 0.569 | 0.345 | cos 0.9998–0.9999 |
| 8B Q4_K_M | 2.6 s | 34 ms | 4096 | 0.831 | 0.575 | 0.330 | cos 0.9993–0.9994 |
| 8B Q8_0 | 4.1 s | 35 ms | 4096 | 0.814 | 0.540 | 0.297 | cos 0.9998–0.9999 |

Every pack can therefore run without Ollama (P8 proven for the GGUF models; the ONNX ones run in
transformers.js inside the app). Same scores as Ollama to the second or third decimal, but not
bit-identical vectors (the gap is larger in Q4): the runtime stays part of a vector space's fingerprint
(§6.1); a space built with one runtime is not searched with the other.

**GPU shared between runtimes.** A first run of the 8B Q8 on llama.cpp took 333 ms instead of 35 ms:
Ollama still held `qwen3-embedding:8b-q8_0` (9.1 GB, kept 5 minutes after its last call by default)
while llama.cpp loaded its own ≈ 9 GB, so part of the model went to the CPU. After unloading Ollama's
copy (`/api/embed` with `keep_alive: 0`), 35 ms.

### 16.5 Benchmark R10 (L1, provisional)

Run on 2026-11-02 over the 22 current J5 documents with a bootstrap set of 40 behaviors (181 evidence items, Claude
read the documents; **not yet validated by the testers**). The figures, the thresholds chosen and the decisions are in
SPEC.md §5 « Benchmark results »; the full tables are in `.build/v2/r10-results.md`. In short: the graph tools make
every configuration near-complete (0.96–1.00 must recall @10); under search alone no embedding beats bge-m3 q8;
8B Q4 + Qwen3-Reranker in threshold mode is the only adopted configuration, at k = 10 and 20; the reference stays
Light; Quality and Balanced now prefer Q4_K_M.
