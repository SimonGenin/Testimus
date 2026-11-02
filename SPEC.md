# Testimus — behavioral contract

Testimus turns a pile of specification documents into **Xray manual tests a tester can trust**:
documents in, a searchable index out of them, tests generated with the source of every claim,
checked for anomalies, reviewed by a human (**Validate / To fix**), then edited and synced with Jira
Xray Cloud. **Claude Code is the worker at every stage**, and every stage is a command that a human
(UI), a script (CLI) and Claude (MCP) call the same way.

First customer: the RATP Sosie testing team (Jira `LFRPS12`, specs `SOSIE_*_D401-1_*`, about ten
documents and 900 pages). The app is generic: any Jira project, any document set.

Status: **v1 built (ROADMAP phases 1–4).** This file is the contract the code is written against;
update it when a decision changes, in the same change as the code.

## 0. What it replaces

| Today | Pain | Testimus |
|---|---|---|
| Specs pasted into NotebookLM or SurfSense, one prompt → a CSV of tests | NotebookLM cannot run Claude; SurfSense runs Claude but loses the images and takes no skills or context; citations come out as dead numbers (`1`, `2, 3`) | Own index, queried by the team's own Claude Code with its skills, effort and contexts; figures and sources kept end to end |
| A skill + Python script imports the CSV into Xray | Review happens in Jira, after import | Import is local first, reviewed, then pushed (or direct, optional) |
| Testers reread, fix, add screenshots in Jira | Slow, no trace of what was checked against what | Check skills flag anomalies per test; the review view shows test, anomalies and source passage side by side |
| Xray Editor (BHP) for local editing | Three fixed step fields | Every Xray step field, custom ones included, with per-project folding |

## 1. Stack (decided — reopen only with a reason written here)

