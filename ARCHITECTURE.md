# ARCHITECTURE.md — how Testimus is built, and why

What the system is made of, the rules each part keeps, the file formats, and the decisions with their reasons.
It replaces SPEC.md, SPEC-RAG.md and SPEC-ELECTRON.md (removed on 2026-11-06; their full text is in git history,
last at `d42ef1d`). It describes structure and durable rules, not every label of every screen: behavior lives in the
code and its tests. Update this file when a rule, a seam, a file format or a decision changes. How to work in the
code is CODE.md; what comes next is ROADMAP.md.

## 1. What Testimus does

Testimus turns a pile of specification documents into **Xray manual tests a tester can trust**:

```
documents ─► conversion (doc.md + figures, stable anchors) ─► index (RAG) ─► generation with sources
          ─► check (mechanical + semantic) ─► human review (Validate / To fix) ─► Xray sync (pull / push)
```

**Claude Code (`claude -p`) is the worker at every stage**, and every stage is a command that a human (UI), a script
(CLI) and Claude (MCP) call the same way. First customer: the RATP Sosie testing team (Jira `LFRPS12`, specs
`SOSIE_*_D401-1_*`, about ten documents and 900 pages). The app is generic: any Jira project, any document set.

What it replaces: specs pasted into NotebookLM / SurfSense (no skills, images lost, dead citations), a CSV imported
into Xray by a script, review done in Jira after import, Xray Editor's three fixed step fields.

## 2. Stack (decided — reopen only with a reason written here)

- **One TypeScript code base on Node 26 LTS.** The release ships its own Node, so colleagues' PCs need none.
  **Node runs the `.ts` files itself** (type stripping): no `tsx`, no build step in development. The code is
  erasable-only (`erasableSyntaxOnly`: no `enum`, `namespace`, constructor parameter properties) and imports
  name `.ts` files.