- **One TypeScript code base on Node 26 LTS** (LTS since 2026-10-28, supported to 2029-04; the
  release ships its own copy, §14, so colleagues' PCs need no Node). The **core** runs in Node; the
  UI is React 19 + Vite 8, no UI library, no CSS framework, no state library (Xray Editor's rules).
- **Node runs the TypeScript itself** (type stripping): `node src/faces/cli.ts`, no `tsx`, no build
  step in development. The code is therefore erasable-only (`erasableSyntaxOnly`: no `enum`, no
  `namespace`, no constructor parameter properties) and imports name `.ts` files. Xray Editor's code
  already complies.
- **Three faces over one core**, never a fourth path into the domain:
  - CLI `testimus <group> <verb> …` (`--json` on every command),
  - MCP server `testimus mcp` (stdio), one tool per command,
  - HTTP API `testimus serve` (`POST /api/<group>/<verb>`, JSON in/out, SSE for streams) that also
    serves the built UI. The UI talks to nothing else.
- **Why not Tauri as in Xray Editor:** the index needs native Node modules (SQLite, ONNX runtime) that
  a webview cannot load. The UI is a local web page. The **desktop app** is an Electron shell
  (`electron` pinned as a devDependency, 45.2.1) around `testimus serve`: Electron is only the window;
  the shipped Node 26 runs the core, CLI and MCP as before (§13 « Desktop shell »). The shell never
  imports `src/core/`; Rolldown bundles it from `src/desktop/`.
- Libraries (state of late 2026; a replacement is noted here with its reason):
  - `zod` 4: one schema per command → CLI parsing and help, MCP tool schema (`z.toJSONSchema`),
    HTTP validation.
  - `@modelcontextprotocol/server` (MCP TypeScript SDK v2), stdio transport.
  - **`node:sqlite`** (built into Node) + `sqlite-vec` loaded as an extension
    (`allowExtension: true`) for the index. It replaces `better-sqlite3`: one native module fewer to
    ship and keep in step with Node. FTS5 is compiled in (checked on Node 24.14, SQLite 3.51).
    `node:sqlite` is a release candidate (stability 1.2) in Node 26: the index code stays in
    `src/core/rag/` so a fallback to `better-sqlite3` touches one folder. `sqlite-vec` is used in
    flat (exact) mode; its ANN indexes are still alpha and useless at this scale (§5).
  - `@huggingface/transformers` 4 (local ONNX embeddings, §5).
  - `mammoth` (docx → HTML + images), `pdfjs-dist` (PDF fallback). The stronger converters
    (Docling, MarkItDown) are Python, which §14 rules out on colleagues' PCs.
  - HTTP and argv parsing are `node:http` and `node:util.parseArgs`; no framework.
- Tooling:
  - **TypeScript 7** (native compiler, `tsc` ≈ 10× faster) for type checking only; it emits nothing.
  - **Vite 8** (Rolldown) builds the UI; for the release, Rolldown also bundles the core into one
    file, with the native parts (`sqlite-vec`, ONNX runtime) kept outside (§14).
  - `vitest` 5 (current major at build time), `@playwright/test`.
- Fonts (Lexend, Source Sans 3, JetBrains Mono) come from `@fontsource-variable/*` and are bundled into
  the UI: the app works offline and behind a proxy that blocks Google Fonts.
  - **Biome** 2: lint and format in one tool, one config, run by `npm run check`. (Oxfmt is faster
    but still beta.)
- Considered and left out, so nobody adds them by reflex: React Compiler (the UI is small and ported
  code already memoizes where it matters), a UI kit or Tailwind (Xray Editor's styles are ported),
  an HTTP framework, an ORM, a hosted vector database, `tsx`/`ts-node`, Node single-executable
  packaging (it cannot carry the native modules cleanly; the portable folder can).
- Claude = the **Claude Code CLI** (`claude -p`) on the user's subscription. Not the Agent SDK: it
  needs an API key (§11).
- Code reused from Xray Editor (`D:\Projects\XrayEditor`) is **copied and adapted**, not shared as a
  package; Xray Editor stays as it is for BHP.

## 2. Architecture

```
            ┌──────────────── core (Node) ─────────────────┐
  UI  ─HTTP─►  commands registry  ──►  domain modules      │
  CLI ──────►  (zod schema, run)       docs · rag · tests  │──► project folder (files)
  MCP ──────►                          gen · check · review│──► index/rag.db (SQLite)
            │                          xray · claude       │──► Jira REST + Xray GraphQL
            └──────────────────────────────┬───────────────┘
                                           └──► claude -p (cwd = project folder)
                                                 └──► calls back through `testimus mcp`
```

- **A command** = `{ name: "<group>.<verb>", input: zod, output: zod, mutates: bool, run(ctx, input) }`
  in `src/core/commands/<group>.ts`. The registry derives the CLI verb, the MCP tool
  (`<group>_<verb>`) and the HTTP route from it. A feature that exists only in the UI is a bug.
- `ctx` carries the project folder, settings, an `AbortSignal`, a progress callback (CLI prints it,
  HTTP streams it, MCP sends notifications) and the activity tracker.
- **Long work is a job**: `generate`, `check` over a batch, `rag.index`, `xray.pull` of a folder.
  A job has an id, progress, a cancel, and a log under `<project>/.testimus/jobs/<id>.jsonl`.
- **Stopping is clean.** On stdin closing (`--exit-with-stdin`), SIGINT, SIGTERM, SIGBREAK or SIGHUP
  (console closed), `serve` answers 503 to any new request, cancels every running job (each ends
  `cancelled` in its `.testimus/jobs/<id>.jsonl`; a job still busy after 5 s is logged `cancelled`
  anyway), kills the process tree of every `claude -p` it started (`taskkill /T /F /PID` on Windows),
  stops the local model servers it started (llama.cpp), then exits 0; a stuck step is cut at 6 s
  (exit 1), a second signal exits at once. Runs already recorded stay revertable (§11). A request that fails never stops the core: the HTTP handler
  answers 400/500, and `serve` logs an unhandled rejection to stderr instead of exiting.
- **Writes to Jira are planned, then executed**: every mutating Xray command has a `--dry-run` that
  returns the plan (Xray Editor's `planPush`); the UI shows the plan before the button.
- **The HTTP face answers only its own page** (binding 127.0.0.1 does not stop another web page from
  sending requests): `/api` and `/files` require a `SameSite=Strict` session cookie the server sets when
  it serves the UI, a local `Host` (no DNS rebinding), a local `Origin` when there is one, and a `POST`
  whose body, when it has one (`Content-Length` > 0 or `Transfer-Encoding`), is `application/json` (else
  415); only `GET /api/system/version` is public (start-up probes), and it ignores any project the request
  names. The guard runs before anything else: a request it refuses touches no file. The project a request
  names (`?project=`, or the `X-Testimus-Project` header, URI-encoded — a malformed one is a 400) is then
  matched as a string (resolved, case-insensitive on Windows) against the known projects (the open one or
  `settings.projects`) before anything touches the disk, and only the matching known entry is opened; an
  unknown one is a 403. A UNC or device path (`\\host\…`, `//host/…`, `\\?\…`, `\\.\…`) is refused wherever
  the HTTP face reads a path itself (the project selector, `/files/<path>`): opening one would make Windows
  sign in to that host with the user's NTLM hash. Paths inside a command's JSON input are the command's
  business (e.g. `models add` from the team share). `/files` serves only inside a known project, with a
  sandboxing Content-Security-Policy. The UI page itself (`index.html`) is served with
  `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self'
  'unsafe-inline'; connect-src 'self'` in both the browser and the desktop app: no inline script (the theme is
  applied before the first paint by `/theme.js`), no `eval`, images from the project or `https:` (step images that
  live in Jira), nothing fetched from another origin. Claude is
  spawned without a shell when it resolves to an `.exe`; through a `.cmd` shim no argument may carry a cmd
  metacharacter. `system.saveSettings` accepts only an existing absolute `claude.exe`/`.cmd`;
  `system.setup` accepts only `https://<tenant>.atlassian.net` and `*.getxray.app` unless `otherHost`.
- `serve` flags for a parent process (the desktop shell, §13), none of them a command: `--port 0` lets
  the OS pick a free port, and the guard checks the port actually bound; `--ready-json` prints, once
  listening, one line `{"ready":true,"url":"http://127.0.0.1:<port>/","pid":…,"version":…}` and nothing
  else ever goes to stdout (errors before it go to stderr with a non-zero exit); `--exit-with-stdin`
  stops the core when its stdin closes. `TESTIMUS_SHELL=<face>/<version>` (set by the shell) names the
  face in `system.version` (`shell`) and in the doctor (« desktop 0.2.0 », else « browser »).
- The core is the only writer of the project folder's managed files (`.remote.md`, `index/`,
  `.testimus/`). Claude edits `test.md` files directly (§11) and the core re-reads them.

## 3. The project folder

A project is **a folder that is also a Claude Code project**: open it in a terminal, run `claude`,
and the same skills, contexts and MCP tools are there. `testimus project init <dir>` copies
`templates/project/` into it. The folder can live anywhere (local disk, SharePoint sync, SVN) and is
shared by sharing the folder.

```
<project>/
  CLAUDE.md                 project rules for Claude (from the template, then the team's)
  .mcp.json                 declares `testimus mcp` — Claude reaches every command
  .claude/skills/           generate-tests, check-test, fix-test, ask-docs (+ the team's own)
  .claude/agents/           optional
  project.json              { jiraProject, language, folders, rag: { embedding, reranker },
                              claude: { model, effort, presets, contexts } }
  xray.json                 step field schema fetched from Xray + local field preferences (§10)
  contexts/<id>/            notes.md, files/ — reference material attached to runs (Xray Editor §7)
  docs/<docId>/             one document (§4)
  requirements/             optional: requirements.csv (id, text, doc, chapter, status)
  tests/<id>/               test.md, .remote.md, images/, check.json (§6)
  index/rag.db              derived, rebuilt by `rag.index`, never edited, not shared
  .testimus/                jobs, chat sessions, caches — derived, not shared
```

Global settings (`%APPDATA%\Testimus\settings.json`): known project folders, last project, UI prefs,
`claude.exe`.

**Credentials** are Xray Editor's, in the same files (its SPEC §2, `src/lib/jira.ts`), shared with the
user's Atlassian skills (`xray-find`, `atlassian-import`, `comment-task`…): one set per user, read in
place, never copied into a project or into Testimus' settings.

- `%USERPROFILE%\.atlassian\credentials.json` — `{ "baseUrl": "https://<tenant>.atlassian.net/wiki",
  "email", "token" }`. Jira base = `baseUrl` without its `/wiki` suffix; auth = HTTP Basic
  `email:token`.
- `%USERPROFILE%\.atlassian\xray_credentials.json` — `{ "clientId", "clientSecret", "apiBase"? }`
  (`apiBase` defaults to `https://xray.cloud.getxray.app`). Auth = `POST {apiBase}/api/v2/authenticate`
  → a JWT, kept in memory, renewed on 401.
- Read tolerantly: a UTF-8 BOM is stripped, unknown keys are ignored.
- Written only by `system.setup`, by **merging** into what is there: unknown keys (`accountId`,
  `apiBase`) and the `/wiki` suffix survive, because other tools need them (Xray Editor's
  `saveCreds`).
- An error names the file to fix (`Jira 401 — check ~/.atlassian/credentials.json`); a secret is
  never logged, never put in a job log, a prompt or a `claude -p` argument.

## 4. Documents

```
docs/<docId>/
  source.docx | source.pdf  the original, copied in (never the SharePoint file itself)
  doc.md                    converted text with anchors
  figures/fig-<n>.<ext>     every picture, in reading order
  figures.json              [{ file, anchor, caption, description }] — description written by Claude
  doc.json                  metadata below
  context.md                what the team says about this document (free text, read by every run)
```

- `doc.json`: `{ id, code, title, version, date, kind: "spec"|"requirements"|"minutes"|"other",
  status: "draft"|"submitted"|"validated"|"superseded", binding: "mandatory"|"applicable"|"informative",
  supersededBy?, amends?: [docId], source: { path, sha256 }, convertedWith, convertedAt }`.
  `binding` and `status` are what the team decides, not what the file says: the UI edits them,
  generation and checks read them (a superseded document is never cited; an applicable one is cited
  with its binding shown).
- **Conversion prefers `.docx`** (structure and images intact); PDF is the fallback.
- **Anchors** are what sources point at, so they must be stable across reconversion:
  - every heading carries its section number as anchor: `## 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->`;
  - every requirement id found in the text is an anchor: `<!-- req EXI_MOP_SPF_511_A_1670 -->`;
  - figures: `![Figure 40 – Représentation graphique sectionneur](figures/fig-40.png) <!-- fig 40 -->`;
  - a PDF page break: `<!-- page 59 -->` (absent for docx, which has no reliable pages).
- Known losses, reported in `doc.json.warnings` instead of hidden: Word comments, shapes drawn in
  Word (only their labels survive), `.emf`/`.wmf` (kept as they are: converting them needs native
  tools that §14 rules out).
- Fixed while building (2026-11, proven on SOSIE_211_D401-1_3 01.01: 116 sections, 324 requirement
  ids, 21 figures, identical anchors on reconversion):
  - Requirement ids: the constant `REQ_PATTERN = \bEXI_[A-Z0-9_]*[A-Z0-9]`, plus a project's own regexes
    in `project.json.requirementPatterns`. One `<!-- req ID -->` per id, on the line before the block
    that defines it (else before its first mention; before a table for ids inside it). A Word heading
    that is only an id (RATP style) is not a section.
  - Requirement statement (derived from doc.md by `rag/statements.ts`, nothing extra written): the block after
    `<!-- req ID -->`; when that block is the id alone (RATP `**EXI_…**`), the following blocks up to the next
    requirement marker, heading or figure (a paragraph ending with a pasted caption is kept, then it stops);
    when nothing follows, the id's matrix row. Defined only in a matrix: the row, rendered
    `ID — <Objet> (section <x.y>)`. A non-matrix table gives the row holding the id. Never the id alone.
  - Requirement matrix: a table whose id column holds only ids (REQ_PATTERN + requirementPatterns) on at least
    half its rows, and that has a section column — header `Section`, `Chapitre`, `§` or `Paragraphe` (case,
    accents and plurals ignored), else a column of section numbers on half the rows.
    `project.json.requirementMatrix: { idColumn, sectionColumn, textColumn? }` names them by header. The text
    column is `Objet`/`Libellé`/`Texte`/`Description`, else the longest. A part without a header row is read
    with its first row. Checked on the 22 current J5 documents (2026-11-02): found in every RATP SPF matrix
    `Code Exigence(s) | Objet | Section` (10 documents); PCC NG's `ID Exigence | Source` tables are not matrices;
    the Instructeur, Modèle train and SOSIE_c matrices use `EXI STB F-n` ids, found only with that pattern in
    requirementPatterns — and an id with a space cannot be an anchor yet (open, §16).
  - Amendments: a PA document lists what it amends in `doc.json.amends` (set by the team with `docs.set`).
  - Markdown depth = number depth + 1 (`# <code> — <title>`, `## 1`, `#### 5.6.6`); anchors never depend
    on depth. A number written in the heading wins, else Word numbering is recomputed from levels; an
    unnumbered heading gets the slug of its title (`§annexe`), duplicates `-2`.
  - Figure keys: the caption number (`fig 40`), `-2` when a number repeats, `f<order>` without caption.
    A caption with no picture (RATP pasted Figures 22–42 of D401-1_3 as flat text) gets its anchor on
    the caption paragraph and a warning. `docs.add --pdf <file>` keeps the PDF rendering to recover
    pictures the .docx lacks.
  - Text normalisation: non-breaking spaces → space, U+2011 → `-`, soft hyphens removed; bold and
    italic kept as `**` / `*` (the quote check ignores `*`).
  - PDF fallback: headings from numbering or font size, repeated header/footer lines and tiny pictures
    dropped. RATP PDFs draw heading numbers as pictures, so always prefer the .docx.

## 5. Index (RAG)

RAG v2 (built from SPEC-RAG.md, 2026-11). Principles kept from it: completeness never depends on the embedding
model (structural and lexical tools give the same evidence on every PC; embeddings and rerankers only rank);
extraction is done once; an index holds several vector spaces; models are data; everything runs on this PC; the
user decides where big files go; a model or setting becomes a default only by winning the benchmark; Ollama is a
convenience, never a requirement.

- **Chunking follows the document**: one chunk per lowest-level section, split further only above
  ~800 tokens, never across a heading. Each chunk keeps `{ docId, anchor, path: "5 > 5.6 > 5.6.6",
  reqIds[], figureIds[], text }` and a context header (deterministic, or one sentence written by Claude
  when `rag.claudeHeaders` is on — Anthropic's contextual retrieval).
- **Figures are chunks too**: caption + Claude's description, pointing at the image file, so a
  search can return a picture and a generated step can embed it. A caption pasted without its picture is
  still a figure (no file; its caption is the « Figure N – … » text of its paragraph).
- **Requirement matrices are indexed row by row** (§4): one `matrix-row` chunk per row, placed under the
  section the row traces to.
- **Hybrid search**: SQLite FTS5 (BM25 — exact codes, requirement ids, device names, French stems) +
  `sqlite-vec` (semantic recall), merged by reciprocal rank fusion; an optional reranker reorders the
  fused candidates. At this scale (≈ 2,000 chunks for the RATP corpus) `sqlite-vec`'s exhaustive search
  answers in milliseconds; one file holds text, FTS5, graph and vectors, no server.
- **Lexical search in French**. `chunks_fts` has four columns: `header`, `text`, `codes` (requirement
  ids, `fig N`, the section number) tokenized by unicode61 without diacritics — the exact forms — and `stem`, the
  header and text through the Snowball French stemmer (`rag/stem-fr.ts`, a pure TypeScript port of `french.sbl`,
  BSD, checked word for word against the Snowball reference vocabulary, 21,653 words; elisions are expanded first,
  so « n'est » is stored as `ne est`). Changing the stemmer bumps `STEM_VERSION`, which rebuilds the FTS table when
  an index is opened.
  - A query searches each word typed in the exact columns and its stem in `stem`. A token holding `_` or mixing
    digits and letters is a code: one exact phrase, never stemmed. Stop words are articles and prepositions only;
    negation and restriction words (`ne`, `pas`, `sauf`, `excepté`, `uniquement`, `seulement`, `interdit`,
    `jamais`, `sans`) and `sous`, `hors`, `avant`, `après` stay searchable: they mark exceptions.
  - **Glossary** (`rag/glossary.ts`): the acronyms of every `doc.md` section titled « Acronymes », « Abréviations »,
    « Glossaire » or « Sigles » (and its subsections) — table rows or lines `ACR : meaning`, `ACR – meaning`,
    `ACR = meaning` — plus `project.json.glossary` (`{ "DSO": "Départ Sur Ordre" }`). « ; » separates meanings,
    « / » acronyms, parentheses are dropped. Read lazily, cached per `doc.md` by content. A query is expanded both
    ways: an acronym adds its long forms as phrases, a long form (any inflection) adds the acronym. Acronyms under
    three letters match with their exact case; one-letter acronyms are never added. D401-1_3 §1.4 gives 64.
- **Recall tools, no model** (SPEC-RAG P1): they read the index's chunks and edges for every document indexed as
  it is now, and derive the same chunks and edges from `doc.md` for a document that is not (or when there is no
  index), so they answer the same on every PC, with or without vectors, and see a `doc.md` changed since the last
  index.
  - `rag.mentions <term>` returns **every** passage of every current document (superseded ones with
    `includeSuperseded`, `docIds` to narrow) that contains the term: the exact phrase (case and accents ignored,
    whole words only, so an id never matches a longer id; an acronym of one or two letters keeps its case), its
    French stems (not for a code or an all-capital acronym; stop words skipped), and its glossary expansions both
    ways — or a JavaScript regex (`regex`, case-insensitive). A section's title, its text, a figure's caption and
    description and a matrix row are searched. Hits are grouped by document (most hits first) and section
    (document order; a matrix row is `docId#req:ID@matrix`), with `count` and one line of context per hit (at most
    10 per section). Paginated by sections (`page`, `pageSize` ≤ 200), never a top-k; `forms` lists what was
    searched. Measured on the 22 J5 documents: « sectionneur » 81 hits in 31 sections of 6 documents, « DSO » (+
    « Départ Sur Ordre ») 277 hits in 94 sections of 9 documents, 0.7 s from the CLI.
  - `rag.related <ref> [--depth 2]` returns the graph neighbours of `docId#anchor` (`§x.y`, `req:ID`,
    `req:ID@matrix`, `fig:N`) or of a bare requirement id (every document that carries it), each with its kind,
    direction (`out` = ref → neighbour), title (section title, caption, or the requirement's statement), path and
    depth: defining and traced sections, sections that mention it, requirements a section defines and mentions,
    cross-references both ways, parent and children, siblings, figures, and the amending documents — the document
    itself and the amending sections that name this section or one of its ancestors. A requirement also gets its
    `statement`. `warnings` names a traced section that is neither the defining section nor one of its ancestors,
    or that the document lacks. Depth 2 adds the neighbours of the neighbours once (siblings are not expanded).
    Superseded documents are left out; an unknown document, anchor or id is an error.
  - `rag.search` `expand` (default `project.json.rag.retrieval.expand`, else `none`): `section` adds, after the k
    hits, the parent section of a section hit, the section a figure or a matrix row sits under, and the sections
    the requirements of a hit trace to; `graph` also adds each requirement the hit carries or names as its statement.
    Each added passage appears once, flagged `via`, with the score of the hit that brought it.
- **Retrieval settings** (`project.json.rag.retrieval`, all optional; defaults `{ candidates: 50, rrfK: 60,
  bm25Weights: [1, 1, 5], rerank: { top: 30, mode: "topk" }, expand: "none" }`; precedence: defaults < the active
  pack's `retrieval` < project.json < a run override). `bm25Weights` = `[header, text, codes]`; `stem` takes the
  text weight unless a fourth value is given. Reranking `topk` reranks the top max(k, top) fused candidates and
  returns k; `threshold` reranks every fused candidate and returns all those scoring at least
  `rerank.thresholds[<reranker id>]`, else `rerank.threshold` (none: plain top-k) — a threshold belongs to one
  model and is set by the benchmark. The reranker is never in Claude's generation loop by default.
- **Vector spaces.** `index/rag.db` holds the model-independent tables (`chunks`, `chunks_fts`, `edges`, `docs`,
  `meta`) and one sqlite-vec table per *vector space* (`spaces`, `vec_<id>`). A space's id is the first 12 hex
  characters of the SHA-256 of its fingerprint: runtime · model identity · catalog id · pooling · normalize · query
  and document instructions (with `{task}` filled from `project.json.rag.queryTask`, default an English sentence) ·
  dimension · max input tokens · text recipe version. The model identity is the SHA-256 of its weights — the GGUF file, the Ollama weight layer (`application/vnd.ollama.image.model`,
  read from the `FROM …sha256-<hex>` line of `/api/show`'s modelfile, else from Ollama's manifest on disk; never the
  manifest digest, so a re-pull that changes only parameters keeps the space), or the ONNX weight file(s) of the entry's
  dtype — never a path, so a moved model keeps its space; the device is not part of it.
  - `rag.index` updates chunks, FTS and edges once, then embeds only what the **active** space lacks. A chunk
    added, changed or removed leaves every other space `complete: false`; activating that model again embeds only
    the missing chunks. A v1 index's `vecs` table is migrated as an `unpinned` space; when the active model is that
    v1 profile's catalog entry with the same dimension, search uses it and the next `rag.index` re-files its
    vectors under the pinned fingerprint without re-embedding. `rag.spaces` lists spaces (model, runtime, vectors,
    complete, active, size, last used); `rag.dropSpace <id-prefix>` deletes one, never the active one without
    `--force`. `index/state.json` keeps its v1 fields plus `space`.
  - When the active space is missing or incomplete, or the query cannot be embedded, `hybrid` search runs on BM25
    alone: every hit carries `degraded: true` and a warning is logged — never an error, so Claude keeps working
    while vectors build.
- **Which models this PC uses** (`rag/activation.ts`): this PC's choice in `settings.json.rag.byProject[<key>]`,
  the key being the project folder's real path (lower-cased on Windows); else `project.json.rag.reference` (a pack
  `{ "pack": "light" }` or a pair `{ embedding, reranker }`, the team's reference that the benchmark measures);
  else the v1 `rag.embedding` / `rag.reranker` names (mapped to catalog entries); else the Light pack. A step is
  taken only when its embedding model is installed here (a missing reranker is reported and left out). With none
  installed, `rag.index` builds the lexical index only and says why. `rag.status` reports the active model, where
  its choice came from (`machine | reference | project | light | none`), the active space and any degradation.
  The index stays per machine; two colleagues on different models get the same kind of sources, checked the same
  way.
- **Models are data** (`models/catalog.json`, shipped; plus the user's own entries in
  `%APPDATA%\Testimus\models.json`). An entry names one exact quantization, its sources (`hf` repo at a pinned
  revision with the SHA-256 of every file — or the git blob id of small non-LFS files —, the GGUF `file` SHA-256,
  the explicit `ollama` tag), its runtimes, dims, max input tokens, pooling, instructions, `dtypeByDevice`,
  `rerankerKind` (`cross-encoder`, `yes-no-lm`, `http`), sizes, devices, tier and its `lighter` / `heavier`
  neighbours. Nothing in the code or the UI names a model. First catalog (15 entries, all tried on the dev PC):
  bge-m3 q8 / fp16 and Qwen3-Embedding-0.6B q8 / fp16 (ONNX, transformers.js); Qwen3-Embedding 0.6B Q8_0, 4B
  Q4_K_M / Q8_0, 8B Q4_K_M / Q8_0 (GGUF, llama.cpp or Ollama — the same files); bge-reranker-v2-m3 q8 / fp16 and
  Qwen3-Reranker-0.6B ONNX (`yes-no-lm`); Qwen3-Reranker 0.6B / 4B / 8B Q8_0 (GGUF, llama.cpp). Excluded as
  before: licences that forbid commercial use.
- **Packs** (`catalog.json.packs`): a named intent that each PC resolves for its own hardware — **Light** (bge-m3
  q8 on the CPU, no reranker), **Performance** (Qwen3-Embedding-0.6B fp16 on DirectML, else q8 on the CPU),
  **Balanced** (4B Q8_0 + Qwen3-Reranker-0.6B, else 4B Q4_K_M + bge-reranker-v2-m3), **Quality** (8B Q8_0 +
  Qwen3-Reranker-4B, else 8B Q4_K_M + 4B, else 4B Q8_0 + 0.6B; 80 candidates, rerank top 40). Hand-picked
  models are « Custom ». A unit test over `catalog.json` proves that every pack resolves without Ollama (every
  model has a Hugging Face source and a transformers or llama.cpp runtime) and that Light and Performance need
  transformers.js alone.
  - `models packs` resolves each pack to its first variant whose models are obtainable here and fit together,
    else to its lightest variant that is not « RAM too small » (flagged), else « not available on this PC », and
    says why each skipped variant was skipped, with the numbers, plus what is left to download. Each card also gives its variant's speed on this PC from the journal and its quality on this project: the `must`
    evidence recall at 10 of the latest benchmark report for that pair (search+graph when available), marked
    provisional when the report is, else « quality not measured yet ». `models usePack
    <pack> [--dry-run]` shows the plan (downloads, folder, reindex, expected speed), then in a job installs what is
    missing (and the llama.cpp build if a GGUF needs it), activates the variant for the project on this PC and
    starts the index job. `models use` is the Custom pack (installed models only). First launch proposes the
    heaviest pack that fits without running a GGUF on the CPU, Light when the hardware is unknown.
- **Models on this PC.** The machine registry `%APPDATA%\Testimus\models.json` holds the models folder (`dir`),
  the llama.cpp folder (`runtimesDir`, default `<dir>\runtimes`), `allowRemote` (the old
  `settings.json.models.allowRemote` is still read), the installations (`model`, `via` path · download · ollama,
  `runtime`, `path`, `revision`, `dtype`, `device`, `sha256`, `status`, `verifiedAt`), Ollama's host and the
  llama.cpp build. The chosen folder, `TESTIMUS_MODELS`, `%LOCALAPPDATA%\Testimus\models` (v1 downloads) and the
  release `models/` are searched, the last three read-only. A model resolves, per PC, to: the file already
  registered or found in those folders; else Ollama, when `settings.models.useOllama` is not `never` and a running
  loopback Ollama already holds the entry's tag; else a download from Hugging Face served by transformers.js
  (ONNX) or llama.cpp (GGUF). ONNX runs on DirectML when the entry has a `dml` dtype and the PC a GPU, else on the
  CPU; GGUF runs on the GPU when there is one.
  - `models add <path>` registers a Hugging Face folder (matched by the catalog's file list), a `.gguf` file
    (matched by size, then its SHA-256) or a llama.cpp folder, probes it (one sentence, dimension checked) and
    never copies unless `--copy`.
  - `models pull` (a job) downloads only the files of the dtype, at the pinned revision, through Node's `fetch`
    (never `curl.exe`, never without certificate checks): each file goes to `<name>.part`, resumes with a Range
    request, is checked against its SHA-256 (or git blob id) and is renamed only then; a mismatch deletes it and
    fails the job; a cancel keeps the `.part`. **No model is written before the user chose the folder**: without
    one it stops with « Choose where models are stored: `testimus models setDir <folder>` » (or `--dir`); the UI
    asks with a dialog listing the drives. It refuses when the drive has less than 1.2 × what is left to
    download. `system.pullModel` is an alias.
  - `models setDir <folder> --move | --keep | --copy [--dry-run] [--runtimes]`: without a choice it stops and asks;
    downloads are grouped by folder, so a folder two variants of one repository share (bge-m3 q8 / fp16) moves once and
    every installation that points to it follows. Move on the same drive renames, on another drive copies, checks every
    file's SHA-256 and deletes the old copy; copy keeps the old one; keep re-registers the downloads by their path. A
    file already at the target is reused when its SHA-256 is the same; one of another size (refused at the plan, so
    `--dry-run` says it) or another SHA-256 (refused before anything moves) stops it with the file named. A cancel or a
    failure leaves the old copy and the registry untouched. Refused, with the reason: not enough space (for what is left
    to write), not writable, a running index or model job, a folder inside a project. Ollama's own folder is never
    touched (the UI explains how to move it).
  - `models remove` deletes a download's own files — those of its dtype, never a file another registered installation
    in the same folder uses (tokenizer, config…), so the other variant stays installed and verifiable —, only
    unregisters a path, and asks `--confirm` before Ollama deletes. `models list` gives each installation the size of its
    own files. `models verify` records `verified` or `broken` in the registry (a mutating command, so read-only Claude
    runs do not get it).
- **Runtimes** behind one seam (`probe`, `embed`, `rerank`), chosen by the installation:
  - **transformers.js** (in the app): device per installation (`cpu`, `dml` DirectML, `webgpu` experimental), dtype
    per device from the catalog; inputs truncated by tokens at `maxInputTokens`; last-token pooling pads on the
    left so batches work; fp16/fp32 texts are batched by token length (≤ 4,096 tokens, ≤ 8 texts); q8 models embed
    one text per call, because their dynamic activation quantization makes a vector depend on its batch-mates (cos
    0.935 measured on Qwen3 q8). Rerankers: `cross-encoder` (`yes-no-lm`: R11). Measured on the dev PC: bge-m3 q8
    CPU 6.6 passages/s, fp16 DirectML 92/s; Qwen3-0.6B q8 CPU 2.1/s, fp16 DirectML 27/s.
  - **llama.cpp** (GGUF): Testimus starts one `llama-server.exe` per loaded model, bound to 127.0.0.1 on a free
    port with a random `--api-key` per start (a request without it gets 401): `-m <gguf> (--embedding --pooling last
    -ub 8192 | --reranking --pooling rank) -ngl 99 -c 8192`. It waits for `GET /health` = `{"status":"ok"}` (3 min
    at most; a failure quotes the end of the server log), embeds with `POST /v1/embeddings` in batches of 16 and
    reranks with `POST /v1/rerank` (scores in 0–1, returned in the order of the passages). A server stops after 10 idle minutes, when its load is cancelled and when Testimus exits (`taskkill /T /F`). Callers
    asking for the same model share one start; the cancel of a job or of `models verify` (its signal reaches the start
    through the operation's scope) withdraws that caller, and the start is stopped and its process killed once no caller
    that can cancel is still waiting. Measured (b12032 CUDA, RTX
    5080): Qwen3-Embedding-0.6B Q8_0 ready in 0.8–1.1 s, 1 query + 5 passages in 38–43 ms; Qwen3-Reranker-0.6B Q8_0,
    5 passages in 23–31 ms; CPU build: ready in 3.1 s, 6 texts in 258 ms.
  - **Ollama** (optional, never required): host from `OLLAMA_HOST` or `models.json.ollama.host`, default
    `http://127.0.0.1:11434`; a host that is not loopback is refused (documents would leave the PC),
    `models.useOllama: "never"` turns it off. States: absent · stopped (`ollama.exe` found, nothing answers) ·
    running · disabled · refused. Embeddings through `POST /api/embed` in batches of 16 with the instruction added
    by the app; pull and delete through its API (delete after confirmation). No rerank through Ollama. Not
    installed on the dev PC: proven against a fake server only.
- **Fit.** `models hardware` profiles the PC without admin rights: RAM and CPU from Node; NVIDIA GPUs from
  `nvidia-smi` (total and used VRAM); other adapters from WMI `Win32_VideoController`, their VRAM from the
  registry's `HardwareInformation.qwMemorySize` (free VRAM unknown); free space per drive; models loaded by Ollama
  (`/api/ps`) and by Testimus' llama.cpp servers (each server named by the catalog id of the model it serves). A model already loaded for the pair being judged is not
  one of the « other loaded models »: it does not unload itself, and its memory counts as already there; for another
  candidate it is named among the models to unload. Cached 10 minutes; `TESTIMUS_MACHINE` imposes a profile (mock,
  e2e). A model needs what was measured on this PC (journal), else the catalog's `ramMB` / `vramMB`, else 1.2 × its
  download. `models fit` judges the embedding and the reranker **together**: fits (need ≤ free × (1 − headroom));
  tight (within the margin, or only once other loaded models are unloaded — they are named); gpu-too-small (need
  > total VRAM: runs partly on the CPU); ram-too-small (refused); unknown (no VRAM figure: « Testimus measures it on
  first use »). Messages carry the numbers. On the dev PC (RTX 5080 16 GB): 8B Q8 + reranker 4B = tight (13.6 GB for
  11.6 GB usable), 8B Q4 + 4B = fits, so Quality resolves to its second variant.
- **Timings journal** `%LOCALAPPDATA%\Testimus\perf\journal.jsonl`: one line per model operation — `model.load`,
  `embed.query`, `embed.index` (one line per index batch of 16), `rerank`, `search.bm25`, `search.vector`,
  `search.total`, `claude.run` — with only ids, counts and times: `{ at, op, model (catalog id; the Claude model for
  claude.run), fingerprint (vector space id), runtime, device, quantization, items, tokens?, ms, loadMs?, peakRssMB?,
  vramMB?, partialOffload?, oom?, project?, jobId? }`; never document or query text (unknown keys and multi-line
  strings are dropped). Every embedding and rerank goes through one dispatcher that writes its line; a model loaded
  during an operation gets its own `model.load` line and its time is taken out of the operation's `ms` (kept as
  `loadMs`; `search.*` subtract it too). Loads: transformers.js records the process peak RSS; llama.cpp the NVIDIA
  memory used before and after the server is ready (`nvidia-smi`); Ollama its load time and, from `/api/ps`,
  `size_vram` and whether the model is partly on the processor. A load or an operation that fails for lack of memory
  is written with `oom: true`; those lines are left out of the timings and counted. Every line written inside a job
  carries the job and the project. Kept 90 days and 100,000 lines at most; `models perf` gives count, p50, p95, items
  per second, peak memory and memory failures per operation × model × device; `models list` and the pack cards show
  « on this PC: query 22 ms, rerank 25 ms, index 9.3 passages/s ». Measured on the dev PC (CPU): bge-m3 q8 loads in
  1.4 s (1.2 GB peak), queries in 22–30 ms.
- **Advice.** `models advice` compares the last 50 operations with `settings.json.rag.budgets` (`queryMs` 1000,
  `indexPassagesPerSec` 5, `headroom` 0.15): over budget, partly on the CPU (an operation or a load), or out of
  memory (an `oom` line among the model's last 50 operations) → the next variant of the active pack that fits, then
  the next lighter pack (hand-picked models: the `lighter` chain); p95 under 20 % of the budget → the heavier variant
  or pack that fits. The quality side reads the project's benchmark reports (`.testimus/eval/`, v2, not `bm25`, no
  `--retrieval` override): when the current pair and the candidate each have one (matched by vector space id when
  known, else by catalog ids, same reranker; the latest) it quotes `rag.compare`'s paired difference in `must` recall
  at 10 with its bootstrap interval (« −3 points of evidence recall, interval −5…−1 (recall@10, 40 behaviors) », plus
  « provisional » when either set is); else « quality difference not measured — run rag.eval --embedding <id> on the
  candidate before switching ». `models dismiss` hides an advice until its figure moves by more than 25 %. Testimus
  never switches by itself.
- **Benchmark** (SPEC-RAG §10). Retrieval settings and models are chosen by measurement over
  `<project>/eval/behaviors.jsonl`: one line per functional behavior `{ id, question, queries[], evidence: [{ ref:
  docId#anchor, role, must }], category?, validated? }`, roles `definition`, `rule`, `condition`, `exception`,
  `amendment`, `contradiction`, `figure`. The v1 `eval/questions.jsonl` is still read (each expected anchor = a
  `rule`, `must: true`) when `behaviors.jsonl` is absent. A line with `validated: false` (a bootstrap set proposed
  by Claude, not yet confirmed by a tester) makes every report **provisional**.
  - `rag.eval` (L1, a job) runs each behavior under two fixed policies: `search` (rag.search on the question and
    each query, fused by RRF) and `search+graph` (the same, plus `rag.related` on the anchor and requirement ids of
    each top-k passage, plus `rag.mentions` on the queries and the ids and acronyms of the question). Metrics at
    k = 10, 20, 50: evidence recall (mean share of `must` evidence found), complete (share of behaviors with every
    `must` found), precision, characters returned to Claude, recall by role (exceptions, amendments,
    contradictions first); nDCG@10 and MRR on the search ranking. The report, `.testimus/eval/<date>-<setting>.json`,
    stores the chunker version, header mode, vector space id and fingerprint, effective retrieval settings,
    reranker, ks, corpus hash, set hash, app version and the provisional flag. Without overrides it measures this
    PC's active models; `--embedding` / `--reranker` take a catalog id (or a v1 profile name) installed here,
    embedded into its own vector space of `index/rag.db` (the active space, `state.json` and this PC's choice are
    untouched); `--mode bm25` embeds nothing; `--retrieval.<key>` overrides any retrieval setting for the run.
  - `rag.compare` pairs reports by behavior; the mean difference in `must` recall at k gets a bootstrap 95 %
    interval (10,000 resamples, fixed seed). A configuration is adopted only when the interval is above zero and
    no role's recall goes down (exceptions first); then this section records the result and
    `project.json.rag.reference` changes. On a provisional set the decision is provisional.
  - `gen.bench` (L2, a job, costly) runs, per configuration × behavior × run, the configuration's activation,
    `rag.index`, then `gen.tests` on the question; it scores the agentic recall from the evidence ledger, tests
    written, findings, quote errors, cost and duration; reverts each run's tests unless `keep`; restores the
    previously active configuration.
- The index is **derived**: `rag.index` rebuilds what changed (by `doc.json.source.sha256` and chunk hash).
  Nothing in it is ever the only copy of anything; sources point at `doc.md` anchors, never at chunks.
- Claude also reads `doc.md` files directly (Grep/Read) — the index finds, the file proves.
- Details fixed while building (2026-11):
  - Chunk ids: `docId#§x.y`, `docId#§x.y~n` for the parts of a split section, `docId#fig:N` for a figure
    (its path is the section that shows it), `docId#req:ID@matrix` for a matrix row (`~2`, `~3` when an id
    repeats; text = the row's cells joined by ` | `; path and header = the traced section, the matrix's own
    section when the cell says « À compléter »). The matrix table is left out of its section's own chunks.
  - Requirement graph, rebuilt with the chunks into `rag.db` `edges(src, dst, kind, doc_id)`, full references
    (`docId#anchor`, a bare `docId` for a document-level amendment): `defines` req → section of its statement;
    `traces` req → the matrix Section column and `requirements/requirements.csv` (`doc`, `chapter`), existing
    sections only; `mentions` section → every id in its text; `refers` section → `§ x`, `cf. x`, `voir le
    chapitre x`, `section x.y` of the same document and `<code or id> §x` of another, existing sections only;
    `parent` / `sibling` from the numbers; `shows` section → its figure markers; `amends` from `doc.json.amends`,
    and section-level when the amending text names a section (`P25 § 2.1`) that exists in exactly one amended
    document and not in the amending one (7–29 such edges in each J5 PA). Measured on D401-1_3: 324 `defines`,
    174 `traces`, 494 `mentions`, 102 `parent`, 418 `sibling`, 43 `shows`.
  - Passage cap: `rag.passage` text is capped at `project.json.rag.passageMaxChars` (default 12,000). Above it:
    `truncated: true`, whole lines around the focus (from the top without one) plus the header rows of the table
    the focus sits in, `outline` = every sub-section `{ anchor, title, chars, reqIds, figureIds }`, and `readMore` =
    `Read docs/<id>/doc.md lines a–b …`. `req:ID` → `focus` = the statement (§4), `text` = the owning section;
    `req:ID@matrix` → `focus` = the rendered row. Measured on D401-1_3: `req:EXI_MOP_SPF_531_A_1670` focus 142
    characters (was 93,950), `req:EXI_MOP_SPF_511_A_10` focus 444 (was 24).
  - `docs.show` returns `info: [{ req, defined, traced, message }]` for a body requirement whose matrix section is
    neither its defining section nor an ancestor of it, or is missing from the document — often the sign that the
    matrix and the body disagree.
  - Context header: Claude's sentence comes through `hooks.describeChunks`, asked only for new or changed chunks,
    and only when `project.json.rag.claudeHeaders` is true (off by default: on 900 pages it costs hundreds of
    runs). Figure descriptions are written by Claude once per document, in batches, at conversion
    (`rag.describeFigures`, on by default). Without Claude (or when it fails) the deterministic header
    `<code> <title> — <path> <section title>` is used and a warning is logged.
  - A document counts as superseded when `status` is `superseded` or `supersededBy` is set; its chunks stay
    indexed and are left out of search unless asked.

## 6. Test file (`test.md`)

Xray Editor's format (its `SPEC.md` §3: frontmatter, `## Step N <!-- id -->`, embedded screenshots
as `![](images/… "params")`, wiki tables, escaping, lossless round-trip) with three changes:

1. **Step fields are generic.** Each `### <Field>` heading is a field of the project's Xray step
   schema (`xray.json`): `Action`, `Data`, `Expected Result` and every custom step field
   (`Exigence` for LFRPS12). Unknown headings are kept verbatim and reported. Xray Editor's
   `### Expected` is read as `Expected Result`.
2. **`### Sources`** (local, never pushed) — one line per claim the step relies on:
   `- <docId>#<anchor> "<short exact quote>"`, e.g.
   `- SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"`.
   `docId` is the document code; an anchor is written `§5.6.6`, `req:EXI_MOP_SPF_511_A_1670` or
   `fig:40` (the three anchor kinds of §4).
   A quote must appear verbatim (whitespace-normalised) in `docs/<docId>/doc.md`; that is checked
   mechanically before any model looks at the test (§8).
3. **Review state** in the frontmatter (local; mirrored to Xray as a label on push, §9):
   `review: draft | checked | to-fix | validated`, `review_note: "…"`, `reviewed_by`, `reviewed_at`,
   `generated_by: "<job id>"`.

Tolerance (after the adversarial review, 2026-11): the frontmatter fence is `---` with optional
surrounding whitespace, CRLF and BOM tolerated; unknown `##` sections, unknown frontmatter lines,
comments, multi-line values (YAML lists) and an unknown `review` value are written back unchanged, with
a warning; a `### Result` / `### Expected` alias yields to an `xray.json` field of that exact name.
Attachments and embedded images must be relative paths inside the test folder (the parser warns, a write
refuses anything else). The review keys are read-only for the editor (`tests.save` keeps them from disk):
only `review.set`, the check and the fix change them; `review.set` refuses a file whose frontmatter is
not closed.

Writing rules: `labels:` and `review:` are always written, `review_note` is always quoted, empty fields
are left out, and text before a step's first `###` is read as Action.

`check.json` beside it is the last check's output (§8), derived, never edited. Its `testHash` is the
sha256 of `test.md` after the frontmatter, so a review decision does not make findings stale.
`tests/<id>/.remote-changed` is a derived marker (Jira changed since `.remote.md`): set by the sync's
re-check, cleared by a pull or a push, never edited.
The parser stays tolerant (never throws on a human or Claude edit; returns warnings).

## 7. Generation

- Input: a request (a feature in words, a document section, a list of requirement ids, or a mix), a
  target Xray folder, the project's language (default `fr`).
- Run: `gen.tests` starts a job that runs the project's `generate-tests` skill through `claude -p`
  with the MCP tools available. The skill searches the index, reads the cited sections and figures,
  and writes one `tests/local-<8hex>/test.md` per test with `review: draft`.
- Rules the skill enforces (they come from the testers' current prompt, sharpened by what went wrong
  with it):
  - positive and negative paths, black-box or white-box technique chosen per feature and named in
    the description;
  - **when requirements are given, each one is covered** by at least one step, and a step's
    `Exigence` field lists only requirements the step actually verifies;
  - every expected result has a source; no source → the step is not written, the gap is reported;
  - "not simulated" is written only when a source says so;
  - no reference inside Action / Expected text; references live in `Exigence` and `### Sources`;
  - figures from the documents are embedded where the step needs them.
- Output of the job: the test ids written, and the requests it could not cover (with why). The skill
  ends its reply with a fenced `gen-report` block `{ "tests", "covered", "uncovered": [{ item, why }] }`
  that the core parses; the result is also kept in `.testimus/gen/<jobId>.json`. Every new test is
  stamped `review: draft` + `generated_by: <jobId>` and gets its mechanical check at once. The run is
  snapshotted, so a whole generation can be reverted (`claude.revert`).
- **Evidence ledger**: from the run's stream-json tool calls (never from the model's report) the core derives what
  the generation opened — `rag_passage`, `rag_related` and `rag_figure` references (a `req:` reference also counts its
  statement's section), `Read` of `docs/<id>/doc.md` mapped to every section the line range crosses, `Read` of a
  figure image mapped to its `fig:N` — and the searches it made (`rag_search` query, `rag_mentions` term, `Grep`
  pattern on the documents). Failed calls are ignored; a search result is not an opened passage.
  `.testimus/gen/<jobId>.json` stores `consulted` (references, in the order opened), `searched` (`{ tool, query }`)
  and `reportedConsulted` (the gen-report's own list); `gen.tests` returns `consulted` as a count; `gen.bench`
  scores agentic recall from `consulted`.
- Figures: `tests.addImage` copies a file or a document figure (`docId#fig:N`) into `images/` and embeds
  it at the end of a built-in field; the editor's paste mode (`{ name, ext, dataBase64 }`) only stores
  the file. Figure descriptions run in batches of 20 figures per Claude run (read-only, effort low).

## 8. Check (anomalies)

Two passes, run on demand, on generation, and before review:

1. **Mechanical** (core, no model): every source resolves (doc exists, not superseded, anchor exists,
   quote found); every `Exigence` id exists in `requirements/` or in a document; empty fields; a
   step with a `raw` embed; duplicated steps.
2. **Semantic** (`check-test` skill, one test per run, parallel across tests): for each step, does
   the cited passage say what the expected result claims? Plus: requirement listed but not verified,
   requirement in scope but not covered, contradiction between two cited documents (resolved by
   `doc.json` status/binding, else reported), wrong object (the step tests something other than what
   its requirement describes), negative path missing.

`check.json`: `{ at, testHash, findings: [{ step?, kind, severity: "error"|"warning"|"info",
message, sources: [docId#anchor], pass: "mechanical"|"semantic" }] }`. A finding is stale when
`testHash` no longer matches.

Rules fixed while building (2026-11):
- The requirement field is `project.json.requirementField` if set, else the `xray.json` field named like
  « exigence » or « requirement ». An id is known when it is in `requirements/requirements.csv`, is a
  `req` anchor, or matches `REQ_PATTERN` / `requirementPatterns` in a document's text.
- Quotes match whitespace-normalised and case-sensitive, ignoring `*` and `<!-- … -->` on both sides, and only
  inside the cited passage: `§x` = the section with its subsections, `req:ID` = the section holding its
  statement, `req:ID@matrix` = the row, `fig:N` = the caption paragraph only (what the picture shows is the
  semantic pass's job, and `check-test` must `Read` the image before accepting it), `page:` = up to the next
  page. Not in the document → `quote-not-found` (error); in the document but not in the passage →
  `quote-not-at-anchor` (error) naming where it is — the section whose own text holds it, else a matrix row, else
  a caption — with both references in `sources`. Under 4 words or 20 characters, or found more than once in its
  passage → `quote-weak` (warning). The review panel highlights a quote only at its anchor.
- `related-unread` (info, mechanical): for a test whose `generated_by` job has an evidence ledger, each section
  that `rag.related` gives as defining or tracing a requirement of the requirement field, and that the generation
  never opened (neither the section nor a section above it), on the first step that lists that requirement. No
  ledger, no finding.
- `check.run` writes the mechanical findings first; the skill sends its findings with `check_record`,
  which replaces the semantic ones, keeps the mechanical ones and stamps the current `testHash`. A failed
  semantic run leaves an `other` warning. Semantic runs go 3 at a time, with Read, Glob, Grep, Skill and
  only the read-only MCP tools plus `check_record`; a test a check run edits anyway is put back.

## 9. Review

- The review view shows, for one test: the steps (editor, §13), its findings, and the **source
  passage** of the selected claim with the quote highlighted (and its figure).
- Two decisions: **Validate** (`review: validated`) or **To fix** with a note (`review: to-fix`).
  "To fix" offers **Ask Claude to fix it** (`fix-test` skill, scope = this test, note as request);
  the result goes back to `checked` after a re-check, never straight to `validated`.
- A test goes `draft` → `checked` only after a successful semantic check. `to-fix` needs a note;
  `validate` clears it; `reviewed_by` is the OS user name. Review changes touch frontmatter lines only,
  so they never make findings stale. `review.fix` = fix run → re-check → `checked` (findings may
  remain), with a run id for Revert.
- A push of a test that is not `validated` asks for confirmation.
- On push, the review state becomes a Jira label (`testimus-validated`, `testimus-to-fix`) so the
  team sees it in Jira; the label prefix is a `project.json` setting.
- `review.evidence <testId>` → `{ testId, jobId | null, consulted, read: [{ ref, title, cited }], related: [{ ref,
  kind, title, read, via }], searched }`: « sources read » (what the generation opened; `cited` when a step's source
  is that reference or one of its sub-sections) and « sources related » (the sections `rag.related` links to the
  requirements in the requirement field, read or not). The Review screen shows both.

## 10. Xray sync

Everything Xray Editor does (its `SPEC.md` §5–§6: pull with images, folders, preconditions, covers
links, dirty detection against `.remote.md`, push plan, 429 back-off, sequential execution that
stops at the first failure), plus:

- **Step field schema**: `xray.fields` reads every step field of the project, custom ones included,
  into `xray.json.fields` `[{ id, name, type, builtin }]`. Source (checked read-only on LFRPS12,
  2026-11-02): GraphQL `getProjectSettings(projectIdOrKey) { testStepSettings { fields { id name type
  required disabled values } } }` — the built-ins come back as `action`/`data`/`result`, LFRPS12 adds
  `Exigence` (`text-single`, id `69d5fcb02f2b49abf7fb76e6`). Steps read `customFields { id name value }`
  (Exigence value: `"EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660"`) and write
  `customFields: [{ id, value }]` in `CreateStepInput` / `UpdateStepInput`. `xray.json.prefs` is local:
  `{ order: [name], collapsed: [name], hidden: [name] }` — e.g. `collapsed: ["Data"]`.
- **CSV import**, two modes, both from `xray.importCsv`:
  - `local` (default): map CSV columns to fields (the mapping is saved in `project.json` for the
    next file), group rows into tests, write `local-*` tests with `review: draft`, run the
    mechanical check. They are then reviewed and pushed like any other.
  - `direct`: same parsing, then Xray's bulk import (`POST /api/v2/import/test/bulk`, poll the job),
    then pull the created tests. Shows the plan first like every write.
  - The CSV shape the team produces today (`Step, Action, Expected Result, Exigence,
    Source Reference`) is the first fixture; `Source Reference` numbers are dropped with a warning
    (they mean nothing outside the tool that made them).
- Fixed while building (2026-11): the review label is `<labelPrefix><review>` and replaces any other
  label of that prefix; a pull reads the review state back from that label and keeps the local
  `### Sources`, `review_note` and `generated_by`. CSV mapping targets are a field name or `#step`,
  `#summary`, `#description`, `#folder`, `#labels`, `#ignore`. A field value Xray returns as a list is
  joined with `", "`. Screenshots embed only in the three built-in fields. The project id and test
  issue type are cached in `.testimus/jira-project.json`. Not yet proven live: custom step fields inside
  the bulk-import payload, and whether a custom field is cleared with `""` or `null`.
- Push safety (after the adversarial review, 2026-11): `xray.plan` returns a `planHash` (the ordered
  operations and `test.md`); `xray.push` requires it and refuses when it no longer matches, so the plan
  executed is the plan shown (a resume uses the kept plan's hash). One push per test at a time; the
  create re-reads the local test first. A test changed in Jira is pushed only with `overwriteRemote`.
  A cancel is honoured between operations (the one in flight finishes; the job is « cancelled » only when
  nothing ran after it). Attachments must be files inside `tests/<id>/`. An empty or space-containing
  `labelPrefix` falls back to `testimus-` with a warning. Direct CSV import saves the mapping once Xray
  accepts the job and returns its `jobId` when polling times out; `{ mode: "direct", jobId }` resumes.
- **Never write to a production Jira project during development.** Write paths are proven by unit
  tests over a fake `http` asserting exact payloads (Xray Editor's rule). Live checks are read-only.

## 11. Claude

- Every run is `claude -p` with the prompt on **stdin**, cwd = project folder,
  `--output-format stream-json --verbose`, `--model`, `--effort`, `--permission-mode acceptEdits`,
  `--add-dir` for each attached context, `--mcp-config .mcp.json` and `--allowedTools` covering
  `mcp__testimus__*` (a project `.mcp.json` alone is not trusted in `-p` mode). Stream events are
  forwarded to the UI as they come (tool calls, text, cost). Also `--strict-mcp-config` and
  `--tools Read,Edit,Write,Glob,Grep,Skill` (chat: Read, Glob, Grep, Skill only). Every run and
  `project.init` rewrite `.mcp.json` so it starts the same Testimus (the installed shim, or `node
  <checkout>/src/faces/cli.ts mcp` in development).
- Runs are recorded under `.testimus/runs/<runId>/run.json` (contents before, hashes after, the tests the
  run itself wrote, changed steps); **Revert** works from the run id, also after a restart, refuses when a
  test changed after the run (unless `force`, which the UI sends only from an explicit « Revert anyway »),
  and never deletes a test the run did not write. The Generate screen shows the check results `gen.tests`
  returns (`checks`); it starts no check of its own.
- Tool access per run kind (after the adversarial review, 2026-11), computed from the registry:
  chat, figure descriptions and context headers get the read-only commands only (no job, no `system`,
  `project`, `jobs`, `claude`, `chat.ask`, `rag.eval`); the check adds `check_record`; generation adds
  `tests_create`, `tests_edit`, `tests_save`, `tests_addImage`, `check_run`; a fix or `claude.run` adds
  `tests_edit`, `tests_save`, `tests_addImage`. Every other Testimus tool goes into `--disallowedTools`,
  with `Edit`/`Write` on `docs/**`, `index/**`, `.testimus/**`, `contexts/**`, `requirements/**`,
  `.claude/**`, `project.json`, `xray.json`, `.mcp.json`, `CLAUDE.md`. Model names and effort are
  validated before a run; context ids are `[\w-]+`; `--add-dir` only gets existing folders. `.mcp.json`
  sets `TESTIMUS_IN_CLAUDE=1`, under which `check_run` is mechanical only; installed, it runs
  `cmd /c <abs>\testimus.cmd mcp` (the shim sets `TESTIMUS_HOME_BIN`).
- A semantic check counts only when the run called `check_record` for that test; `review.fix` returns to
  `checked` only after a successful semantic re-check (else it says why in `message`); `gen.tests` checks
  what it wrote (`check`, default true, result in `checks`) and claims only the tests its run wrote.
  `project.init` keeps a team-edited skill and writes the new one beside it as `SKILL.new.md`
  (`.testimus/shipped.json` records the shipped versions); `project.set` refuses an empty or
  space-containing `labelPrefix`.
- `rag_mentions`, `rag_related` and `review_evidence` are read-only commands, so every run kind gets them. The
  shipped skills use them (SPEC-RAG §4.6): `generate-tests` calls `rag_related` on each requirement and section in
  scope and `rag_mentions` on each object, screen, gesture and acronym, reads the sections in full before designing,
  cites a fact only a figure shows as `fig:N` with its caption after reading the image, and lists `consulted` in its
  gen-report; `check-test` reads a `fig:` source's image before accepting it and looks for contradictions with
  `rag_mentions` in the other documents and the amending ones; `ask-docs` says « the documents do not say » only
  after `rag_mentions` and `rag_related`; `fix-test` finds sources the same way.
- **Chat** ("talk to the documents"): a session per conversation, continued with `--resume
  <session_id>`, stored under `.testimus/chats/`. The `ask-docs` skill answers with sources in the
  same `docId#anchor "quote"` form, rendered as clickable chips.
- Before a run that may edit tests: snapshot the scoped `test.md` files; after it (success, failure
  or cancel): reload, list changed tests, offer **Revert** (Xray Editor §7). Cancelling a run kills the whole
  `claude -p` process tree (through a `.cmd` shim claude is a grandchild); a run cancelled before it started
  never spawns.
- Failure diagnosis (connect / login / credit / limit / network) and the "Claude not installed"
  panel are ported from Xray Editor as they are.
- Claude acts on the app only through the MCP tools and by editing files in the project folder;
  it never calls the HTTP API.

## 12. Command catalog

Group | Verbs (all with `--json`; mutating ones marked *)
---|---
`project` | `init`*, `info` (project.json + xray.json + field order + counts for the rail), `list`, `set`* (patch project.json: names, language, label prefix, folders, rag keys incl. reference, queryTask, passageMaxChars, retrieval; requirementPatterns, requirementMatrix, glossary; Claude defaults), `open`* (last project)
`docs` | `add`* (copy + convert; a path, or an upload as base64 from the UI), `convert`*, `list`, `show`, `set`* (status, binding, supersededBy, amends, context…), `describeFigures`* (job, Claude), `remove`*
`rag` | `index`* (job), `search` (mode hybrid · bm25 · vector; `expand`), `passage` (docId#anchor → text + figures + focus, capped), `figure`, `mentions` (every passage holding a term, no model), `related` (graph neighbours, no model), `eval` (job, L1), `compare` (reports → intervals), `status` (active model, space, freshness per document), `spaces`, `dropSpace`*
`chat` | `ask` (job, streamed), `list`, `show`
`claude` | `run`* (job: a scoped request « On this test » — step, test, tests or project), `revert`* (runId), `status` (installed, version, signed in, how to connect)
`tests` | `list`, `show`, `create`*, `edit`* (field-level patch and step ops set · add · remove · move · sources, steps numbered from 1), `save`* (the whole test, the editor's save), `clone`*, `addImage`* (a file or a document figure → `images/`), `remove`*
`gen` | `tests`* (job), `bench`* (job, L2 benchmark with Claude; costly)
`check` | `run`* (job: mechanical pass, then the `check-test` skill; writes `check.json`), `record`* (the skill's semantic findings for one test), `show`
`review` | `set`* (validate / to-fix + note), `fix`* (Claude, job), `queue` (what awaits review), `evidence` (sources read / related)
`xray` | `fields`*, `prefs`* (order, folded, hidden), `folders`, `search`, `pull`* (job), `status`, `plan`, `push`* (job; `from` resumes after a failed operation), `importCsv`* (local · direct, with a preview)
`models` | `catalog` (with the fit on this PC), `list`, `add`* (path A), `pull`* (job, download or Ollama), `pullRuntime`* (job, llama.cpp build), `remove`*, `verify`, `setDir`* (move · keep · copy, dry-run), `use`* (Custom), `packs`, `usePack`* (job), `hardware`, `fit`, `perf`, `advice`, `dismiss`*, `ollama`
`jobs` | `list`, `show`, `cancel`*
`system` | `setup`* (credentials), `doctor`, `version` (with `shell`: browser or desktop <version>), `pullModel`* (alias of `models.pull`), `settings`, `saveSettings`* (theme, step layout, claude.exe, model downloads)

Every command is documented by its zod schema; `testimus help <group.verb>` prints it.

## 13. UI

- Served by `testimus serve` at `http://localhost:4317` (`--port 0` for any free port), opened in the default
  browser, or inside the desktop app (« Desktop shell » below).
- Layout: left rail (Documents · Generate · Tests · Review · Jobs), main pane, **Claude dock on the
  right everywhere** (chat with the documents, or a scoped request on the current test).
- **Documents**: list with code, version, status, binding; preview of `doc.md` with anchors and
  figures; `context.md` editor.
- **Generate**: the request, scope (requirements, sections), folder; the job's live output; the tests
  as they land.
- **Tests**: Xray Editor's sidebar and editor, with fields from `xray.json` (order, folded,
  hidden), a `Sources` strip per step (chips → passage), the review state badge.
- **Review**: queue of tests to review; per test: editor + findings + source passage; Validate / To
  fix.
- Screens as built (2026-11), following the design « Testimus — UI draft »:
  - **Review** — three columns: queue (review.queue; filter All/Checked/To fix, sort Most issues/State/Folder/
    Recent, Only with findings, folder), the test read-only (findings placed on their step, test-level ones on top, stale
    marked; Edit opens the editor in place), source panel (rag.passage of the selected source or finding). Footer: To fix
    (F, note required, optional « ask Claude » = review.fix shown in the dock) and Validate (V, allowed with open errors,
    moves to the next test). J/K next/previous test, ↑/↓ step. The dock is folded to its strip in Review.
    The source panel ends with « Sources read / related » (`review.evidence`, folded): the passages the
    generation opened (cited ones marked) and the related sections it never opened, each opening in the panel; « not
    recorded » for a test without a ledger. A quote with a `quote-not-at-anchor` finding is not highlighted: the
    finding's message is shown above the passage.
  - **Generate** — request, optional requirements (search by id or text over requirements.csv + document ids),
    sections (docs.show toc), folder; gen.tests job shown live (passages read, tests landing as cards from « Writing
    local-… » progress); at the end check.run on the new tests, then the summary (written, requirements covered, not
    covered + why) and « Review these tests ».
  - **Documents** — list (code · version, title, status, binding, search state from docs.list.indexed, warnings);
    drop or pick .docx/.pdf → docs.add job (by `file` path in the desktop app, `{ name, dataBase64 }` in the browser) — when the index has no vectors on this PC, a line « Search on words only » gives the reason and « Choose a search pack » then rag.index job; detail edits status, binding,
    superseded by, amends, context (docs.set), shows the toc and the section text, requirement ids and figures as links.
  - **Import CSV** — file → columns (mapping from project.json.csvMapping, guessed otherwise) → preview (tests,
    steps, warnings) → Import locally (default, then a mechanical check) or directly into Xray (dryRun plan shown first).
  - **Jobs** — list (kind, subject, progress, duration, result) and detail (live log from jobs.show + events, Cancel).
  - **System check** — system.doctor rows as icon + word (OK / To do / Failed / Not checked / Info) with what to do;
    « Check Claude sign-in » = doctor {claude:true}; the rail's status dot shows the last result.
  - **First launch (#/setup)** — shown once per session when the credential files are incomplete or no project is
    open: Access (system.setup prefilled, secrets never sent back, Test connection = setup with check), Project
    (project.list / project.open / project.init), then **Search pack** (`#/setup/pack`): the four packs with fit and
    download, the suggestion preselected (the heaviest pack that fits without a GGUF on the processor; Light when the
    hardware is unknown), « Use <pack> » (dry run; the models-folder dialog when a download needs a folder; then
    `models.usePack`), « Skip for now ».
  - **Settings** — Project, Step fields, Claude, Search, Models, Access, Appearance. Every change saves at once.
    - **Search**: the team reference (`project.json.rag.reference`), the models used on this PC and where that choice
      comes from (`rag.status.activation`: this PC's choice · the team reference · the project's v1 model · the Light
      pack · none), the models chosen but missing here, « Search on words only » with `rag.status.degraded`'s reason, the
      index state with Reindex, and the vector spaces (`rag.spaces`: model, runtime, vectors, size, complete, in use here,
      last used) each with Drop (`rag.dropSpace` after a confirmation; the active one with `force` and a warning). No
      model list is written in the UI.
    - **Models**: the models folder (« Change… »); the advice banner (`models.advice`, first item: reason, quality,
      Apply = the pack's plan or `models.use`, Dismiss = `models.dismiss`); the pack cards Light · Performance ·
      Balanced · Quality from `models.packs` plus Custom, the active one marked « In use », each with its variant here
      (« its second choice »), fit chip and message, skipped variants with their numbers, download left, speed, quality,
      « Use this pack ». A pack or a model whose fit is not « fits » opens a confirmation with the verdict's numbers,
      **Use anyway** and **Choose a lighter one** (the next lighter pack, or the largest smaller model that fits); « RAM
      too small » offers no Use anyway. Use this pack shows `models.usePack --dry-run` (models, downloads, folder,
      reindex, expected speed), then runs it and follows its jobs on the card (progress, Cancel); running model and
      index jobs are picked up again when the screen opens. Below, « Model catalog » (folded): `models.catalog` +
      `models.list` rows with state chip, size, fit chip, kind · tier · runtimes, where it is and the speed measured
      here; Install (`models.pull`), Use (`models.fit` on the pair, then `models.use`), Verify, Remove (after a
      confirmation saying what is deleted); « Add from a folder… » (`models.add`, Browse… in the desktop shell). The
      models-folder dialog opens on the first download and from « Change… »: the drives with free space (from
      `models.hardware`), the roomiest local drive with 1.2 × the need preselected (`<drive>\Testimus\models`), a typed
      folder checked live by `models.setDir --dry-run` (refusals shown with their reason), Move / Keep where they are /
      Copy when downloads exist; never `wait`: a move or copy is followed as a job. The Ollama panel (`models.ollama`):
      not installed → link to ollama.com, installed but stopped → « Start Ollama, then Refresh », running → version,
      host, embedding models, the models loaded now (« partly on the processor » with the GPU share), its folder and how
      to move it; turned off, refused; Refresh.
- Mock: `serve --mock` also fakes the models side, without network and without touching the PC's models: a machine profile
  (`TESTIMUS_MOCK_MACHINE` = `gpu16` default — 16 GB GPU, 32 GB RAM; `gpu-small` — 4 GB GPU, 16 GB: Quality « GPU too
  small », Balanced « tight »; `cpu-only` — no GPU, 6 GB: Quality not available; `unknown` — a GPU without a VRAM
  figure; `dev` — the development PC), written to `<sandbox>/machine.json` as `TESTIMUS_MACHINE` unless that is set;
  Ollama (`TESTIMUS_MOCK_OLLAMA` = `absent` default · `stopped` · `running`: 0.12.6 holding `qwen3-embedding:0.6b`,
  `qwen3-embedding:4b` — loaded partly on the processor — and a chat model; pull and delete work); a llama.cpp build
  (`TESTIMUS_MOCK_LLAMACPP` = `found` default · `absent`: fetched by a simulated job); the models folder
  (`TESTIMUS_MOCK_MODELS_DIR` = `set` default · `unset`: the first download asks for it). Two models are registered by
  path, two downloaded, one half-downloaded (`.part`), the rest available; the machine registry's catalog points each
  file at a few fake bytes whose SHA-256 is true, so `models pull`, `usePack`, resume, checks and `setDir` run the real
  code on the sandbox. `TESTIMUS_MOCK_ADVICE` = `upgrade` default (Light chosen on this PC, fast queries → « Move to
  Performance ») · `downgrade` (Balanced, slow queries) · `offload` (Balanced, partly on the processor) · `none` seeds the
  timings journal and the choice. `TESTIMUS_MOCK_INDEX=bm25` builds the starting index without vectors (search on words
  only until Reindex). `TESTIMUS_MOCK_DOWNLOAD_MS` (2500) paces fake downloads and pulls. A generation request about
  « avec TK » reads only §5.6.6 and cites one quote under the wrong section (the Review's evidence states).
- Narrow widths (from 1080 px, e.g. a laptop at 150 %): with the Claude dock open in Review the queue
  folds to a strip (previous / next) and then the source panel hides, so the test keeps ≥ 420 px; a
  document added but not indexed shows « Indexing failed » with Reindex under its row; finished add rows
  are shown once (the job stays in Jobs). « Added by Claude » marks only steps beyond the step count
  before the run; any other change is « Changed by Claude ».
- A Jira write from the palette (`xray.push`, direct `xray.importCsv`) always shows its plan first, like
  the buttons do. A direct CSV import still running in Xray shows « Xray is still importing » with
  « Check again » (resume by `jobId`, never a second import).
- Shell: Ctrl+K command palette (every registry command by name; a command with input gets a form from its schema), Ctrl+J folds the Claude dock (folded by default at 1280 px and in Review), theme system / light / dark from the rail, step layout and last project remembered per browser; Revert undoes a whole Claude run. The page title is « Testimus — <project name> » (« Testimus » with no project); the desktop window takes it.
- The app logo (`src/ui/public/logo.png`, `favicon.png`; `scripts/testimus.ico` for the Start-menu shortcut)
  sits on a light tile at the top of the rail and on the first-launch screen.
- Look and feel: the design « Testimus — UI draft » (Transurb tokens: teal #00a59a reserved for the
  screen's primary action, ink #0d1111, Lexend / Source Sans 3 / JetBrains Mono), light and dark themes
  from tokens on `:root`, a state always icon + word. Xray Editor's components are ported for their
  behavior and dressed to the design. UI text in English (§16).

### Desktop shell

Built from SPEC-ELECTRON.md (E1–E2). The shell is a window around the HTTP face, not a fourth face: it never
imports `src/core/`, and anything that reads or changes a project goes through `/api`.

- `Testimus.exe` (Electron, `src/desktop/`) starts the core as `node serve --port 0 --no-open --ready-json
  --exit-with-stdin` (release: `node\node.exe app\testimus.mjs` beside the exe; development: `node
  src/faces/cli.ts` with the `node` found on the PATH or `TESTIMUS_NODE`), with `TESTIMUS_SHELL=desktop/<version>`
  (and, in a release, `NODE_USE_ENV_PROXY=1` and `TESTIMUS_HOME_BIN`). The window opens at once on a splash page
  and switches to the core URL on the ready line. No ready line within 30 s, or the core exits: an error page with
  the last 40 lines of the core's output, **Restart** and **Open the log folder**. Logs:
  `%LOCALAPPDATA%\Testimus\logs\desktop-<date>.log`, kept 14 days.
- Single instance: a second launch focuses the window and hands a folder given on its command line to the UI
  (bridge `onOpenProject`).
- Quit: the shell asks the core for the running jobs of every known project (`project.list`, `jobs.list`, with the
  window's session cookie). None: it quits. Some: a dialog names each (« Generate tests · <subject> — 12/40 ») with
  **Cancel and quit** / **Keep working** (always asked; no tray icon). Quitting cancels them (`jobs.cancel`), closes
  the core's stdin, waits up to 10 s, then kills the core's process tree.
- Window: size, position, maximized state and zoom in `%APPDATA%\Testimus\window.json`, brought back onto a visible
  display; title follows `document.title`; menu bar hidden, edit shortcuts (Ctrl+C/V/X/Z/A) and zoom (Ctrl+= /
  Ctrl+− / Ctrl+0) kept; browser profile in `%APPDATA%\Testimus\desktop\` (theme and last project are not shared
  with the browser mode).
- Locked down: `contextIsolation`, no Node, `sandbox`, `webSecurity`, no `webview`, no spellcheck. Navigation off
  the core origin is cancelled; `window.open` of an `https:` URL goes to the default browser, of a same-origin
  `/files/…` URL to a child window without the bridge, anything else is refused; every permission is refused
  except `clipboard-sanitized-write`; downloads are refused. The cookie guard of §2 stays the protection.
- Bridge `window.testimusDesktop` (types in `src/desktop/bridge-types.ts`), only for the main window's top frame
  on the core origin; every call is checked in the main process: `version()`, `pickFolder({ title, defaultPath? })`,
  `pickFiles({ title, filters, multiple })`, `pathOf(file)`, `reveal(path)` (inside a known project or the data
  folders only), `openExternal(url)` (`https:` only), `setProgress(fraction | null)`, `notify({ title, body })`
  (only when the window is not focused; a click focuses it), `onOpenProject(cb)`. It carries presentation only: a
  picked path is then given to a command. The UI reads it in `src/ui/lib/desktop.ts`; every screen works without it
  (browser mode). With it: First launch › Project **Browse…** (`pickFolder`); project menu **Open a folder…** and
  **Show in Explorer**; Documents **Add documents** opens the native picker and a dropped or chosen file goes by its
  path (`docs.add { file, pdf? }`, no base64 — base64 only when no path is known), **Show in Explorer** on a document
  (`docs/<id>/`) and on the open test (its `test.md`); Import CSV **Choose a file** (`xray.importCsv { file }`);
  Settings › Appearance **Browse…** for the Claude program; external links open in the default browser; taskbar
  progress follows the running Generate, Index, Check, Pull and model-download jobs (mean of done/total, cleared when
  none runs); a notification (window not focused) says when a job finishes or fails — a failed Claude run included —
  never for a cancel; a folder handed by a second launch is opened with `project.open`.
- Development: `npm run desktop [-- --mock] [-- --ui-dev]` builds `src/desktop/` to `dist/desktop/` (`main.mjs`,
  `preload.cjs`, `pages/`) and starts Electron; `npm run desktop:build` only builds. `--ui-dev` runs Vite on 4318
  with its proxy pointed at the core (`TESTIMUS_API_TARGET`).
- Not signed (SPEC-ELECTRON E0 is open: it needs a tester's PC); the browser mode stays the fallback.

## 14. Installation on a colleague's PC

A tester with a Windows PC, no admin rights and no developer tools gets a working Testimus in one
step, and is told exactly what is missing when something is.

- **What a PC needs**: Testimus with its own Node runtime, the Claude Code CLI signed in to the
  user's own subscription, the Jira/Xray credential files of §3, the embedding model files. Nothing else: no
  Python, no compiler, no global npm, no admin rights. The desktop app adds nothing to install: Electron's runtime
  ships in the release folder and the core keeps running on the release's own Node.
- **llama.cpp is not in the release.** When a GGUF model needs it, `models pullRuntime` downloads the official
  ggml-org build b12032 from GitHub (CUDA 13.4 + cudart when an NVIDIA driver ≥ 580 is there, else Vulkan when
  there is a GPU, else CPU: 165 + 424 MB, 38 MB or 25 MB zipped), checks each zip against the SHA-256 pinned in
  the code, extracts it in Node (no tool, no admin) into `<runtimes folder>/b12032-<backend>/`, and registers
  it in `models.json.llamacpp`. A folder that already holds `llama-server.exe` can be registered instead (its
  backend is read from its DLLs). **Ollama is never required**; when it is absent the Ollama panel and the doctor
  say « not installed » without an error.
- **One release folder**, built by `npm run release` and put where the team can reach it (§16):
  `testimus-<version>-win-x64/` = a portable Node 26, the core bundled into one file and the built
  UI (§1), the native parts beside them (`sqlite-vec`'s loadable extension, the ONNX runtime),
  `models/` (the default profiles of §5, so the first index needs no download), `install.ps1`.
  Bundling keeps the release to a few dozen files instead of a `node_modules` tree, which copies
  fast on Windows.
  - Native parts are pinned to versions that ship win-x64 prebuilds. A dependency that needs a
    compiler on the target PC is refused.
- **`install.ps1`**: per user, no admin, safe to rerun (rerunning a newer release = update, an older
  one = rollback).
  1. Copies the release to `%LOCALAPPDATA%\Testimus\<version>\`, makes it current, runs `Unblock-File` on the copy
     (a release copied from Teams carries the Mark of the Web), puts a `testimus.cmd` shim on the user PATH and adds
     two Start-menu shortcuts: « Testimus » runs `<version>\Testimus.exe` (the desktop app) and « Testimus
     (browser) » runs `testimus serve` and opens the browser. `-NoDesktop` keeps a single « Testimus » shortcut that
     runs `testimus serve`.
  2. If `claude` is not found, installs the Claude Code CLI with Anthropic's native installer, then
     asks the user to sign in once. The subscription is theirs; Testimus never handles it.
  3. Runs `testimus system setup`, then `testimus system doctor`.
  - Settings, credentials, downloaded models and projects live outside the versioned folder, so an
    update or a rollback touches none of them.
- **`system.setup`**: shows which of the two credential files of §3 exist and are complete (a
  colleague who already uses Xray Editor or the Atlassian skills has nothing to type), asks only for
  what is missing (Jira site, email, API token, Xray client id/secret), merges it into the files as
  §3 says, and checks it read-only (Jira `myself`, Xray authenticate). It is a command like any
  other: the UI shows it as its first-run screen, ported from Xray Editor's Settings credentials
  form.
- **`system.doctor`**: one line per check, each with what to do when it fails:
  - native modules load;
  - `claude` found, its version, signed in (a minimal `claude -p` run);
  - Jira and Xray reachable and authenticated (read-only);
  - the face (`face`: browser, or desktop <version>);
  - models: the models folder chosen with ≥ 3 GB free (`models.dir`); a model or the folder on the system drive
    with < 10 GB free is a warning (`models.system`); the active embedding and reranker installed and verified
    (`model.embedding`, `model.reranker`); they fit together (`model.fit`, « RAM too small » fails); a model
    partly on the processor is a warning (`model.offload`); the active vector space complete (`index.space`);
    Ollama's state (`ollama`: « not installed » is fine unless a model in use is served by Ollama); the llama.cpp
    build (`llamacpp`, required when a model in use runs on llama.cpp);
  - disk space for the index; the proxy in use (`proxy`: fails when loopback calls would go through it).

  The UI runs it at first start and whenever a Claude or Jira call fails. Xray Editor's "Claude not
  installed" panel (§11) becomes one of its rows.
- **Models** (§5 « Models on this PC »): the release's `models/` holds the Light pack (bge-m3 q8), so the first
  index needs no download; anything else is registered from a folder (`models add`, e.g. the team share) or
  downloaded into the folder the user chose (`models setDir`; never before that choice).
  `allowRemote: false` (`models.json`, or the old `settings.json` key) turns downloads off for PCs behind a
  proxy that blocks them. Settings: `settings.json.models.useOllama` (`auto` | `never`),
  `settings.json.rag.byProject` (this PC's choice per project), `settings.json.rag.budgets`,
  `settings.json.rag.dismissed`.
- Downloads and Jira calls go through the proxy in `HTTPS_PROXY`: the `testimus.cmd` shim and the desktop
  shell set `NODE_USE_ENV_PROXY=1` so Node's `fetch` honours it. Node 26 has no implicit loopback exemption: with
  `HTTP_PROXY` set, a call to llama-server, Ollama or the core on 127.0.0.1 would go to the proxy (passages and the
  `--api-key` with it). So both append `localhost,127.0.0.1,::1` to `NO_PROXY`, keeping the user's value. `serve`
  warns on stderr at start, and `doctor` shows which proxy is used and fails the `proxy` row (with the fix) when
  `NODE_USE_ENV_PROXY=1`, `HTTP_PROXY` is set and `NO_PROXY` lacks one of `localhost`, `127.0.0.1`, `::1`.
- As built (0.1.0, E4): the release is `Testimus.exe` and Electron 45.2.1's files, `resources/app.asar` (`main.mjs`,
  `preload.cjs`, `pages/`), `locales/` (`en-US`, `fr`), `node/node.exe`, `app/` (`testimus.mjs` bundle with the model
  catalog inlined, `ui/`, `templates/`, `node_modules/` holding only the externals: sqlite-vec, onnxruntime,
  transformers.js, sharp, pdfjs-dist), `models/` (Light pack: bge-m3 q8), `testimus.cmd`, `testimus.ico`,
  `install.ps1`, `README.txt` — 622 files, 1114 MB of which 564 MB is bge-m3 q8 and 309 MB the Electron shell (588
  files, 804 MB before the shell). `npm run release` downloads Electron's Windows x64 zip once into `.build/cache/`
  with Node's `fetch` and checks it against Electron's `SHASUMS256.txt` and the electron npm package's
  `checksums.json`; the build fails if the installed `electron` differs from the pin. `electron.exe` is renamed
  `Testimus.exe` with the Testimus icon and version info (`rcedit`). Fuses (runtime B): `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` off; `EnableCookieEncryption`,
  `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` on, with the hash of `app.asar`'s header embedded
  in the exe (resource `INTEGRITY/ELECTRONASAR`): a changed `app.asar` is refused at start. The packaged shell also
  refuses `--remote-debugging-port`/`--inspect`. Nothing is signed: SmartScreen may warn and AppLocker/WDAC may
  block `Testimus.exe`; the browser mode stays the fallback (README.txt says so). The install root holds
  `<version>/`, `current.txt`, `testimus.ico` and `bin/testimus.cmd` (which follows `current.txt`). `install.ps1`
  switches: `-Root`, `-InstallClaude`, `-NoPath`, `-NoShortcut`, `-NoDesktop`, `-ShortcutDir <dir>` (shortcuts in
  another folder than the Start menu, for trials), `-NoSetup`, `-NoPrompt`. `system.setup` reads the token and the
  secret from `TESTIMUS_JIRA_TOKEN` / `TESTIMUS_XRAY_SECRET` too, so they never appear on a command line.
  Model lookup order: the registered installations and the chosen models folder, then `TESTIMUS_MODELS`,
  `%LOCALAPPDATA%\Testimus\models\` (v1 downloads) and the release `models/`, read-only (transformers.js layout
  `<org>/<name>/`; GGUF files by their catalog path).
- **Proof**: before a release is handed out, it is installed on a clean Windows user account
  (Windows Sandbox): install, `doctor` green apart from the Claude sign-in, `project init`, index a
  sample docx, `serve`.
  Without Windows Sandbox (not enabled on the build PC: it needs admin), the proof installs into a fresh `-Root`
  with `-ShortcutDir`, `-NoPath` and `APPDATA` / `LOCALAPPDATA` pointed at a scratch folder, checks both shortcuts'
  targets, `testimus.cmd system version` and `system doctor`, starts the installed `Testimus.exe --mock` until the
  Documents screen, closes its window, and checks that no `node.exe` or `Testimus.exe` is left.

## 15. Verification bar

Done = `npm run build` clean, `npm test` (vitest) green, `npx playwright test` green against
`testimus serve --mock` (in-memory project + fixture Jira, like Xray Editor's browser-mock mode),
and for anything touching Claude or Jira, the read-only live check named in the change. A change to
packaging or install also passes the clean-account install of §14. A change to the desktop shell also passes
`npx playwright test tests/e2e/desktop` (Electron on the built shell with `--mock`) and leaves no `node.exe` or
`electron.exe` behind. A change to the release script also passes `tests/unit/release.test.ts` and, on a built release,
`tests/unit/release-desktop.test.ts` (layout, pinned Electron, fuses read from `Testimus.exe`, locales, `app.asar`
contents, integrity resource equal to the header hash).

The browser e2e cover Settings › Models (packs, plan then job, folded catalog, fit confirmation « GPU too small » with
Use anyway / Choose a lighter one, « RAM too small » refused, advice Apply / Dismiss, first-download folder dialog then
Change… Keep / Copy / Move, Ollama absent / stopped / running with a model partly on the processor), Settings › Search
(models in use and where the choice comes from, vector spaces, Drop, words-only then Reindex), Review « sources read /
related » and a quote not at its anchor, first launch's pack step, and Documents on a words-only index; each state is
captured light and dark in `tests/screens/`.

## 16. Open decisions

- UI language: English (like Xray Editor) or French (the testers)? Generated tests follow
  `project.json.language` either way.
- A sandbox Jira project for live write tests, or unit-tested writes only?
- Where the team's project folder lives (SharePoint sync, SVN, a share) — decides locking needs.
- Where the release folder lives (Teams/SharePoint, a network share) and who builds it; whether
  colleagues' PCs can reach Hugging Face and claude.ai through the company proxy. (unchecked)
- Review state in Jira: label (default) or a custom field?
- Requirement coverage (100 % of the `EXI_*`) is computed **outside** the app, from the `Exigence`
  field; a project skill may produce it. Not a screen of Testimus.
- Desktop app releases: Electron is pinned to one version (45.2.1 today) and supports only its last three
  majors, so a release is built **at least every 6 months** to stay on a patched Chromium. Who builds it is the
  release-folder question above. Signing (SPEC-ELECTRON E0) is checked on a tester's PC before the desktop app is
  handed out; until then the browser mode is the fallback.
- Requirement ids with a space (`EXI STB F-1`, Instructeur, Modèle train, SOSIE_c) cannot be `req:` anchors yet;
  proposed: anchor the id with its spaces written `_`, and read both forms in sources.