- **UI**: React 19 + Vite 8 (Rolldown). No UI library.
  - **StyleX** for every style (reopened 2026-11-03: fifteen hand-written sheets had drifted, 1 839 px sizes, one area
    patching another's components). Tokens are `src/ui/styles/tokens.stylex.ts`, generated from the design system's
    `design/tokens.css`; a component's styles live in its `.tsx`, so a deleted component takes its styles with it and an
    unknown token breaks `tsc`. Compiled at build time; no runtime injection, no CSS file but the fonts, no raw HTML.
  - **TanStack Query v5** is the one data layer (reopened 2026-11-03: that work had been written by hand in 58 effects,
    4 window events, 12 module stores and 3 autosave timers).
  - Fonts (Inter, Source Serif 4, JetBrains Mono) are bundled from `@fontsource-variable/*`: offline and proxy-proof.
- **Why not Tauri** (as Xray Editor): the index needs native Node modules (SQLite, ONNX runtime). The UI is a local
  web page; the **desktop app** is an Electron shell (pinned exact, 45.2.1) around `testimus serve` (§15).
- Libraries: `zod` 4 (one schema per command → CLI, MCP, HTTP); `@modelcontextprotocol/server` (MCP SDK v2, stdio);
  **`node:sqlite`** + `sqlite-vec` as an extension (replaces `better-sqlite3`: one native module fewer; FTS5 compiled
  in; `node:sqlite` is still a release candidate, so the index code stays in `src/core/rag/` and a fallback touches one
  folder; `sqlite-vec` in exact mode, its ANN indexes are alpha and useless at this scale); `@huggingface/transformers`
  4 (local ONNX); `mammoth` (docx), `pdfjs-dist` (PDF); `sharp` (pictures, already shipped with transformers.js).
  HTTP and argv are `node:http` and `node:util.parseArgs`.
- Tooling: TypeScript 7 (native `tsc`, type check only), Vite 8 (UI; Rolldown also bundles the core for the release,
  native parts kept outside), vitest, Playwright, **Biome** (lint + format).
- **Considered and left out**, so nobody adds them by reflex: React Compiler; a UI kit, Radix/MUI, Tailwind (the kit
  is ours; a headless primitive is allowed for one component only if accessibility demands it, with the reason written
  here); Storybook (the catalogue is the app's own `#/kit`); **Effect** (would help with cancel, timeouts, retries and
  cleanup, but not with the worst risk — the parent killed —, would duplicate zod and mix two paradigms; that code lives
  in `src/shared/run/` instead. Reopen Effect for that layer if it grows past ~500 lines or a cancel/cleanup defect
  comes back); an HTTP framework; an ORM; a hosted vector database; `tsx`/`ts-node`; Node single-executable packaging
  (cannot carry the native modules cleanly); Ollama (removed 2026-11-02, decision D-12: GGUF models run on llama.cpp,
  which Testimus downloads itself; an Ollama on the PC is ignored); Python converters (Docling, MarkItDown — Python is
  ruled out on colleagues' PCs).
- Claude = the **Claude Code CLI** on the user's subscription. Never the Agent SDK (it needs an API key).
- Code from Xray Editor (`D:\Projects\XrayEditor`) is **copied and adapted**, never shared as a package; Xray Editor
  stays as it is for BHP.

## 3. Processes and seams

```
            ┌──────────────── core (Node) ─────────────────┐
  UI  ─HTTP─►  commands registry  ──►  domain modules      │
  CLI ──────►  (zod schema, run)       docs · rag · tests  │──► project folder (files)
  MCP ──────►                          gen · check · review│──► index/rag.db (SQLite)
            │                          xray · claude       │──► Jira REST + Xray GraphQL
            └──────────────────────────────┬───────────────┘
                                           └──► claude -p (cwd = project folder)
                                                 └──► calls back through `testimus mcp`
  Electron shell ──spawns──► serve ; talks to /api only
```

- **One registry, three faces.** A command is `{ name: "<group>.<verb>", input: zod, output: zod, mutates, run(ctx,
  input) }` in `src/core/commands/<group>.ts`. The registry derives the CLI verb (`testimus <group> <verb>`, `--json`
  everywhere), the MCP tool (`<group>_<verb>`) and the HTTP route (`POST /api/<group>/<verb>`). The faces hold no domain
  logic. **A feature that exists only in the UI is a bug**: Claude loses the ability to do it.
- `ctx` carries the project folder, settings, an `AbortSignal`, progress (CLI prints, HTTP streams, MCP notifies), the
  activity tracker, and `invoke` (another command of the same project; no command imports the registry). The registry's
  type `CommandMap` (name → input, output, job or not) is what the page imports — types only — so an unknown command
  name does not compile.
- **`src/core/env.ts` is the one seam**: `http`, home and data dirs, `spawnClaude`. Tests and `--mock` swap it.
- **Long work is a job** (`src/core/jobs.ts`): id, progress, steps, cancel, rerun (`jobs.rerun`, the same input, the new
  job caused by the old), a log in `<project>/.testimus/jobs/<id>.jsonl`. Before it ends a job says which project files
  it added, modified or removed (`changed`). A job keeps two words for what it works on: `subject`, what the command
  was given (a test id, a document id — the page and the code key on it), and `label` (optional, added 2026-11-08; an
  older job has none), the name a person knows it by when it started — the test's summary, the document's title —
  from the command's `label(input, project)` (`src/core/lib/names.ts`). Messages the core writes for a person (progress,
  log, process titles) name a test by its summary the same way; a message the page parses (`Writing <id>`) keeps its id.
- **Events name their project.** One `/api/events` SSE stream; every event carries `project` (null = the machine's own
  work). A recursive watcher per open project (`src/core/watch.ts`) emits one `changed` event per burst of writes (200 ms
  after the last, at most 1 s apart while writes go on), the project's `CLAUDE.md` included, `index/` and `.testimus/`
  left out (but proposed actions), `.claude/` left out (but its skills, which Settings › Context shows). Whoever wrote the file — the app, Claude Code in a terminal, a sync — the page reads
  again what changed.
- **Errors**: a `UserError` carries a `fix` (what the user can do) and may carry a stable `code` a page branches on
  (`conflict` = the file moved since it was read → HTTP 409; `edited-after-run`, `doc-gone`, `models-dir-unset`,
  `not-a-document`…). A failing request never stops the core.
- **One place for processes, waits and cleanup**: `src/shared/run/` (Node only, so the desktop shell may import it).
  `work.ts`: cancellable `sleep`/`timeout`, `retry` (growing delay or `Retry-After`), `semaphore` (the six Jira calls;
  waiters leave on cancel), `scope` (cleanups run last-in first-out whatever ends it), `every`, `debounce` (with
  `maxMs`). `process.ts`: start a program directly or through a `.cmd` shim (cmd metacharacters refused), the registry of
  live children, kill **the whole tree** (`taskkill /T /F` on Windows, process groups elsewhere), lines of stdout/stderr,
  every child killed when the parent goes. Nothing else in `src/` spawns, kills or waits (guard).
- **Stopping is clean.** On stdin closing (`--exit-with-stdin`) or a stop signal, `serve` answers 503 to new requests,
  cancels every job (each ends `cancelled` in its log), kills every `claude -p` tree and stops its llama.cpp servers,
  then exits 0 (a stuck step is cut at 6 s; a second signal exits at once). `testimus mcp` ends when its stdin closes.
- **Reads scale with the project** (2026-11-05). A test's row, a job's summary and the project counts are worked out
  once per *version* of the files they come from (size + mtime + inode, `lib/file-memo.ts`); each read only stats. The
  files stay the truth. A job's summary reads only its status, steps and process lines, never Claude's words. Ids sort
  with one shared natural-order collator (`lib/natural.ts`; a new collator per comparison cost 39 ms per 600 ids).
- **The core is the only writer of managed files** (`.remote.md`, `index/`, `.testimus/`). Claude edits `test.md`
  directly and the core re-reads it. Every file the app owns is written to `<file>.tmp` then renamed (`lib/atomic.ts`;
  folders through `<folder>.tmp`); a guard fails on any other `writeFileSync` in `src/core` outside the model files and
  the mock.

## 4. The project folder — files are the state

A project is **a folder that is also a Claude Code project**: open it in a terminal, run `claude`, and the same skills,
contexts and MCP tools are there. `project init` copies `templates/project/`; every Claude run first brings the
shipped skills up to the app's version (`lib/shipped.ts` `shipSkills`: a skill the team left as shipped — its hash is
in `.testimus/shipped.json` — is replaced, one they edited stays and the new one lands beside it as `SKILL.new.md`, a
missing one is added), so a skill change reaches existing projects without a new `project init`. The folder can live anywhere and is
shared by sharing the folder. Every file is plain text a person can read and edit, owned by one module of the core.
JSON uses camelCase; `test.md` keeps Xray Editor's snake_case frontmatter. *Derived* files can be deleted and are
rebuilt; they are never hand-edited.

```
<project>/
  CLAUDE.md            project rules for Claude (template, then the team's)
  .mcp.json            declares `testimus mcp` (rewritten by every run)
  .claude/skills/      shipped skills (generate-tests, plan-tests, check-test, fix-test, edit-test, ask-docs,
                         define-columns, study-document, draft-comment) + the team's own
  project.json         { name, jiraProject, jiraOffline?, language, labelPrefix, folders, rag: { reference?,
                         queryTask?, passageMaxChars?, retrieval?, claudeHeaders?, describeFigures? },
                         claude: { model, effort, presets, contexts }, glossary? }
  columns.json         the step columns, in display order (below)
  xray.json            derived: Xray's step fields as Xray last gave them
  contexts/<id>/       context.md (frontmatter name, paths) + files/ — reference material attached to runs;
                         the shared library every project sees is <data dir>/contexts/<id>/ (an own id wins)
  docs/<docId>/        one document (§5)
  tests/<id>/          test.md (§7), images/, local.json { contexts?, columns? } (the test's own settings, never
                         part of the test), .remote.md (derived: Jira's last copy), check.json (derived: last
                         check), .state.json (derived: { remoteChangedAt?, generatedPrint? })
  eval/behaviors.jsonl the project's retrieval benchmark set (§6)
  index/rag.db         derived: chunks, full text, vectors per space, graph, last index state; per machine, not shared
  .testimus/           derived, not shared: jobs/, runs/<runId>/ (snapshots), gen/<generation>.json (ledger),
                         chats/, actions/, eval/ (reports), pages/, uploads/, shipped.json, jira-project.json
```

- **`columns.json`** `[{ name, id?, description?, mode: open|filled|collapsed|hidden, referenceSource? }]`. With `id`
  it follows that Xray step field (a rename in Xray keeps the entry); without, or whose field Xray dropped, it is a
  **local column** — kept in `test.md`, never pushed. `description` is what Claude writes in the column. **No column is
  special**: conversion, index, check, skills and UI never know a column by name. An Xray field no entry names comes
  after the entries with its defaults. Reading Xray again makes `columns.json` follow Xray (renames, dropped fields
  become local, a local column created in Xray becomes that field).
- **Global settings** `<data dir>/settings.json` (`%APPDATA%\Testimus`): `{ projects, lastProject, claude: { exe },
  models: { allowRemote }, agents?, ui?, rag?: { byProject, budgets, dismissed } }`. `<data dir>/models.json`: the models
  folder, the installations, the llama.cpp build, the team's own catalog entries. `window.json`: the desktop window.
- **Credentials** are Xray Editor's files, shared with the user's Atlassian skills, read in place, never copied:
  `%USERPROFILE%\.atlassian\credentials.json` `{ baseUrl, email, token }` (Jira base = `baseUrl` without `/wiki`; HTTP
  Basic) and `xray_credentials.json` `{ clientId, clientSecret, apiBase? }` (JWT from `/api/v2/authenticate`, kept in
  memory, renewed on 401). Read tolerantly (BOM, unknown keys). Written only by `system.setCredentials`, **merging**
  (unknown keys and `/wiki` survive). A secret is never logged, put in a job log, a prompt or a `claude -p` argument;
  `system.secrets` is off the MCP server and denied to Claude runs.

## 5. Documents

```
docs/<docId>/
  source.docx | source.pdf   the original, copied in (never the SharePoint file itself); `twin` = the other rendering
  doc.md                     derived: converted text with anchors (body.md + included media parts when batches exist)
  figures/fig-<n>.<ext>      derived: every picture, in reading order
  figures.json               [{ file, anchor, caption, description, labels?, kind? }] — description/labels/kind by Claude
  doc.json                   { code, title, version, date, kind, status, amends?, contexts?, conversion?, source,
                               twin?, converted?: { with, at, warnings, stats }, media? }
  context.md                 what the team says about this document (read by every run)
```

- **Anchors are what sources point at, so they are stable across reconversion — never numbered by position.**
  Headings carry their section number (`## 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->`; unnumbered → slug of the title,
  duplicates `-2`); figures their caption number (`<!-- fig 40 -->`, `f<order>` without caption); PDF pages
  `<!-- page 59 -->`. A source writes them `§5.6.6`, `fig:40`, `page:59`. `rag/anchors.ts` is the one reader of anchors
  (it accepts « § 5.6 », « fig 40 »). A code the documents use (requirement id, alarm code) is text, not an anchor.
- **Conversion prefers `.docx`** (structure and images intact); PDF is the fallback (headings from numbering or font
  size, or the tagged structure; RATP PDFs draw heading numbers as pictures). A `.docx` and the `.pdf` of the same name
  are one document. `doc.json.conversion` keeps how it was converted (chosen by the `study-document` skill or the team),
  so every reconversion gives the same result. A body with no recognised heading becomes one section under the title,
  with a warning.
- **Known losses are reported** in `converted.warnings`, never hidden: Word comments, drawn shapes (labels only),
  `.emf`/`.wmf` (kept as is: converting needs native tools). Text normalisation: NBSP → space, U+2011 → `-`, soft
  hyphens removed, bold/italic kept as `**`/`*`.
- **Figures**: Claude `Read`s each picture (batches of 20, read-only, effort low) → `{ description, labels (every
  visible text, verbatim), kind: screen|diagram|symbol|table-image|photo }`. The caption is the only quotable text of a
  figure; description and labels are Claude's reading, never quotable.
- **The pipeline** (`lib/docs-pipeline.ts`): add (copy only) → convert (job: optional study, conversion, figure
  descriptions, re-check of the citing tests, triage of the warnings by Claude when present) → index (a child job,
  **one index run at a time** per `rag.db`; runs asked for meanwhile share the next one). A failed index run keeps the
  conversion. `docs.remove` deletes every trace (folder, index rows in every space, graph edges, others' `amends`);
  citing tests are left and their sources become `source-missing`.
- **Amendments**: `doc.json.amends` lists what a document amends; the graph links it (document and section level), and
  an amendment wins over what it amends.
- **Media batches (as built, 2026-11-05 — the principle changes, see ROADMAP)**: a batch of photos is an *annex* of a
  document (`doc.json.media`, `media/<lot>/part.md` appended to `body.md` to make `doc.md`, anchors `lot-…`); photos
  normalised to jpg ≤ 2000 px with EXIF orientation and date (sharp); Claude reads 20 a run. A batch shows what the
  real system does, not what it must do: a source from an annex says *how* to do a step; an expected result backed only
  by an annex is `observed-only` (mechanical check) unless the batch is a reference.

## 6. Index and search (RAG)

**Principles** (kept from RAG v2):
- **P1 Completeness never depends on the embedding model.** Structural and lexical tools give the same evidence on
  every PC; embeddings and rerankers only rank. A CPU laptop gets the same evidence as a GPU machine.
- **P2 Extraction is done once.** Changing a model regenerates vectors, never `doc.md`, figures or anchors.
- **P3 An index holds several vector spaces.** Activating a model never destroys another.
- **P4 Models are data.** A catalog entry describes a model; nothing in the code or the UI names one.
- **P5 Everything runs on this PC.** Documents never leave the machine except inside Claude runs: no hosted embedding
  or vector service without a decision written here.
- **P6 The user decides where big files go.** No model is written before the user chose the folder.
- **P7 Measured before adopted.** A model or setting becomes a default only by winning the benchmark.

**Index** (`rag.db`, one SQLite file: `chunks`, `chunks_fts`, `edges`, `docs`, `meta`, and one `vec_<id>` per space):
- One chunk per lowest-level section (split above ~800 tokens, never across a heading), plus one chunk per figure
  (caption + description + `Visible text: …`, so a button label finds its screenshot). Chunk ids `docId#§x.y`,
  `docId#§x.y~n`, `docId#fig:N`. A context header per chunk: deterministic, or one sentence by Claude when
  `rag.claudeHeaders` is on (off by default: hundreds of runs on 900 pages; the indexer itself never calls Claude).
- **Hybrid search**: FTS5 BM25 + `sqlite-vec`, fused by reciprocal rank fusion; an optional reranker reorders the
  candidates. A reranker failure leaves the fused ranking, with a warning — never an error. When vectors are missing or
  the query cannot be embedded, search runs on BM25 alone: hits carry `degraded: true`, the reason is a warning, never
  an error, so Claude keeps working while vectors build. **The reranker is never in Claude's generation loop.**
- **French lexical search**: `chunks_fts` columns `header`, `text`, `codes` (exact forms) and `stem` (Snowball French,
  `rag/stem-fr.ts`, pure TS, checked word for word against the reference vocabulary; changing it bumps `STEM_VERSION`).
  A token with `_` or mixing digits and letters is a code (exact phrase). Stop words are articles and prepositions
  only; negation and restriction words stay searchable — they mark exceptions. **Glossary** (`rag/glossary.ts`):
  acronyms read from the documents' « Acronymes / Abréviations / Glossaire / Sigles » sections plus
  `project.json.glossary`; a query is expanded both ways.
- **Recall tools, no model**: `rag.mentions <term>` returns *every* passage holding the term (phrase, stems, glossary
  forms, or a regex), paginated by sections, never a top-k. `rag.related <ref>` returns the graph neighbours
  (cross-references both ways, parent/children, siblings, figures, amending documents first; depth 2 up to 200).
  `rag.search --expand section|graph` adds parents and referenced sections. They read the index, and derive the same
  from `doc.md` for a document not indexed yet.
- **Graph** (`edges(src, dst, kind)`): `refers` (« § x », « cf. x », « voir le chapitre x », `<code> §x`), `parent`,
  `sibling`, `shows` (section → figure), `amends`.
- **Passage cap**: `rag.passage` text is capped at `rag.passageMaxChars` (12 000); above it, whole lines around the
  quote (`around`), the table's header rows, an outline of sub-sections and a `readMore` line range of `doc.md`.
- **Claude also reads `doc.md` directly** (Grep/Read): the index finds, the file proves. The index is derived; nothing
  in it is the only copy of anything; sources point at `doc.md` anchors, never at chunks.
- **Retrieval settings** `project.json.rag.retrieval` (defaults `{ candidates: 50, rrfK: 60, bm25Weights: [1, 1, 5],
  rerank: { top: 30, mode: "topk" }, expand: "none" }`; precedence defaults < active pack < project.json < run
  override). A rerank `threshold` belongs to one model id and is set by the benchmark.

**Vector spaces and which models a PC uses**:
- A space id = first 12 hex of the SHA-256 of its fingerprint: runtime · model identity (SHA-256 of the weights, never
  a path) · catalog id · pooling · normalize · instructions · dimension · max tokens · text recipe version. A moved
  model keeps its space; the device is not part of it.
- `rag.index` updates chunks, FTS and edges once, then embeds only what the **active** space lacks; a changed chunk
  makes the other spaces incomplete, and re-activating one embeds only the missing chunks. The last index state is in
  `rag.db` (meta `index_state`) and drives `docs.list.indexed` (`missing` / `stale` / `fresh`).
- Activation (`rag/activation.ts`): this PC's choice (`settings.json.rag.byProject[<real path>]`) > the team reference
  (`project.json.rag.reference`, a pack or a pair) > the Light pack. Only installed models are taken; none → lexical
  index only, saying why.

**Models** (`models/catalog.json` + the user's entries in `models.json`):
- An entry names one exact quantization, its sources (Hugging Face repo at a pinned revision with every file's
  SHA-256), runtimes, dims, pooling, instructions, `dtypeByDevice`, `rerankerKind`, sizes, tier, `lighter`/`heavier`,
  `provenOn`. Licences that forbid commercial use are excluded.
- **Packs** = a named intent each PC resolves for its hardware: Light (bge-m3 q8, CPU), Performance (Qwen3-Embedding
  0.6B), Balanced (4B + Qwen3-Reranker 0.6B), Quality (8B Q4_K_M + Reranker 4B …), plus Custom (hand-picked). A pack
  resolves to its first variant obtainable and fitting here, and says why each skipped variant was skipped. A unit test
  proves every pack resolves with transformers.js and llama.cpp alone, and Light/Performance with transformers.js alone.
- **Runtimes** behind one seam (`probe`, `embed`, `rerank`): **transformers.js** in-process (CPU, DirectML; q8 models
  embed one text per call because their dynamic quantization makes a vector depend on its batch-mates; Qwen3-Reranker
  through the `yes-no-lm` export), and **llama.cpp** for GGUF (`llama-server.exe` per loaded model on 127.0.0.1 with a
  random `--api-key`, shared by callers, stopped after 10 idle minutes and on exit; the official ggml-org build is
  downloaded by `models pullRuntime`, SHA-256 pinned in the code, CUDA/Vulkan/CPU chosen from the PC).
- **Downloads** (`models pull`): only the dtype's files, through Node `fetch` (never `curl.exe`, never without
  certificate checks), `<name>.part` with Range resume, SHA-256 checked before the rename. Refused before the folder is
  chosen (`models-dir-unset`) and when the drive lacks 1.2 × what is left. `allowRemote` is the one switch.
- **Fit** (`lib/machine/`, `lib/fit/`): the PC profiled without admin rights (Node, `nvidia-smi`, WMI, registry,
  `llama-server --list-devices`, drives); a model needs what was measured here, else the catalog's figure, else 1.2 ×
  its download; embedding and reranker judged together → fits · tight · gpu-too-small · ram-too-small · unknown ·
  unsupported · untested (memory is not proof outside Windows x64 unless `provenOn` or a load succeeded here).
  `TESTIMUS_MACHINE` imposes a profile.
- **Timings journal** `%LOCALAPPDATA%\Testimus\perf\journal.jsonl`: one line per model operation (load, embed, rerank,
  search, claude.run) with ids, counts and times only — never document or query text. **Advice** compares the last 50
  operations with `rag.budgets` and proposes a lighter or heavier variant/pack, quoting the benchmark's quality
  difference when measured. Testimus never switches by itself.
- **Reference document** `templates/reference/syntec/` (Syntec agreement, 90 articles, the 100 questions of
  MTEB-French SyntecRetrieval, Apache-2.0): the same test on every PC, no project needed. `models measure <pack>` scores
  « right article first » and « in the top 5 » (recall@10 saturates). `scripts/refdoc.ts` writes the figures into the
  catalog.

**Benchmark** (`eval/behaviors.jsonl`: `{ id, question, queries[], evidence: [{ ref, role, must }], validated? }`,
roles definition · rule · condition · exception · amendment · contradiction · figure). `rag.eval` (L1) runs policies
`search` and `search+graph`, reports evidence recall @10/20/50, complete, precision, characters, recall by role, nDCG,
MRR into `.testimus/eval/`. `rag.compare` gives a paired bootstrap 95 % interval: a configuration is adopted only when
the interval is above zero and no role's recall goes down. `gen.bench` (L2, with Claude, costly). An unvalidated set
makes every report provisional. Skill: `.claude/skills/rag-eval/`.

Results so far (R10, RATP J5 corpus, 22 documents, 3 027 chunks, 40 behaviors **not validated by the testers —
provisional**): under `search+graph` every configuration finds 0.96–1.00 of the must evidence at k = 10 (BM25 alone
0.975) — **completeness comes from the graph tools, not the model**. Under `search`, no embedding passes the adoption
rule (bge-m3 q8 0.819 @10; 8B Q4 0.853); Q4 is never worse than Q8; the French stem column and a French instruction
change nothing measurable. Only 8B Q4 + Qwen3-Reranker in threshold mode passes, at k = 10/20 only, with thresholds
chosen on the same set. **The team reference stays the Light pack.**

## 7. The test file (`test.md`)

Xray Editor's format (frontmatter, `## Step N <!-- id -->`, `![](images/… "params")`, wiki tables, lossless
round-trip) with three changes:

1. **Each `### <Column>` is a column of `columns.json`**: Action, Data, Expected Result, every custom field, local
   columns. Written in `columns.json` order; an unknown heading is kept verbatim with a warning; `### Expected` /
   `### Result` are read as Expected Result.
2. **`### Sources`** (local, never pushed), one line per claim: `- <docId>#<anchor> "<short exact quote>"`, optionally
   ending `@<column> "<item>"` (backs one item of a column with Reference source on). **The quote must be findable
   verbatim in `doc.md`, inside the cited passage** — checked mechanically before any model looks at the test.
3. **Review state** in the frontmatter: `review: draft | checked | to-fix | validated`, `review_note`, `reviewed_by`,
   `reviewed_at`, `generated_by`. The review label (`<labelPrefix><review>`) is never in `labels:`: a push adds it, a
   pull reads it back and drops it.

Other frontmatter: `key`, `project`, `summary`, `folder`, `labels`, `status`, `assignee`, `assignee_id` (copies of
Jira's, written by the pull and `issue.*`, never pushed), `covers`, `cloned_from`, `preconditions`. `### Attachments`
under a step holds the pictures no field embeds. **The parser never throws** on a human or Claude edit: unknown
sections, lines, YAML lists and values are written back unchanged with a warning. Attachments and images are relative
paths inside the test folder. The review keys are read-only for the editor (`tests.save` keeps them from disk); only
`review.set`, the check, the fix and `tests.restore` change them. `check.json.testHash` is the sha256 of `test.md`
after the frontmatter, so a review decision never makes findings stale.

## 8. Generation

- Input: a request in words, documents or sections (`docId#§x.y`), or both; a target folder; the project's language
  (default `fr`). `gen.preview` says which tests `discard` would replace (Claude's tests awaiting review, never one
  pushed) and which documents of the scope are not indexed or stale.
- **Index gate**: `gen.tests` refuses before any Claude run when a document of the scope is not indexed (search could
  not find it, the tests would have no sources); a stale one only warns.
- `gen.tests` is a job running the `generate-tests` skill through `claude -p`. A request that takes more than one test
  is first planned (`plan-tests`, a `test-plan` block), then written **one run per test**, as many at a time as the
  agents setting and the PC allow (`lib/agents.ts`); one revert for all; a failed run stops the plan and
  `gen.tests --resume <generation>` writes what is left under the same generation.
- Skill rules: positive and negative paths, technique named; every smart column filled as its description says, only
  with what a source supports; **every expected result has a source, else the step is not written and the gap is
  reported**; « not simulated » only when a source says so; no reference inside Action/Expected (they live in
  `### Sources`); document figures embedded where the step needs them; an expected result is observable on screen.
- **The length of a test is a preference, never a limit**: aim for 3 to 15 steps, but the user's request decides — a
  longer test is written, never refused, split against the request or reported `skipped` for its length. No skill and
  no prompt may say a hard step limit (`generate-tests`, `plan-tests`, the generation prompt's `STEPS_LINE`, which
  holds over a skill the team edited); the mechanical check has no length rule and `check-test` never reports one.
  `tests/unit/core/gen/step-length.test.ts` fails on a hard-limit wording in any shipped skill, the code's prompts or
  the mock.
- The skill ends with a fenced `gen-report` block `{ tests, skipped: [{ item, why }], consulted }`
  (`claude/gen-reply.ts`). Every new test is stamped `review: draft` + `generated_by`, and checked at once. The run is
  snapshotted (revertable).
- **Evidence ledger** (`claude/ledger.ts`, `.testimus/gen/<generation>.json`): derived from the run's stream-json tool
  calls, never from the model's own report — what it opened (`rag_passage`, `rag_related`, `rag_figure`, `Read` ranges
  of `doc.md` mapped to sections, figure images) and what it searched. Review shows it (`review.evidence`); `gen.bench`
  scores agentic recall from it.

## 9. Check, review, fix

- **Mechanical pass** (`lib/check.ts`, no model): steps exist; Action and Expected filled (`empty-field`); no `raw`
  embed Xray cannot show; no duplicate step; an expected result has a source; every source resolves (document by id or
  code, anchor exists) and its quote is found **at its anchor** (`§x` = the section with its sub-sections, `fig:N` = the
  caption paragraph only, `page:` = up to the next page; whitespace-normalised, case-sensitive, `*` and comments
  ignored) → `quote-not-found`, `quote-not-at-anchor` (naming where it is), `quote-weak` (< 4 words or 20 chars, or
  found twice); Reference-source columns (`column-unsourced`, `item-not-found`); `figure-not-embedded`;
  `observed-only`.
- **Semantic pass** (`check-test` skill, one test per run, in parallel): `unsupported`, `contradicted`, smart column
  not as described, `wrong-object`, `negative-missing`, `case-missing`, `not-simulated-unsourced`, `vague-result`,
  `documents-conflict` (an amendment wins, a validated document wins over a draft), `figure-not-embedded`, `other`. It
  sends findings with `check_record` (replaces the semantic ones, stamps `testHash`). A `fig:` source's image must be
  `Read` before it is accepted. `check.run` decides the semantic pass itself (Claude there or not); the page never does.
- `check.json` `{ at, testHash, findings: [{ step?, kind, severity, message, sources, pass }] }`; stale when `testHash`
  moved. A document that changes re-runs the mechanical pass of the tests citing it.
- **Review**: **Validate** (`validated`) or **To fix** with a note (`to-fix`). `draft` → `checked` only after a
  successful semantic check. `review.fix { id, note }` = mark to-fix, run `fix-test`, re-check → `checked` (never
  straight to `validated`), with a run id for Revert. A push of a non-validated test asks for confirmation; on push the
  review state becomes a Jira label (`testimus-validated`…).

## 10. Jira and Xray

Everything Xray Editor does (pull with images, folders, preconditions, covers links, dirty detection against
`.remote.md`, push plan, 429 back-off, sequential execution stopping at the first failure), plus:

- **Jira writes are plans first.** Every mutating Xray command has `--dry-run`; `xray.plan` (= `push --dry-run`, one
  code path, readable by Claude) returns a `planHash`; `xray.push` requires it and refuses when it no longer matches, so
  the plan executed is the plan shown. One push per test at a time. A test changed in Jira is pushed only with
  `overwriteRemote`. A cancel is honoured between operations.
- **Step fields**: `xray.refreshFields` reads every step field into `xray.json` (GraphQL `getProjectSettings {
  testStepSettings { fields } }`; built-ins come back lowercase `action`/`data`/`result`; LFRPS12 adds `Exigence`,
  `text-single`); steps read and write `customFields [{ id, value }]` (verified read-only on LFRPS12, 2026-11-02). A
  list value is joined with `", "`; a non-text value is kept as its JSON spelling. Screenshots embed only in the three
  built-ins. Read again before every push and when a project opens.
- **Issue group** (`issue.*`: transitions, transition, people, assign, comments, comment, editComment, deleteComment):
  statut, assignee and comments go to Jira at once (each with `dryRun`), and stay **out of every Claude run's reach**:
  Claude drafts a comment (`claude.draftComment`, skill `draft-comment`), the person sends it. Mentions are
  `@[Name](accountId)` ↔ ADF `mention` (`lib/adf.ts`).
- Code: `lib/jira/` is the client (`http.ts` auth, six-request semaphore, cancellable 429 wait; `read.ts`, `steps.ts`,
  `labels.ts`, `push.ts`); `lib/sync/` puts it on the project folder (`connect.ts`, `pull.ts`, `push.ts`). Facts about
  the APIs: `.claude/skills/xray-cloud-api/`.
- **Never write to a production Jira project (LFRPS12, BHPTCC) during development.** Write paths are proven by unit
  tests over a fake `http` asserting exact payloads; live checks are read-only.

## 11. Claude runs

- Every run: `claude -p`, prompt on **stdin**, cwd = project folder, `--output-format stream-json --verbose`,
  `--model`, `--effort`, `--permission-mode acceptEdits`, `--add-dir` per attached context folder, `--mcp-config
  .mcp.json --strict-mcp-config`, `--allowedTools` covering `mcp__testimus__*` (a project `.mcp.json` alone is not
  trusted in `-p` mode), `--tools Read,Edit,Write,Glob,Grep,Skill` (chat: no Edit/Write). Spawned without a shell when
  it resolves to an `.exe`. Every run and `project.init` rewrite `.mcp.json` (installed: `cmd /c <abs>\testimus.cmd
  mcp`; development: `node <checkout>/src/faces/cli.ts mcp`), which sets `TESTIMUS_IN_CLAUDE=1`.
- **Tool access per run kind** (`claude/access.ts`, from the command list the registry hands over — the Claude layer
  never imports the registry): chat, figures, headers, triage → read-only commands only (`mutates: false`, no job, no
  `system`/`project`/`jobs`/`claude` but `claude.prompts`); check adds `check_record`; generation adds `tests_create/edit/save/addImage`,
  `check_run`; fix and `claude.run` add `tests_edit/save/addImage`; `action` gets the whole set minus another Claude
  run, Jira writes and the machine. Everything else goes to `--disallowedTools`, with `Edit`/`Write` refused on
  `docs/**`, `index/**`, `.testimus/**`, `contexts/**`, `.claude/**`, `project.json`, `xray.json`, `columns.json`,
  `.mcp.json`, `CLAUDE.md`.
- **Snapshots and Revert** (`claude/snapshot.ts`): a run that may edit records `.testimus/runs/<runId>/run.json` (who,
  model, effort, job) and copies of what it may change (tests, and for actions project.json, xray.json and the document
  folder). Revert works from the run id, also after a restart, refuses when a test changed after the run
  (`edited-after-run`, unless `force`), never deletes a test the run did not write. Cancel kills the whole tree.
- **Chat** (`chat.ask`): a session per conversation (`--resume <session_id>`, `.testimus/chats/`), skill `ask-docs`,
  sources in the same `docId#anchor "quote"` form. « The documents do not say » only after `rag_mentions` and
  `rag_related`.
- **Contexts**: a run on a test attaches its own list (`local.json`) else the project's `claude.contexts`; ids whose
  folder is gone drop out.
- **Claude actions** (`actions.*`, `.testimus/actions/`): proposals from the check, the generation and triage, shown
  beside the problem they fix; stale when the problem's place changes; one open action per problem; dismissed stays
  dismissed. Triage of a failed job is decided by the core (`actions.triageFailed`), once per job, only when Claude is
  there. Action runs are snapshotted.
- **What Claude is given is visible** (Settings › Context; `claude.prompts`, read only, readable by every run kind):
  the project's skills (`.claude/skills/*/SKILL.md`, the team's own too), every prompt Testimus builds, `CLAUDE.md`
  and the contexts attached by default, grouped by use, each with what sends it (screens and commands). **A built
  prompt is shown as its template, from the builder the run itself calls**: every module that runs `claude -p` exports
  `prompts` — its builder given the parts filled per run as `{placeholders}` (`{request}`, `{contexts}`…; the context
  lines, a document's team note and the smart columns are pure functions for that) — and `claude/catalog.ts` lists
  them, so the screen never shows a copy of the text. A module that runs Claude without its entry fails
  `tests/unit/core/claude/catalog.test.ts`; `prompts-sent.test.ts` keeps the exact text each run sends for one input
  (`prompts-sent/*.txt`, updated with `vitest -u` when a prompt changes on purpose). Decided: a skill takes the group
  and the « used by » of the built prompts that name it (« Use the X skill »); one no prompt names is a Team skill;
  each default context is its own entry (its `context.md`); the two sign-in probes (`claude.status`, the doctor) are
  listed too; `claude.run`'s run moved from its command to `claude/scoped.ts`.
- « Is Claude there » is `claude --version` (10 s cap, shared by callers); failure diagnosis (connect / login / credit /
  limit / network) is ported from Xray Editor.
- Claude acts on the app only through MCP tools and by editing files in the project folder; it never calls the HTTP
  API.

## 12. The page (UI)

- **One data layer** (`src/ui/lib/data/`, TanStack Query): a read is cached under `[project, command, input]` (machine
  reads under `null`) until an event says it changed; a plan or dry run is never cached; an action is a mutation that
  reads again what it touched. **Autosave** is a mutation: 400 ms after the last key or on blur, one save in flight per
  document, `ifMtime` → `conflict` shown, a draft kept while it fails; a command that reads an autosaved file sends the
  pending save first. Moving to another project drops the old project's reads. Nothing else fetches, opens a stream or
  touches browser storage; `lib/prefs.ts` holds the presentation preferences (typed keys). A preference that changes
  what the app does (model, effort, contexts) is a command, not a pref.
- **One kit** (`src/ui/components/ui/`): one component per control, and every drawn piece of the design (Field,
  SaveState, Answer, Ask, Passage, Raw, Facts, Timer, Pane, Tile, Card, Badge vocabularies…). `Text` is every field
  (boxed, inline, bare, table cell) with its save state, Claude's lock and its autosave; `ClaudeBlock` (every place
  Claude is asked) is built on `Text`. Nothing of the browser's own UI shows (a select's list is the kit's `Menu`, a
  search field's cross is the kit's). Extend a component by an option, then a wrapper, then — only if it resembles
  nothing — a new component; never copy its JSX. `#/kit` (under `--mock`) is the catalogue: every component in each
  state, light and dark.
- **Styles**: StyleX in the component's own file, values only from `tokens.stylex.ts`, text only through the kit's
  `type.ts` (a screen never sets a font size, weight, line height, spacing or face). Themes are classes on `<html>`
  from `data-theme` (applied before first paint by `/theme.js`).
- **Look**: the design system in `design/` (owned by the design sessions; not tracked in this repo): near-white canvas,
  white panes, one ink-blue accent (#3e63dd) for the primary action, selection and focus; **Claude in violet and
  nothing else in violet**; Inter for the interface, Source Serif 4 for text quoted from a specification, JetBrains Mono
  for keys and anchors; a state is always icon + word; every pair at WCAG AA. UI text in English.
- **Layout**: left rail (Documents · Generate · Tests · Review · Jobs, then Settings and the system check), main pane,
  Claude dock on the right everywhere (folded in Review; floats over the screen below 1300 px). Minimum width 520 px.
  The project at the top of the rail opens a menu of the known projects (a quick switch) and one action, « All
  projects… », to First launch › Project — the one place that opens a folder, opens by Jira key, creates, hides,
  deletes or shows a project in Explorer; reached with a project open, opening one there goes back to the app.
- **Names, never internal ids**: a label is what speaks to the user — a test's summary (its Jira key beside it in mono
  when it has one; a local test carries a « Local » badge), a document's title (and its code), the project's name, a
  context's or column's name; a missing one is « Untitled test / document / context », never the id
  (`src/ui/lib/labels.ts`: `testLabel`, `docLabel`, `contextLabel`, `nameTests` for a text that still names tests by
  id, such as Claude's own words, `useTestNames`). An id (job, `local-…`) stays visible only in a job's folded
  « Technical details », beside its name. `tests/e2e/ids.spec.ts` fails on a `local-<hex>` in any visible text.
- **Safety rules of the page**: a Jira write always shows its plan first; from the palette (Ctrl K, every command by
  name, a form from its schema) nothing runs blind — a command with `dryRun` shows its plan, one that loses something
  without a dry run asks first naming what goes; any Claude run on a test or the project **locks the editor**, the lock
  read from the project's running Claude jobs (so a reload keeps it); a started job says so with « Open in Jobs »,
  never by switching screen.
- **Long lists stay light**: the kit's `List` draws only rows within 1 500 px of the visible frame from 150 rows on
  (`rowWindow.ts`), keyboard reaching every row. The shell redraws a screen only for what the screen reads (`memo`
  boundaries; a quiet running-jobs list).

## 13. Security of the HTTP face

Binding 127.0.0.1 does not stop another web page from sending requests, so `/api` and `/files` require: a
`SameSite=Strict` session cookie set when the UI is served, a local `Host` (no DNS rebinding), a local `Origin` when
present, and `POST` with `application/json` (else 415); `/api` and `/api/events` answer `GET` only. Only `GET
/api/system/version` is public. The guard runs before anything else. The project a request names (`?project=` or
`X-Testimus-Project`) must match a known project, else 403. UNC and device paths are refused wherever the HTTP face
reads a path itself (opening one would send the user's NTLM hash). `/files` serves only inside a known project, with a
sandboxing CSP. The page's CSP: `default-src 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src
'self' 'unsafe-inline'; connect-src 'self'` — no inline script, no `eval`. `system.setCredentials` accepts only
`https://<tenant>.atlassian.net` and `*.getxray.app` unless `otherHost`. Scripts call the API by loading `/` first for
the cookie (`tests/e2e/helpers.ts`).

## 14. Desktop shell

The shell is a **window around the HTTP face, not a fourth face**: `src/desktop/` never imports `src/core/` (it may
import `src/shared/`); anything that reads or changes a project goes through `/api`. The browser mode stays
first-class: every screen works without the bridge.

- `Testimus.exe` starts the core as `serve --port <last|0> [--port-fallback] --no-open --ready-json
  --exit-with-stdin` (the last port keeps the page's origin and localStorage), with `TESTIMUS_SHELL=desktop/<version>`;
  splash, then the core URL on the ready line; no ready line in 30 s or the core exits → an error page with the last 40
  lines, Restart, Open the log folder. Logs `%LOCALAPPDATA%\Testimus\logs\desktop-<date>.log` (14 days).
- Single instance (a second launch hands its folder to the UI). Quit with running jobs asks « Cancel and quit / Keep
  working », cancels them, closes the core's stdin, waits 10 s, kills the tree.
- Locked down: `contextIsolation`, no Node, `sandbox`, `webSecurity`, no `webview`; navigation off the core origin
  cancelled; `https:` links go to the default browser; every permission refused but sanitized clipboard writes;
  downloads refused.
- **Bridge** `window.testimusDesktop` (`src/desktop/bridge-types.ts`, read by `src/ui/lib/desktop.ts`) carries
  **presentation only**: `pickFolder`, `pickFiles`, `pathOf`, `reveal` (inside a known project or the data folders),
  `openExternal` (`https:`), `setProgress`, `notify`, `onOpenProject`, `setAlwaysOnTop`, `relaunch`. A picked path is
  then given to a command. A capability only the bridge can reach is a bug.

## 15. Release, install and updates

- **What a colleague's PC needs**: Testimus with its own Node, the Claude Code CLI signed in to their subscription, the
  Jira/Xray credential files, the model files. **No admin rights, no compiler, no Python, no global npm.** A native
  dependency without a win-x64 prebuild is refused.
- `npm run release` → `dist/testimus-<version>-win-x64/`: `Testimus.exe` (Electron renamed with `rcedit`, icon,
  version info), `resources/app.asar`, `node/node.exe`, `app/` (`testimus.mjs`, one Rolldown bundle with the catalog
  inlined, `ui/`, `templates/`, `node_modules/` holding only the externals: sqlite-vec, onnxruntime, transformers.js,
  sharp, pdfjs-dist), `models/` (Light pack, so the first index needs no download), `testimus.cmd`, `install.ps1`,
  `release.json`. Electron's zip is downloaded once into `.build/cache/` and checked against its SHA-256 files; the
  build fails if the installed `electron` differs from the pin. Fuses: `RunAsNode`, `NODE_OPTIONS` and inspect flags
  off; cookie encryption, asar-only and embedded asar integrity on. **Not signed** (E0 open): SmartScreen may warn,
  AppLocker/WDAC may block; the browser mode is the fallback.
- `install.ps1`: per user, no admin, safe to rerun (newer = update, older = rollback): copies to
  `%LOCALAPPDATA%\Testimus\<version>\`, `Unblock-File` (Mark of the Web from Teams), `bin\testimus.cmd` on the user
  PATH following `current.txt`, Start-menu shortcuts (desktop and browser), Claude CLI on request, credentials,
  doctor. Settings, credentials, models and projects live outside the versioned folder.
- **Updates** from the team folder: `npm run publish <x.x.x>` (refuses a version the folder already holds, sets
  `package.json`, builds, copies as a hidden `.partial` renamed whole); installed copies read the folder from Settings ›
  Updates (`system.updates` / `system.update`, two versions kept); `--channel` moves the folder.
- **Proxy**: downloads and Jira calls honour `HTTPS_PROXY` (`NODE_USE_ENV_PROXY=1`, set by the shim and the shell).
  Node 26 has no loopback exemption, so both append `localhost,127.0.0.1,::1` to `NO_PROXY` (else passages and the
  llama-server key would go to the proxy); the doctor fails its `proxy` row when that is missing.
- **`system.doctor`**: one row per check with a `fix` and, when one command repairs it, an `action`: native modules,
  Claude found / version / signed in, Jira and Xray (read-only), face, models folder and space, active models installed
  and fitting, vector space complete, llama.cpp build, proxy.
- **Electron is supported for its last three majors**: a release at least every 6 months to stay on a patched
  Chromium.

## 16. Open decisions and things not proven yet

- UI language: English (today) or French (the testers)? Generated tests follow `project.json.language` either way.
- A sandbox Jira project for live write tests, or unit-tested writes only? Review state in Jira: label (today) or a
  custom field?
- Where the team's project folder lives (SharePoint sync, SVN, a share) — decides locking needs. Whether colleagues'
  PCs reach Hugging Face and claude.ai through the company proxy (unchecked).
- Requirement coverage is computed **outside** the app, from the step column the team fills with requirement ids.
- Not proven yet: signing and execution policy on a tester's PC (E0); live read-only checks of `xray.pull` and of the
  `issue` reads on the Windows PC; whether a custom field is cleared with `""` or `null`; the benchmark's gold set
  (bootstrap by Claude, to be validated by the testers — every figure above is provisional); measuring Performance,
  Balanced and Quality on the reference document (`node scripts/refdoc.ts`); the `observed` colour token for annexes.
