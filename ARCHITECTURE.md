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
  logic. **A feature that exists only in the UI is a bug**: Claude loses the ability to do it. Held by tests:
  `tests/unit/guards/actionable.test.ts` drives every command through each face (every input field as a CLI flag, the
  MCP tool and the HTTP route reach the command; only `system.secrets` stays off MCP; the desktop bridge's calls are a
  fixed presentation list), and the scan guards keep the page and the shell from going around the registry (N1a–N1d:
  the page calls commands by literal name, through `lib/data` only, and the HTTP face serves no route of its own; N1e:
  a face imports from `src/core` the registry and its plumbing only; N1f: `src/desktop` never imports `src/core`).
- `ctx` carries the project folder, settings, an `AbortSignal`, progress (CLI prints, HTTP streams, MCP notifies), the
  activity tracker, `invoke` (another command of the same project; no command imports the registry), and `llm` (the
  call comes through the MCP face, from an LLM's run: what such a run takes from search is its declared line, below
  in §6). The registry's
  type `CommandMap` (name → input, output, job or not) is what the page imports — types only — so an unknown command
  name does not compile.
- **`src/core/env.ts` is the one seam**: `http`, home and data dirs, `spawnClaude`, `readMs` (a read held back on
  purpose: `TESTIMUS_MOCK_READ_MS`). Tests and `--mock` swap it.
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
  `work.ts`: cancellable `sleep`/`timeout`, `retry` (growing delay or `Retry-After`), `semaphore` (the six Jira calls,
  the conversion slots; waiters leave on cancel), `scope` (cleanups run last-in first-out whatever ends it), `every`, `debounce` (with
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
  Second pass (2026-11-08, a project of 600 tests, 20 documents — one of 1 500 sections, 1.1 MB — and 120 job logs of
  2 000 events; a Mac shared with other runs, so read the ratios, not the absolute figures):
  - A job's summary is read **from the end of its log** (64 KB, growing until its last status line is whole: the
    summary is that line and what follows it): the first jobs list 582 → 111 ms.
  - A document's fingerprint (all of `doc.md` hashed, against what the index last read) and its outline (headings and
    figures with their lines) are worked out once per version of their files (`lib/docs.ts` `contentOf`, `docShape`):
    `docs.list` warm 190 → 71 ms, `rag.status` 236 → 85 ms.
  - **`docs.show` answers a page**: about 60 000 characters of `doc.md` — or, with an anchor, of the part — from
    `from`, cut at a line, with `next` while it goes on (Claude reads on with `from`; an MCP answer of a whole 1.1 MB
    `doc.md`, or of a two-hour transcript's one section, was beyond what Claude takes). The toc and the figures the
    answer carries count in that budget (the text keeps at least a fifth of it); a later page carries only the
    sections and figures inside it. With an anchor, only those inside the part (a section's answer carried the whole
    1 500-entry toc); `whole: true` gives the part in one answer, for the page's reader (Documents › Text), never
    Claude. A toc longer than the budget still comes whole on the first page (open, §16). Every answer gives `lines`,
    `chars` and each toc entry's `line`, so the
    page draws where Claude read without the text. Brief 61 ms → 7 ms; a section 136 ms / 80 KB → 21 ms / 1.3 KB; the
    first page 1.14 MB → 158 KB.
  - Left as it is, measured: the first `tests.list` of the big project still parses 600 `test.md` (0.5–0.9 s, mostly
    the first disk reads); every later read only stats.
- **A job's `changed` comes from the watcher** when one follows the project (2026-11-08, `lib/changed.ts`): the
  watcher keeps a stamp of the project's files (size, mtime) up to date from the paths it reports — a folder renamed
  into place is walked, a path gone takes what it held — made once at the project's first job; each job running
  keeps what a path was before it first moved. At the end the job makes a fence folder `.testimus/fence-<id>` and waits
  for the watcher to report it (2 s at most): every write before it has been reported. A fence that does not come
  back, or a report without a name while the job ran (Windows' watch buffer overflowed: events were lost), makes the
  job walk the project once at its end and compare with the stamp — what was never reported is named all the same,
  and the stamp is right again (a loss with no job under way makes the next job stamp afresh). Without a watcher (CLI, MCP)
  the project is stamped before and after, as before. Stopping Testimus waits for a job that stopped but has not
  written its last status yet (it may be awaiting its fence). Same paths, added and removed as the walk
  (`tests/unit/core/jobs/changed-watched.test.ts`); the two walks of 1 100 files (~130 ms, synchronous) per job are
  gone — the job ends ~50 ms after its work, the event loop free meanwhile.
- **The core is the only writer of managed files** (`.remote.md`, `index/`, `.testimus/`). Claude edits `test.md`
  directly and the core re-reads it. Every file the app owns is written to `<file>.tmp` then renamed (`lib/atomic.ts`;
  folders through `<folder>.tmp`); a guard fails on any other `writeFileSync` in `src/core` outside the model files and
  the mock.

## 4. The project folder — files are the state

A project is **a folder that is also a Claude Code project**: open it in a terminal, run `claude`, and the same skills,
contexts and MCP tools are there. `project init` copies `templates/project/`; every Claude run first brings the
shipped skills up to the app's version (`lib/shipped.ts` `shipSkills`), so a skill change reaches existing projects
without a new `project init`. Shipping only goes forward, since colleagues on different versions share the folder:
`.testimus/shipped.json` holds, per file, the hashes of the versions shipped there in the order they were first written,
and `app`, the newest Testimus that shipped there. An app older than `app` touches no shipped file. Otherwise a skill at
a shipped version written before this app's is replaced; one at a version written after it (a newer build was here)
stays; one at no shipped version (the team edited it) stays and the new one lands beside it as `SKILL.new.md`. A
missing skill is added only if it was never shipped to the project — one shipped and now missing was deleted by the team
and stays deleted; an explicit `project init` brings it back. The folder can live anywhere and is
shared by sharing the folder. Every file is plain text a person can read and edit, owned by one module of the core.
JSON uses camelCase; `test.md` keeps Xray Editor's snake_case frontmatter. *Derived* files can be deleted and are
rebuilt; they are never hand-edited.

```
<project>/
  CLAUDE.md            project rules for Claude: Testimus' rules, which follow the app, then « Team notes », the
                         team's own (§11)
  .mcp.json            declares `testimus mcp` (rewritten by every run)
  .claude/skills/      shipped skills (generate-tests, plan-tests, check-test, analyze-test, fix-test, edit-test, ask-docs,
                         define-columns, study-document, draft-comment, overview-documents) + the team's own
  project.json         { name, jiraProject, jiraOffline?, language, labelPrefix, folders, rag: { reference?,
                         queryTask?, passageMaxChars?, retrieval?, claudeHeaders?, describeFigures? },
                         claude: { model, effort, presets, contexts, overview?: { enabled?, inEveryRun? } },
                         glossary? }
  columns.json         the step columns, in display order (below)
  xray.json            derived: Xray's step fields as Xray last gave them
  contexts/<id>/       context.md (frontmatter name, paths) + files/ — reference material attached to runs;
                         the shared library every project sees is <data dir>/contexts/<id>/ (an own id wins)
  docs/<docId>/        one document (§5)
  docs/OVERVIEW.md     how the documents fit together, written by Claude, the team's to edit (§5)
  tests/<id>/          test.md (§7), images/, local.json { contexts?, columns? } (the test's own settings, never
                         part of the test), .remote.md (derived: Jira's last copy), check.json (derived: last
                         check), analysis.json (managed: Claude's last analysis and what was decided, §9c),
                         .state.json (derived: { remoteChangedAt?, generatedPrint? })
  test-runs/<run>/     a test run (§9b): run.json (the tests frozen when it was made), results/<testId>.json (what
                         the tester found), results/<testId>/ (screenshots), images/<testId>/ (the tests' pictures)
  eval/behaviors.jsonl the project's retrieval benchmark set (§6)
  index/rag.db         derived: chunks, full text, vectors per space, graph, last index state; per machine, not shared
  .testimus/           derived, not shared: jobs/, runs/<runId>/ (run.json: who, what was sent, the snapshots;
                         mcp.json: the run's own MCP config, §11), gen/<generation>.json (ledger),
                         chats/, actions/, eval/ (reports), pages/, frames/ (media.frame), uploads/, migrations/
                         (what a migration changed), overview/last.json (the last update's before and after),
                         shipped.json (above), jira-project.json
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
  source.docx | source.pdf | source.txt | source.md
                             the original, copied in (never the SharePoint file itself); `twin` = the other rendering
  files/<name>               an images or video document's own files, copied in as they are (source.type images ·
                               video · mixed)
  doc.md                     derived: converted text with anchors (an images or video document: its verbatim lines)
  figures/fig-<n>.<ext>      derived: every picture of a Word or PDF document, in reading order
  figures/img-<n>.jpg        derived: image n normalised (jpg ≤ 2000 px, EXIF orientation); frame-<n>-<s>.jpg: a key
                               frame of video n at second s
  figures.json               [{ file, anchor, caption, description, labels?, kind? }] — fig:, img:, frame: entries;
                               description/labels/kind by Claude
  video/<n>.json             derived: video n — ffprobe's facts, Whisper's timed transcript, the candidate frames, and
                               Claude's chapters and key frames (kept, so a new reading gives the same anchors)
  video/<n>/                 derived: candidate frames, mosaics (rebuilt by docs.convert --force)
  doc.json                   { code, title, version, date, kind, status, amends?, contexts?, conversion?, source: {
                               type?, name, file, sha256, uploaded?, files?: [{ n, name, file, kind, sha256, figure?,
                               takenAt?, width?, height?, duration?, state }], last? }, twin?, reference?, relatesTo?,
                               converted?: { with, at, warnings, stats } }
  context.md                 what the team says about this document (read by every run)
```

- **Anchors are what sources point at, so they are stable across reconversion — never numbered by position.**
  Headings carry their section number (`## 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->`; unnumbered → slug of the title,
  duplicates `-2`); figures their caption number (`<!-- fig 40 -->`, `f<order>` without caption); PDF pages
  `<!-- page 59 -->`. A source writes them `§5.6.6`, `fig:40`, `page:59`. `rag/anchors.ts` is the one reader of anchors
  (it accepts « § 5.6 », « fig 40 », « t 04:30 »). A code the documents use (requirement id, alarm code) is text, not
  an anchor. An images or video document adds three kinds: `img:<n>` an image (`<!-- img 3 -->`), `t:mm:ss` a line of a
  video's transcript (`<!-- t 04:30 -->`, `h:mm:ss` past an hour, `-2` for a second line in the same second),
  `frame:mm:ss` a key frame (`<!-- frame 04:30 -->`); a video other than the document's file 1 prefixes its number
  (`t:3/04:30`). Decided: an image's anchor is its **number in the document**, given once when its file is copied
  (after `source.last`, the highest ever given) and never reused — so adding an image never moves another's anchor and
  a removed image's number never points at another picture (a file name is not stable enough: two cameras both write
  `IMG_0042.jpg`). Its file keeps its name under `files/`, else `<n>-<name>`, else `<n>-<k>-<name>` — never over a
  file there; a file from this PC is hashed and copied as it streams (a video passes 2 GiB, more than a Buffer holds).
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
  conversion.
- **Several conversions at once** (2026-11-08). Each conversion (`docs.convert`, `docs.add` with convert) is its own
  job and holds one of the project's conversion slots (`lib/docs-index.ts` `conversionSlot`, a `semaphore` of
  `src/shared/run/work.ts`) from its start to the end of its triage: the conversion (an images or video document's files too), the figure
  descriptions (so Claude's figure runs are bounded by the slots too, one run at a time per document), the re-check.
  The slots number `conversionsAtOnce()` (`lib/agents.ts`): the agents setting that bounds generation; adaptive, no
  more than the cores less one and the free memory (1 GB each) allow — counted when a batch starts, made again once
  the last batch is over. A conversion asked for meanwhile waits its turn (a `queue` step, « Waiting to convert » on
  the page); a failed one frees its slot and stops none of the others. Every conversion asked for, waiting or going,
  counts for the index: a conversion **asks** for its index run before it lets its slot go (it never waits for the run
  inside the slot, which would wait for itself), so the run starts once the last conversion of the batch is done and
  is shared by all — one index run for a folder import. The shared run has a signal of its own (`lib/docs-index.ts`):
  a conversion cancelled stops only its own wait; the run is cancelled once everyone waiting for it cancelled, or when
  its own `rag-index` job is cancelled. The Documents list shows « Converting · … » on each conversion
  going, « Waiting to convert » on those in line, and « Converting 2 at a time · 2 waiting · then one index run ». `docs.remove` deletes every trace (folder, index rows in every space, graph edges, others' `amends`);
  citing tests are left and their sources become `source-missing`.
- **A folder** (`lib/docs-folder.ts`): `docs.scanFolder` reads a folder (sub-folders by default, hidden ones and the
  project's own folder skipped, at most 2 000 files) and says, file by file, whether an import adds it: each `.docx`,
  `.pdf`, `.txt` or `.md` is a document, the `.pdf` of the same name beside a `.docx` is its rendering (its twin), each
  video is a document; the rest is left aside with a reason — not a document (Thumbs.db, desktop.ini, hidden or
  temporary files), Word's lock file (`~$…`), a kind not converted yet (`.doc`, HEIC, sound, spreadsheets…), empty,
  already in the project (same id or same file name), or the same id as another file found. The id is the code read
  from the name, accents and ligatures dropped (œ → oe), made a valid folder name. The project's own folder, or one inside it, is refused (paths compared without case on Windows
  and macOS); a file that goes while the folder is read is left out; past 2 000 files `truncated` says so, in the
  scan and in `docs.addFolder`'s result, with a warning in its log. `docs.addFolder` copies the
  documents asked for (the same `addDoc` as `docs.add`), then starts one `docs.convert` job per document, children of
  the import job, and waits for them (they share the slots and the one index run below). A network path
  (`\\server\share`) is refused (§13). Decided: a document already in the project is shown, unticked, never replaced —
  reconverting is `docs.convert`. Decided (2026-11-08): **the images of one folder are one images document**, named
  after that folder (`group` = the folder's path, « . » for the folder itself) — a team files a visit's photos in a
  folder of their own; a photo alone in a folder is a document of one image.
- **Amendments**: `doc.json.amends` lists what a document amends; the graph links it (document and section level), and
  an amendment wins over what it amends.
- **A document has a source type** (2026-11-08): `docx` · `pdf` · `txt` (a `.txt` or `.md`) — read from the copy's
  extension —, or `images` · `video` · `mixed` written in `doc.json.source.type`, for a document made of files of its
  own (`source.files`, copied under `files/`, `source.file` = `files`, `source.sha256` = the hash of their hashes). An
  image or several images form a document as sections form a text, and a video is itself a set of images: no picture
  is an attachment or an annex of another document any more. `docs.add` takes any of them; `docs.addFiles` makes one
  document of the images picked together (`images: together`, titled « Images <date> » unless given) or one each
  (`each`), one document per video and per text file; `media.add` / `media.remove` add or remove files of an images or
  video document (it becomes `mixed` when it holds both). `lib/media.ts` owns the files, `lib/media-md.ts` writes
  `doc.md`, `lib/media-pipeline.ts` converts.
- **A text file** (`rag/convert-text.ts`): UTF-8 (BOM dropped), else Windows-1252; a `.md` keeps its headings, each
  anchored by its number or its title's slug; a `.txt` is its text under one section titled by its file name (a line
  starting with `#` is escaped, `<!--` defused).
- **An images or video document's `doc.md` holds only what is verbatim**: each image's caption — its file name and
  when it was taken — on its own line (`![IMG_0042.jpg — 2026-10-12 14:03](figures/img-1.jpg) <!-- img 1 -->`), in the
  order the images were taken; each video under its own section (`## manoeuvre.mp4 · 02:40 <!-- § video-1 -->`) with
  each transcript line (`[04:30] … <!-- t 04:30 -->`) and its key frames in time order (`![Image at 04:30](…) <!--
  frame 04:30 -->`), all under the head section `§media`. What Claude read — an image's description, its visible text,
  a video's chapters — lives in `figures.json` and `video/<n>.json`: searched (§6), shown, never quotable, as for a
  figure. Only the caption and what was said are quotable.
- **Observed or reference.** An images or video document shows what the real system does, not what it must do: it is
  **observed** until the team marks it as the reference (`doc.json.reference`, `docs.set reference`, the page's
  « Reference, not observed » button; a written document is always a reference). A source from an observed document
  says *how* to do a step; an expected result backed only by observed documents is `observed-only` (mechanical check,
  §9). Marking or unmarking re-checks the citing tests. `docs.list` and `docs.show` say each document's `type` (docx ·
  pdf · txt · images · video · mixed) and whether it is `observed`: the page reads them, never the rules behind them.
- **Conversion of an images or video document** (`docs.convert`, `lib/media-pipeline.ts`, in a conversion slot like
  any other): each image not prepared yet is normalised (sharp: jpg ≤ 2000 px, EXIF orientation applied, the EXIF date
  kept as `takenAt`, a transparent PNG laid on white); each video goes through the steps below; Claude reads the
  pictures not read yet, **20 a run** (`claude/media.ts`, read-only, effort low — images and key frames alike: a
  description, every visible text verbatim, a kind); `doc.md` is written again. Each step is kept as it ends, so a
  conversion stopped half-way goes on where it stopped; `--force` starts over. A file that cannot be read is
  `failed` with its reason and the others go on; without Claude the pictures stay, unread.
- **A video, all on this PC** (`lib/media-video.ts`, `lib/video-io.ts`, `lib/video-frames.ts`): `ffprobe` (length,
  size, sound) → the sound at 16 kHz mono → **Whisper** (transformers.js, the catalog's `speech` entry, §6) → a timed
  transcript; candidate frames by `ffmpeg` (a scene change, else one every 5 s, 640 px), near-duplicates dropped by
  their difference hash (dHash, 64 bits, ≤ 6 bits apart = the same screen); **4 × 4 mosaics** of the candidates, each
  tile numbered with its moment (at most 12 mosaics, taken evenly along a long video), read by Claude in one survey
  run with the transcript → chapters and at most 40 moments worth seeing, one a second (a key frame is named by its
  whole second: two moments in the same second are the first; past the end is the end); each moment drawn in full
  (≤ 2000 px) as a key frame (`frame:`), then read with the images. Without Claude the key frames are 12 candidates
  taken evenly; without the speech model the video has no transcript (a warning says how to install it); without
  ffmpeg the video is kept unread (a warning). `media.transcript { doc, video?, from?, to? }` gives the timed lines and
  `media.frame { doc, at, video? }` draws any moment (`.testimus/frames/`, a cache): read commands, so every Claude run
  has them as MCP tools. `media.show` lists an images or video document's pictures, videos, chapters and key frames.
- **ffmpeg** (`lib/ffmpeg.ts`, `models.pullFfmpeg`): downloaded on demand like llama.cpp — gyan.dev's essentials build
  7.1.1 for win64, pinned by its SHA-256 in the code, into the runtimes folder, no admin rights; `ffmpeg.exe` and
  `ffprobe.exe` registered in `models.json`. Processes only through `src/shared/run/`. Decided: no pinned build for
  macOS or Linux (the release is win-x64), so there — development only — an `ffmpeg` and `ffprobe` found on the
  PATH are taken; `models.pullFfmpeg` says so instead of downloading.
- **How the documents fit together** (2026-11-08, `docs/OVERVIEW.md`, design wave C « Overview »). A page Claude
  writes on the project's documents: a `##` section per document (its heading ends `<!-- doc <docId> -->`, so the core
  knows whose it is), then the sections across them — the corpus, the links, the amendments, what contradicts — in the
  project's language, with `docId#anchor` references. Background, never a source. Its frontmatter is the core's:
  `updatedAt`, `updatedAfter` (« Import of « Traction » », « Conversion of 2 documents », « A rewrite from scratch »:
  the person's words), `kind` (`import` · `conversion` · `removal` · `rewrite` · `first`, what the page reads — absent
  after changes of several sorts and in a file written before it existed, which the page shows as « updated »),
  `basis` (per document, 12 hex of the SHA-256 of what the index compares — `doc.md`, what was read of its pictures,
  code and title — and of `version`, `date`, `kind`, `status`, `amends`, `relatesTo`, `reference`), and what the last
  update changed (`modified`, `added`, `removed`: section titles). The rest is plain markdown a person edits
  (`docs.overviewSave`, the page's Edit) — the next update merges into it. **Optional**: `project.json`
  `claude.overview { enabled, inEveryRun }`, both off when absent (decided: off by default — every import would
  otherwise cost a Claude run on a colleague's subscription; the team turns it on in Settings › Claude or on its page);
  off, the file is neither written nor given to a run, and what is in it stays.
  - **Written by Claude only in its own run** (`docs.overview { mode: auto | full }`, a job, skill
    `overview-documents`, `claude/overview.ts`): run kind `overview`, Edit/Write not refused on `docs/**` (every
    other kind keeps it refused) but on every document folder and other file of `docs/` by name, on `tests/**`,
    `eval/**` and on every other entry of the project root by name, as they are when it starts (a deny rule cannot
    except one file: this is the narrowest `--disallowedTools` allows; never `docs/*/**`, which Claude Code reads as
    covering `docs/OVERVIEW.md` too — the run of 2026-11-09 could not write it), read-only MCP tools;
    `docs.overview` and `docs.overviewSave` are off the `action` kind too. What a rule cannot close (a path created by the run, a name a rule cannot carry) is
    checked after it (`claude/overview-scope.ts`): the files of the root and of `docs/` and every `tests/<id>/test.md`
    are kept in memory before the run; a successful Edit/Write of the run's own calls on any path but
    `docs/OVERVIEW.md` fails the job (`overview-outside`, the paths named), what was kept is put back, a new entry
    removed, anything else named as left, and `docs/OVERVIEW.md` goes back to what it was (decided: a run that broke
    its scope keeps nothing — not a `.testimus/runs` snapshot, which would count a test the user edited meanwhile as
    the run's). Turned off while an update waited: *auto* ends with `ran: false`, no error; `docs.overview` asked
    while it is off is refused (`overview-off`). *auto*: the core compares `basis` with the documents now (added, converted again or
    changed in `doc.json`, removed) — nothing changed, no run; otherwise Claude gets the exact list, the card and
    outline (headings to level 2, the first 30) of each document added or converted — never the whole corpus — and is
    told to Read the file and Edit in place only those documents' sections and the cross sections they touch, keeping
    the rest word for word and merging into hand edits. After the run the core compares the sections: a document's
    section whose document did not change must come back identical (whitespace aside), an added document needs one, a
    removed one loses its own — anything else is a warning in the job and its result. *full* (Rewrite from scratch, or
    the first writing): Claude writes it whole from every document's card. Then the core rewrites the frontmatter
    (new `basis`, the sections changed) and keeps the text before and after in `.testimus/overview/last.json` (this
    PC's; « Show changes »), its `at` the very `updatedAt` it wrote: `docs.overviewShow` gives `last` only while the
    two are equal, so an update made since on another PC is never shown as this one's changes.
  - **After each import, one update per batch** (`lib/overview-after.ts`): `withIndex` asks for it once its index run
    ended (or failed) — and `docs.remove` too —, when the option is on and `claude --version` answers. The update is
    a job of its own, nobody's child (`jobs.ts outsideJobs`); the asks that come while it waits join it, so a folder
    of 10 documents (one index run) makes one update. The job waits for the project's conversions, its index run
    (`docs-index.ts indexWork`) and every `generate` job (`jobs.ts runningOf`) to end — never written under a
    generation reading it — then for the update before it, then for them again (one may have begun meanwhile). Never
    asked from inside a Claude run (`insideClaude()`, the MCP server a run calls, as `check.ts semanticPlan`). A
    one-shot CLI command that asked one waits for it before it exits, its progress on stderr (decided: waiting rather
    than not asking — `testimus docs add` leaves the overview up to date, as the app does; `lib/overview-after.ts
    overviewAsked`).
  - **Given to every run** while `inEveryRun` is on and the file is there (`lib/overview.ts overviewGiven`, the one test
    what goes with a run — `claude/given.ts`, §11 — and Settings › Context both use): one line of the block every
    prompt carries, « Read first — … docs/OVERVIEW.md — how the project's documents fit together », a pointer and not
    the text (decided: the soberest in tokens — the file grows with the corpus, Claude reads it once when the run
    needs it); not to the runs that only describe pictures or passages (figures, headers, media) nor to the
    overview's own run. It is a piece like the others (2026-11-10): the Context dialog of a Claude block shows it and
    a run may leave it out (`without: ["overview"]`). Settings › Context shows the file itself while it is given.
- **Migration of the media batches** (2026-11-08; the batches were built on 2026-11-05: `doc.json.media`,
  `media/<lot>/part.md` appended to `body.md`, anchors `§lot-<lot>.<item>` and `fig:lot-<lot>.<item>`).
  `lib/media-migrate.ts` turns each batch into an images document of its own: id `<parent>-<batch>`, title the
  batch's, kind `other`, its photos numbered in the order they were taken (`img:1`…), its pictures and what Claude read
  kept, its context its `context.md`, its `reference` kept, `relatesTo: [parent]` — a link, never an amendment (the
  photos were about that document; they amend nothing). The sources of the tests that cited the annex are rewritten
  mechanically, line by line (`<parent>#§lot-<batch>.<item>` and `fig:lot-…` → `<new>#img:<n>`, `§lot-<batch>` →
  `<new>#§media`, `@column` kept) with the quote found there — the picture's caption (`imageCaption`) for a photo, the
  batch's title for `§media` (the annex's own quote was its old caption or a description, not in the new doc.md) —,
  and their mechanical check is redone. The parent goes back to what it was before its first batch (`body.md` becomes
  `doc.md`, the batches' folders, pictures and figure entries go). It is idempotent and runs by itself once per
  project and process, before the first command that names the project (`commands/index.ts` → `migrateOnOpen`),
  writing its report to `.testimus/migrations/media-<time>.json`; `media.migrate --dryRun` says what it would do. One
  stopped half-way (a file held — `EBUSY` —, the process killed) is not marked done: the next command runs it again,
  and it takes the batch's document it already made (the folder without its doc.json yet, or the images document of
  the batch's title whose `relatesTo` names the parent) instead of making a second one.

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
  `docId#§x.y~n`, `docId#fig:N`. An images or video document adds one chunk per image (`docId#img:3`) and per key
  frame (`docId#frame:04:30`), built like a figure's, and its transcript cut into passages of whole lines under the
  same budget, each anchored by its first line (`docId#t:00:02`); its picture and transcript lines are never a
  section's text. Two chunks under one id (one anchor written twice in a doc.md) keep the first, with a warning: one
  document never stops the index of the project. **Every chunk has a `kind`**: `section` (a passage of text), `figure`, `image`, `transcript`,
  `frame` — what search filters by kind of passage (Settings › Search) reads; decided: text chunks keep the name
  `section` that the search filters already used. A context header per chunk: deterministic, or one sentence by Claude when
  `rag.claudeHeaders` is on (off by default: hundreds of runs on 900 pages; the indexer itself never calls Claude).
- **Hybrid search**: FTS5 BM25 + `sqlite-vec`, fused by reciprocal rank fusion; an optional reranker reorders the
  candidates. A reranker failure leaves the fused ranking, with a warning — never an error. When vectors are missing or
  the query cannot be embedded, search runs on BM25 alone: hits carry `degraded: true`, the reason is a warning, never
  an error, so Claude keeps working while vectors build. **The reranker is never in Claude's generation loop**:
  `rag.search` called through the MCP face (`ctx.llm`) runs without it, as `CLAUDE_SEARCH` declares — Claude reads the
  passages and judges better than any reranker; the reranker stays for people (Search everything, the command line).
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
- **A section without a number sits under the heading above it** (2026-11-10; `rag/chunk.ts` `parseSections`: the
  nearest heading above of a lower level). A specification written as requirements — `##### EXI_MOP_SPF_511_A_1660`
  under `#### 5.6.6 Sectionneur (S)`, 170 of the 287 headings of SOSIE D401-1 — had passages tied to nothing:
  `rag.related` on a requirement answered an empty list, the section filter left it out and the heading's title was
  indexed nowhere (a heading with no text of its own has no chunk). Now its path lists what holds it
  (`5 > 5.6 > 5.6.6 > exi-mop-spf-511-a-1660`), its header says so (`… — 5 > 5.6 > 5.6.6 Sectionneur (S) >
  EXI_MOP_SPF_511_A_1660`), the graph gives it that heading as `parent` and the other unnumbered sections of it as
  `sibling`, `expand` and the amendments of the sections above follow the path; a numbered section keeps the path of
  its number. Anchors do not change. Measured on that document (words only, 145 behaviors taken from the steps of
  generated tests and their sources, not validated — 16 passages cited in all, so a narrow set): `search` recall
  @10 0.917 before and after, MRR 0.694 → 0.686; `search+graph` 0.959 @10 both, 0.997 → 1.000 @50 — the gain is in
  what `rag.related` and the section filter answer, not in the ranking. An index written before the rule
  (`rag/db.ts` meta `chunk_rules`) forgets once which documents it saw: they say « not up to date » and are chunked
  again at the next index run, a passage that comes out the same keeping its vectors.
- **Passage cap**: `rag.passage` text is capped at `rag.passageMaxChars` (12 000); above it, whole lines around the
  quote (`around`), the table's header rows, an outline of sub-sections and a `readMore` line range of `doc.md`.
- **Claude also reads `doc.md` directly** (Grep/Read): the index finds, the file proves. The index is derived; nothing
  in it is the only copy of anything; sources point at `doc.md` anchors, never at chunks.
- **Retrieval settings** `project.json.rag.retrieval` (defaults `{ candidates: 50, rrfK: 60, bm25Weights: [1, 1, 5],
  rrfWeights: [1, 1], rerank: { top: 30, mode: "topk" }, expand: "none", typos: false, synonyms: [] }`; precedence
  defaults < active pack < project.json < run override). A rerank `threshold` belongs to one model id and is set by the
  benchmark. `rrfWeights` = [words, meaning] scale each list's share of the fusion; `bm25Weights[3]` is the French
  stems column (0 turns French forms off); `typos` and `synonyms` below. Every setting is shared with the team: none is
  this PC's (a rerank threshold is already keyed by model id, so a PC with another reranker never takes it).
- **Settings › Search** edits them as a **draft**: Ranking (candidates; « Words vs meaning » = `rrfWeights` [2, 1] ·
  [1, 1] · [1, 2]; « Weight of codes and ids » = codes column 1 · 5; reranker Top N / « Above its threshold », only
  when the models in use have a reranker; « Also bring » = `expand`; « Reset ranking » gives the ranking keys —
  candidates, rrfK, the word weights but the French forms column, rrfWeights, rerank, expand — back to defaults < pack,
  never the Words card's typos and synonyms; the raw numbers under Advanced) and Words (French forms, accents and case
  — always, the index folds them —, typos, synonym chips « a = b »). **Try it** runs `rag.search` with the draft as
  its `retrieval` override and `explain`; **Measure on the benchmark** runs `rag.measure` with it; **Save** sends
  `rag.setRetrieval` only the keys the draft changed from what is saved (`rerank` by its own keys) and, in `unset`, the
  keys Reset ranking gave back that project.json still holds; the core writes them over project.json rag.retrieval
  and keeps every other key — a page never rewrites the team's settings from this PC's pack (a colleague on another
  pack keeps what was set; a pack's later change still reaches a key the team never set). `retrieval: null` takes it
  all out. `rag.retrieval` reads defaults, pack, base, project, effective, the reranker in use and the glossary counts.
- **Filters** (`rag.search`, so Claude's `rag_search` too, and Try it): `docIds`, `kinds` (the chunk's `kind`: section ·
  figure · image · transcript · frame; an unknown one is refused, by its name), `section` (a section number: the section, its
  sub-sections and the figures inside them, by the chunk's path), `dateFrom` / `dateTo` (doc.json `date`, bounds
  included; narrows `docIds`). BM25 filters in SQL before its candidate cut (`search/filter.ts` `scopeSql`), vectors
  after the nearest neighbours (≤ 4096).
- **Synonyms** `rag.retrieval.synonyms` (groups `[["TK", "télécommande"]]`): any member found in the query (a word by
  its stems, an acronym as an acronym — the glossary's rule) adds the others, both ways, beside the documents' acronyms
  and `project.json.glossary`; `rag.mentions` expands with them too (`glossary.ts` `expansions`). They live in
  `rag.retrieval`, not in `glossary`, so Try it and `rag.eval --retrieval` try them before they are kept; the
  glossary stays the acronyms list (CLI `project set --glossary`), counted in Settings › Search.
- **Typos** (`search/typos.ts`): only a query word of 4 letters or more that the index does not hold (fts5vocab over
  header and text) also looks for the indexed words one letter away (changed, added, removed, two swapped), at most 3
  per word (most frequent first) and 6 words. A word the index holds is never second-guessed. No model: P1 holds.
- **Explain** (`rag.search --explain`, `search/explain.ts`): each hit's `why` — rank by words, rank by meaning (null
  when not found that way), the reranker's score, the query words found as written, French stems found, synonym and
  glossary forms (« TK → télécommande »), typo variants. Hits added by `expand` say so through `via`.
- **`rag.measure`** (job): `rag.eval` with the saved settings, `rag.eval` with the tried ones (`retrieval`), then
  `rag.compare` on `search` at k = 10 by default — the adopt rule's verdict, with the two reports kept in
  `.testimus/eval/`.

**Who uses what** (`models.usage`, the table « Who uses what on this PC » at the head of Settings › Search): every
user of the search declares, beside its own code, a `SearchUse` — who, when, words (BM25 and the document's structure)
always · builds · no, the active embedding uses · builds · no, the active reranker uses · no (with why). Today:
`CLAUDE_SEARCH` (`claude/access.ts`: Claude's runs through rag_search, rag_mentions, rag_related — words, the
embedding, never the reranker), `PALETTE_SEARCH` and `TESTS_SEARCH` (`search/all.ts`: Search everything reranks the
passages it finds, the tests list ranks tests by meaning alone), `DOCS_INDEX` (`rag/indexer.ts`), `TESTS_INDEX`
(`search/vectors.ts`), `COMMAND_SEARCH` (`commands/rag.ts`). `models.usage` gathers them and names the models each
really uses here (or none); another LLM's runs declare their line beside Claude's. **What is proposed for download is
only what the project's choice uses**: activation's `missing` names the models of the wanted choice (this PC's, else
the reference, else Light), never a fallback's; the system check asks for those (« Qwen3 Embedding 8B is not on this
PC: search uses BGE-M3 meanwhile ») and, with no project open, for nothing (the pack is chosen per project); the
first launch keeps this PC's choice picked. The cause of « the Quality pack proposes BGE-M3 »: a pack re-resolved at
each search could land on a variant not downloaded when other programs held GPU memory, activation then fell back to
Light and the page and the system check asked for Light's model — fixed by keeping the chosen variant (activation,
above) and by naming only the wanted choice's models.

**Vector spaces and which models a PC uses**:
- A space id = first 12 hex of the SHA-256 of its fingerprint: runtime · model identity (SHA-256 of the weights, never
  a path) · catalog id · pooling · normalize · instructions · dimension · max tokens · text recipe version. A moved
  model keeps its space; the device is not part of it.
- `rag.index` updates chunks, FTS and edges once, then embeds only what the **active** space lacks; a changed chunk
  makes the other spaces incomplete, and re-activating one embeds only the missing chunks. The last index state is in
  `rag.db` (meta `index_state`) and drives `docs.list.indexed` (`missing` / `stale` / `fresh`).
- **An index run's work in progress is not a problem.** While a run is under way or waiting its turn
  (`lib/docs-index.ts` knows: one queue per project, in this process), every document that is not fresh carries
  `docs.list.indexing` (`running` with its percent and passages embedded, or `waiting`) and `rag.status.indexing`
  sums the run (document n of m, passages done of total); the indexer keeps that tally as it goes
  (`rag/indexer.ts` `liveIndex`). Until the run ends, the page shows « Indexing · n % » / « Waiting to index » and the
  run's bar instead of any index warning (Not up to date, Not indexed, Search on words only, Words only, the space
  Incomplete), the system check skips the vectors row, and a search that falls back to words because the vectors are
  missing or incomplete logs it as info (any other cause — the model does not load, the query fails — stays a
  warning, said as it is). A
  warning comes back only if it is still true once the run ended. The page reads `docs.list` and `rag.status` again
  at each step of an index job (`lib/data/events.ts`, a read in flight is not restarted).
- Activation (`rag/activation.ts`): this PC's choice (`settings.json.rag.byProject[<real path>]`) > the team reference
  (`project.json.rag.reference`, a pack or a pair) > the Light pack. Only installed models are taken; none → lexical
  index only, saying why. A pack keeps the variant stored with the choice while its models are here and this PC can
  run it (not unsupported, not RAM too small): what other programs hold at the moment never switches the models in use.
  Else it takes the variant a fresh resolution picks when that one is here, else the first variant here that runs here
  — a variant to download never drops the project to Light while another one is on this PC. `missing` names only the
  models of the wanted choice that `resolveModel` does not find here.

**Models** (`models/catalog.json` + the user's entries in `models.json`):
- An entry names one exact quantization, its sources (Hugging Face repo at a pinned revision with every file's
  SHA-256), runtimes, dims, pooling, instructions, `dtypeByDevice`, `rerankerKind`, sizes, tier, `lighter`/`heavier`,
  `provenOn`. Licences that forbid commercial use are excluded. `kind` is `embedding`, `reranker` or `speech`: the
  speech entry (`whisper-small-q8`, `onnx-community/whisper-small` at a pinned revision, MIT, multilingual, encoder and
  merged decoder in 8 bits, 239 MB) transcribes a video's sound on this PC (§5); it belongs to no pack, is installed
  like any model (`models pull whisper-small-q8`) and is never downloaded by a conversion on its own (P6).
- **Packs** = a named intent each PC resolves for its hardware: Light (bge-m3 q8, CPU), Performance (Qwen3-Embedding
  0.6B), Balanced (4B + Qwen3-Reranker 0.6B), Quality (8B Q4_K_M + Reranker 4B …), plus Custom (hand-picked). A pack
  resolves to its first variant obtainable and fitting here (`resolveChoice`: `picked` first-fit · kept · fallback, and
  `aside` = each variant before it with its one reason — no runtime here, cannot be downloaded, the memory it needs
  against what this PC has, never run on this system, llama.cpp on the processor). Memory is judged with the models
  Testimus holds in llama.cpp given back (`releaseOurs`): using one choice unloads the others, so a model in use never
  makes a variant « too big ». **One place says what a pack is on this PC**: `packRows` (`lib/models-packs.ts`) gives,
  per pack, the variant in use (when the project uses it) or the one it resolves to, each model installed or not,
  `installed` all · some · none, `active` (search runs with it) and `chosen` (this PC's choice), and `notes` — one true
  sentence each, written by `lib/models-pack-notes.ts` (« Chosen here: … », « Variant « X » not chosen: <reason> »,
  « Fits this PC · 5.1 GB to download. », « Kept as the team reference; the Quality pack does not need it. »). The page
  draws them with one `PackCard` (Settings › Models and the first launch) and a closed vocabulary of badges; it decides
  nothing. The first launch keeps the pack this PC chose for the project picked; the core's `suggested` is only a badge
  until nothing is chosen. A unit test proves every pack resolves with transformers.js and llama.cpp alone, and
  Light/Performance with transformers.js alone; `tests/unit/core/models/pack-notes.test.ts` checks every sentence.
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

Search settings (R11, 2026-11-08, words only — `--mode bm25`, the P1 floor; no embedding model on the Mac that
measured): on the Syntec reference (`templates/reference/syntec`, 100 questions, validated), baseline `search` recall
0.880 @10, 0.940 @20, MRR 0.668 (`search+graph` 0.970 @10). **Typos on**: 0.870 @10 (−0.010, 95 % [−0.040, +0.020])
and MRR 0.647 — a question's words the articles never use pick up near words that are noise; not adopted, **`typos`
stays off** (available). **French forms off** (stems weight 0): 0.830 @10 (−0.050, [−0.100, 0.000]) — confirms the
stems column stays on. **Codes weight 1 instead of 5**: identical (Syntec has no codes). On the mock set (5
behaviors, provisional) every variant (typos, a synonym TK = télécommande, codes 1) gives 1.000 = the baseline
(saturated). `rrfWeights` (Words vs meaning) and the reranker settings were not measured here (no models on this PC):
their defaults stay [1, 1] and Top 30. Synonyms are project vocabulary, empty by default.

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
  `gen.tests --resume <generation>` writes what is left under the same generation. **The search is the plan's**: a
  planned run the plan gave its sections is told to read them in full and follow what they refer to, not to search
  the scope again (four planned runs searching one section again cost 4.7 M input tokens against 2.7 M, §16); a
  planned run given whole documents, and every unplanned run, keeps the line « Search before you design ».
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
- The skill ends with a fenced `gen-report` block `{ tests, skipped, covered? }` (`claude/gen-reply.ts`;
  `plan-tests`' `test-plan` block has the same `skipped`; `covered`, asked only of a run that adds to a generation,
  names the items left out before that it wrote a test for). The block is **read against a schema** (zod, `REPORT`,
  `PLAN`): a reply that carries none, or one that does not fit, is asked again once in the same session
  (`--resume`, the problems named field by field — `claude/parts.ts readBlock`, `askAgainLines`); still unreadable,
  the result says so (`reportFound: false`, `reportErrors`), the job logs an error and Generate shows it — what a run
  left without a test is never lost in a log. Every new test is stamped `review: draft` + `generated_by`, and checked
  at once. The run is snapshotted (revertable).
- **What a generation leaves without a test is said with its proof** (rethought on 2026-11-10; it replaced the free
  categories of 2026-11-08, which a benchmark showed drifting — the same nature under two wordings, the same item
  three times, an item another test of the plan took reported as left out). A behavior left out is coverage taken
  away, so it is told like a step: `{ item, reason, why, sources, searched, read, unblock, test }`. `reason` is a
  **closed list** (`SKIP_REASONS`): `no-source` (no passage states what the tester must see), `not-observable`,
  `already-tested` (with `test`), `out-of-scope`, `documents-disagree`, `missing-material` (what would state it is
  not in the project), plus the core's own `stopped` (a cancel or a failed run) and `other` (a ledger older than the
  list: its words are kept as its `category`). `why` is one or two concrete sentences; `sources` the passage that
  asks for it; `searched` and `read` what the run did before giving up; `unblock` what would let the test be
  written and who can bring it. The schema refuses an item without them (a `no-source` without a search said, an
  `already-tested` without its test). Then three things happen, none of them Claude's own word:
  1. **one list** — the plan and each run report on their own: `dedupeSkipped` keeps one of a behavior reported
     several times (same reason and the same words, or the same passage asking for it), and drops an item
     `already-tested` by a test of the generation itself; a planned run is told that what the other tests of the plan
     take is theirs and never reported;
  2. **doubts** (`skipDoubts`, no model) — a source that does not hold its quote at its anchor, a passage said read
     that the run's tool calls never opened, a run that gave up for want of a source without a single search, a test
     that does not exist: told beside the item, never removing it;
  3. **a second look** (`review`, below) — while the new tests are checked, Claude searches once more for each item
     and says `confirmed`, `writable` (with the passage, which Testimus checks like any source — it is `unsure`
     otherwise) or `unsure`.
  One grouping, the core's (`byCategory`: by reason, the largest group first); the page only cuts the list where the
  reason changes.
- **The test being written** (2026-11-08): a generation job's progress lines carry, when it moved, `gen: [{ id?, summary?, state:
  waiting | writing | written | missed }]` (`claude/gen-board.ts`), from the run's own tool calls — the test a run is on
  is `writing`, the one it left `written`, a planned test not started `waiting` with its plan summary, a planned run
  that wrote nothing `missed`. While the job runs, Generate draws each test as a folding card, read only
  (`WritingTests`, `WritingCard`): the page reads it with `tests.show`, read again whenever the watcher says its
  `test.md` changed — no other stream. The test Claude is on opens, folds when done; one opened or folded by hand stays
  so; « Fold all ». Only on Generate: Review and Tests show a generation's tests once it has ended.
- **Asking again after a generation** (2026-11-08): `gen.revise { generation, request, mode: change | add, tests? }`
  is a `generate` job under the same generation (`claude/gen-revise.ts`). *change* runs `edit-test` on the
  generation's tests (all, or the ones picked), checks the ones it changed (`revised` in the result) and keeps the
  generation's skipped items; *add* is a generation under the same id (`generateTests(…, into)`), told — in its own
  prompt lines (template `generate-add`), never as the user's note — the first request, the tests it already has and
  the items it could not write, writing those the request covers and naming them under `covered`. Its new tests are
  stamped with the generation and added to its ledger; the first request, the date, the plan and its `done` stay; the
  skipped items are merged (`mergeSkipped`: the earlier ones stay unless covered or reported again, the new reason
  replacing the old). Two *add* on one generation run one after the other (`perKey` in `src/shared/run/work.ts`), so
  neither loses the other's tests. Both modes run with the contexts the generation ran with (the ledger's
  `input.contexts`, recorded since 2026-11-08; an older ledger falls back to the project's default) unless given
  others. « Cover the skipped items » is an *add* (a quick ask may
  carry a scope: `ClaudeBlock` `quickAsks[].scope`). Both are snapshotted like any generation. `gen.show` reads a generation: its name, request, date, tests still there and
  skipped items. On Generate, once a generation is done, the left column is « Ask for changes » (`AskChanges`: the
  kit's `ClaudeBlock`: in its foot a Scope select — All N tests · The n with a fix · Pick tests… · New tests — then
  « Suggestions », a menu whose items write their prompt in the box, then model · effort; « Pick tests… » opens New
  run's picker on the generation's tests only (`PickTests`, `TestPicker only`, « With a fix » among its findings; a
  tree that is one folder chain shows its tests alone); « Read the request » opens the original request in a dialog);
  in every ClaudeBlock a chip is a value of a set (the contexts), never a choice of the run (decided on 2026-11-09); « New request » in the top bar brings the
  request form back, and a run keeps the column it was started from; until the project's last generation is known the
  column is a skeleton, so the form never shows and then flips. **The generation's Claude actions sit where they act**
  (`useGenFixes`, decided on 2026-11-09, canvas « Testimus — Generate, after a generation »): a fix proposed on a test
  is on that test's card in the result (its title, its problem in two lines, Fix runs it in the dock, × dismisses it;
  running and failed say so), the result's head counts them with « Show only these n »; beside the ask, « Claude
  proposes » counts them and lists what is proposed on the generation itself (the categories not written, Run).
- **What is said about a generation rides in the request that checks its tests** (`claude/gen-review.ts`, decided
  on 2026-11-10; it replaced the « what is next » run of 2026-11-09 and the core's « Write the N tests skipped for
  « category » » actions, which the benchmark showed proposing work nobody could do — five actions for items with no
  source, a design deliverable among them). The check request of `gen.tests` and `gen.revise` carries one more part,
  answered in a fenced `gen-review` block: the **second look** at each item left out (above; not for a revision) and
  **3 to 5 suggestions** (`{ label, prompt, scope?: "add" }`, never one that asks again for a behavior no passage
  supports), kept in the generation's ledger and shown as the « Suggestions » of Ask for changes. No run of its own:
  the check has just read the same passages. **Only what can be done leaves a Claude action**: a test with fixable
  findings gets one from its check (§9), and an item the second look found `writable` gets « Write the test left
  out: … » with the passage as the first step of its plan (`proposeWritable`, where `gen:<generation>`). A reason
  that holds leaves nothing to do; `stopped` is resumed, never acted on. Without Claude, or after a failed or
  cancelled generation, there is no second look and no action: the reasons are shown as the generation gave them,
  with their doubts. The part asks only for what it has matter for (`hasReview`): the suggestions need tests to speak
  of, the second look an item another look can settle — a request that added no test and left nothing of the kind
  sends no request at all. The request it quotes is the one just asked (an « add » or a « change » too), and **the
  check is given what the generation was given** (`checkTests { pick }`: its contexts, what it left out): tests written
  with a glossary are judged with it.
- **Evidence ledger** (`claude/ledger.ts`, `.testimus/gen/<generation>.json`): derived from the run's stream-json tool
  calls, never from the model's own report — what it opened (`rag_passage`, `rag_related`, `rag_figure`, `Read` ranges
  of `doc.md` mapped to sections, figure images) and what it searched. `gen.bench` scores agentic recall from it and a
  generation asked again reads it; nothing shows it any more (« Sources read » in Review and `review.evidence` were
  removed on 2026-11-09: the list was long, slow and unused).

## 9. Check, review, fix

- **Mechanical pass** (`lib/check.ts`, no model): steps exist; Action and Expected filled (`empty-field`); no `raw`
  embed Xray cannot show; no duplicate step; an expected result has a source; every source resolves (document by id or
  code, anchor exists) and its quote is found **at its anchor** (`§x` = the section with its sub-sections, `fig:N` = the
  caption paragraph only, `page:` = up to the next page, `img:N` = the image's caption, `t:mm:ss` = that transcript
  line, `frame:mm:ss` = the key frame's caption; whitespace-normalised, case-sensitive, `*` and comments ignored) →
  `quote-not-found`, `quote-not-at-anchor` (naming where it is — a picture or a transcript line first, the narrowest
  place), `quote-weak` (< 4 words or 20 chars, or found twice); Reference-source columns (`column-unsourced`,
  `item-not-found`); `figure-not-embedded`; `observed-only` (an expected result whose every source is in an images or
  video document not marked as the reference, §5).
- **Semantic pass** (`check-test` skill; rethought on 2026-11-10): `unsupported`, `contradicted`, smart column not
  as described, `wrong-object`, `negative-missing`, `case-missing`, `not-simulated-unsourced`, `vague-result`,
  `documents-conflict` (an amendment wins, a validated document wins over a draft), `figure-not-embedded`, `other`.
  A `fig:` source's image must be `Read` before it is accepted. `check.run` decides the semantic pass itself (Claude
  there or not); the page never does.
  - **One request checks up to four tests** (`CHECK_LIMITS`, `claude/parts.ts`): they share the passages they have
    in common and the turns it takes to open them. Each test is recorded on its own with `check_record`; a test the
    request did not record is asked again once, alone, and only then gets « The semantic check did not finish ».
    Measured on 2026-11-10 on four tests with six planted errors, Sonnet high and Opus high: the six errors found
    before and after, 1.6 M → 0.39 M and 2.4 M → 0.43 M input tokens.
  - **A verdict per step is the proof of the check** (`check_record { id, steps: [{ step, verdict, read, why? }],
    findings }`): `supported` (the passages opened state the expected result), `unsupported`, `unverified` (with
    why), and `read`, the `docId#anchor` opened to judge it. Called by a Claude run the command refuses a record
    that is not one (`check-incomplete`: a step without verdict, a judged step without a passage, a step called
    supported that an error of the same record disproves — `lib/check.ts verdictProblems`), saying what is missing, so
    Claude corrects it in the same run. The core then stamps each verdict `opened` from the run's own tool calls
    (`stampOpened`): a verdict naming passages the run never opened is shown as no proof. A test without finding
    still shows that every step was read against a passage, and which.
  - **A finding the documents settle carries its fix** (`fix`: what the step should say instead, from which
    passage; none when only the team can decide). The check proposes no action itself: after it, the core leaves
    **one Claude action per test** with fixable findings (`proposeFix`: the mechanical findings, whose message says
    what to write, and the semantic ones with a fix), its plan the fixes themselves. This is the one place a fix is
    proposed for a test — the check's own `actions_propose`, the « what is next » run and the core's fallback rule
    were three sources for the same thing.
- `check.json` `{ at, testHash, findings: [{ step?, kind, severity, message, sources, pass, fix? }], verdicts?: [{
  step, verdict, read, why?, opened? }] }`; stale when `testHash` moved. A document that changes re-runs the
  mechanical pass of the tests citing it (the verdicts stay while the test did not change).
- **Review**: **Validate** (`validated`) or **To fix** with a note (`to-fix`). `draft` → `checked` only after a
  successful semantic check. `review.fix { id, note }` = mark to-fix, run `fix-test`, re-check → `checked` (never
  straight to `validated`), with a run id for Revert. A push of a non-validated test asks for confirmation; on push the
  review state becomes a Jira label (`testimus-validated`…).

## 9c. Analyzing a test against the documents

Any test — written by hand, pulled from Jira or generated — can be read by Claude against the project's documents
(decided on 2026-11-09, canvas « Testimus — Analyze a test against the documents »). Unlike a fix, **Claude changes
nothing**: it records proposals and the team decides each one.

- `analysis.run { id, note?, model?, effort?, contexts? }` is a job (kind `analyze`, `claude/analyze.ts`, skill
  `analyze-test`, run kind `analyze`: the read tools plus `analysis.record`, no Edit/Write; an edit that got through is
  put back). The run calls `analysis_record` once; the job fails when it does not, and the previous analysis stays.
- `analysis.record` (Claude's call) is proven as a whole before anything is written: every source line is checked as
  the mechanical pass checks a step (`docId#anchor "quote"` found at its anchor, at least four words, `@<column>
  "<item>"` naming an item the cell holds), steps and columns exist, a new step has Action, Expected Result and a source
  for it. A call with any problem records nothing and lists them all, so Claude fixes them in one go.
- **Whose a column is** (the user's ask: requirements typed by hand are kept): Claude says per column `keep` (the
  team's: every item stays word for word; Claude links items to passages and may only add), `open` (may be reworded
  where a passage says otherwise) or `leave` (stays empty). The core holds two rules whatever Claude says: a Reference
  source column is `keep`, and a column with no description is `keep` where the test already holds text in it, else
  `leave`. A change to a `keep` column that drops or rewords an item is refused at record.
- Proposals: `source` (lines added to a step — backing its expected result or one item of a column), `change` (one
  cell's whole new text, with its sources; the core stores the cell as it was), `step` (a new step after a step, 0 =
  first), `remove`. Items no document holds are listed under `unfound` and stay as they are.
- `tests/<id>/analysis.json` (managed by `lib/analysis.ts` alone, shared with the test): `{ at, testHash, summary,
  columns: [{ name, role, why }], unfound: [{ step, column, item, why? }], steps: [{ id?, print, gone? }], proposals:
  [{ id: p1…, kind, title, why, step?, after?, column?, before?, value?, fields?, sources: ["<line>"], state: open |
  accepted | rejected, decidedBy?, decidedAt? }], run?: { runId, model, effort, note? } }`. A new analysis replaces it.
- **Where a proposal lands now**: a step is found again by its Xray id, else by its fields as analysed (`steps[].print`,
  the nearest when several match); accepting a change updates that print, a removal marks the step `gone`.
  `analysis.show` gives each open proposal its place now (`now`) or why it no longer applies (`stale`: the step changed
  or was removed, the cell changed since), and a step to remove the items of `keep` columns it takes out with it
  (`drops`, shown on its card: seen in the first real run, where Claude proposed removing a step that carried a
  requirement typed by hand). The test stays editable while Claude reads.
- `analysis.decide { id, proposals, decision: accept | reject | reopen }`: accept writes test.md at once, in the order
  given, refusing the whole call (code `stale`) when one no longer applies; an accepted proposal is an ordinary edit
  (undone in the editor, never « rejected »); the review state is untouched — the person accepted each change.
- The page (`screens/tests/analysis/`): « Analysis » in the editor's bar (the count left to decide) opens a pane beside
  the editor (`size.dock`, it gives way down to `size.sidebar`; the editor keeps `size.sidebar`). Before an analysis:
  the ClaudeBlock that starts one (an optional « look especially at » note, model, effort; while it runs the same box
  with its timer and Cancel). After: Claude's summary, To decide · Accepted · Rejected, the proposals grouped by the
  step they are about (the group's name scrolls the editor there), each a Card with its PROPOSAL badge, the change
  (SourceChips, TextDiff, the new step's columns), why, Reject and Accept; « Accept the n sources » in the foot; the
  items in no document (warning banner) and « How Claude read the columns » (COLUMN_ROLE badges). Accepting saves the
  editor's pending edit first and tells the editor the change is its own (`useTestDocument.expect`).

## 9b. Test runs (the testers' screen)

A **run** is a set of tests a tester plays on a version of the product, test by test: OK / NOK on each step, a
result, comments and questions. It is a folder of the project — files are the state, shared with the team like
`tests/` — and never `.testimus/runs/` (those are the snapshots of Claude runs, §11).

```
test-runs/<run>/            <run> = the slug of its name (« recette-j5-sectionneurs », -2 on a clash)
  run.json                  { name, createdAt, createdBy, importedAt?, tests: [{ id, key?,
                              folder?, summary, description?, preconditions, steps: [{ fields: { <column>: text },
                              images, sources? }] }]   (folder and the steps' sources — docId, anchor, quote,
                              column?, item? — as the test had them; a run made before 2026-11-08 has neither)
  images/<testId>/<file>    the run's copy of each picture a step shows (a field's ![](images/<file>) points here)
  results/<testId>.json     { status: not-run|passed|problem|blocked, steps: [{ ok: true|false|null, note? }],
                              blockedReason?, comments: [{ id, kind: comment|question, step?, text, by, at, answer?,
                              answeredBy?, answeredAt? }], attachments: [{ file, step? }], updatedAt, updatedBy,
                              history?: [older results an import replaced] }
  results/<testId>/         the screenshots (capture-<8hex>.<ext>)
```

- **Frozen**: `runs.create` copies each test as it is (its filled columns in `columns.json` order, its preconditions,
  copies of its pictures); a test edited or deleted later does not change what is run. A test is picked by its ids,
  a folder, labels or a review state (`dryRun` lists them first).
- **No result file = not run.** A result is read tolerantly (`normalResult`: one mark per frozen step whatever the
  file says, every field kept only with its type — a comment's `at` / `by` / `answer` strings, `kind` in its two
  values, `step` an integer within the test's steps, `history` normalized the same way) and written whole by
  `runs.setResult` / `runs.comment` / `runs.attach` / `runs.detach` (a screenshot off, with its file), stamped with
  the OS user and the time. A picture a step shows is
  the run's copy at `images/<testId>/<the file's own name>` (`src/shared/run-image.ts`, for the creation and the
  screen alike).
- **The result follows the marks** (one rule of the core, `marksStatus`; decided on 2026-11-09, it replaced « a
  recorded result is never replaced »): a write that changes a step's OK / NOK sets the result from the marks — a NOK
  is Problem, every step OK Passed, else Not run — whatever the result was, except Blocked (the tester's call, with
  its reason). A result the tester picks is written at once and stands until the marks change again; while it differs
  from the marks, `proposed` (`proposedStatus`, computed, never written, with `openQuestions`) says what the marks
  give, and the screen shows it beside the result. A note alone changes no result. The Run screen saves every pick
  at once (Blocked once its reason is said); its button only moves to the next test. The exported page keeps a copy
  of `marksStatus` in `run.js`, tested equal to the core's (`tests/unit/core/runs/page-script.test.ts`), and applies
  it the same way.
- Commands: group `runs` (`list`, `show`, `history`, `create`, `setResult`, `comment`, `attach`, `detach`, `remove`
  — asked first in the palette). `runs.history { test }` gives the test's result in every run that holds it (by id or
  Jira key), newest run first. The watcher reads `test-runs/` like the rest; `lib/data/refresh.ts` maps a path there
  to `runs.list`, that run's `runs.show` and `runs.history`.
- **Claude reads runs, never marks one**: `runs.list` / `runs.show` / `runs.history` are read-only (every run kind
  has them); the writes are off every Claude run (`action` included) and `test-runs/**` is refused to Edit/Write
  (`claude/access.ts`). The dock talks about a run through the scope `{ kind: "run", run, testId?, step? }`: a
  `claude.run` on it is a `chat` run (read-only tools), snapshots no test, locks no test (its lock is `run:<run>`),
  shows no revert card, and its prompt (`prompt.ts runPrompt`) says to change no file and to write a note, a comment,
  an answer or a bug out in the answer, for the tester to take.
- Screen `#/run` (rail item after Tests). **New run** is a name and the tests picked in the project's tree
  (`TestPicker`, the shared `CheckTree`): a folder ticks all its tests, a test is ticked alone, the filter bar
  (words, folder, labels, review state) narrows what the tree shows and what it hides stays picked; the run freezes them
  in the tree's order (`runs.create { tests }`; folder, labels and review stay inputs of the command for the CLI).
  **The runs**: the filter bar (words, state, who made it, what it has: problems, blocked tests, open questions), the
  sort in the list's head (last activity, name, least done, most problems), each run with its bar split by result;
  the list and the panel on the right are widened by dragging (`runListWidth`, `runSideWidth`, the same on a test
  being run); **a
  run**: its facts, a card of progress and a tile per result, the tests' table (tabs by result, words, a sort also by a
  column's head, by folder when the run kept folders), Continue = the next test not run; beside it **what the run
  found** (each NOK step with its note and screenshots, blocked tests, open questions — Claude drafts a bug, answers,
  summarizes). **`#/run/<run>/<test>` runs one test laid out like the Tests editor**: the run's tests on the left
  (the same filters and sort as the table: one view kept while the tester moves), the frozen test in the middle in the
  editor's step cards (`StepFrame`, stacked or Action | Expected — the editor's `stepLayout` pref; the frozen sources
  as the editor's chips — a requirement item under its column, the rest in a Sources row — each opening its passage),
  OK / NOK in each
  step's head, « Mark the n left OK », « Fold OK steps » (`runFoldOk` pref); on the right a testing panel: the test's
  screenshots, comments and questions, the same test in other runs (`runs.history`), and at its foot the result
  (set by the marks, or picked — saved at once) with Next test. A picture dropped on a step is that step's (a step not marked becomes
  NOK); dropped on the panel or pasted (Ctrl+V) it goes to the step being played. Keys O / N / J / K, Ctrl+Enter =
  next test (a note typed and a blocked reason are saved first). Status words: Passed · Problem · Blocked · Not run (`RUN_STATUS`, success / danger / warning /
  neutral), and In progress for a test not run whose steps are being marked. The rail item sits after Tests rather
  than straight after Review: the rail's order is the work's.
- **A run as pages, out of the app** (`lib/run-pages.ts`, template `templates/run-pages/`): `runs.export { run, dir }`
  writes a new or empty folder — `index.html` (one page: HTML, inline CSS, the run and its results embedded so it
  opens even from `file://`) and its classic script `run.js` (no network, no React), `run.json` (`format:
  testimus-run-pages/1`, `slug`, `exportedAt`, `exportedBy` + the frozen run), `results/` (unless `results: false`),
  `images/`, `serve.mjs` (Node only, no dependency), `start.cmd` (Node from the PATH, else the installed Testimus' own,
  else it opens the page alone) / `start.sh`, a README. Served, the page writes each change back to
  `results/<testId>.json` (and screenshots to `results/<testId>/`); without a server it keeps the results in the
  browser (localStorage) **but the screenshots only in the page's memory** (too big for it; the page says so, and asks
  before it is closed), and offers **Save run.json** — the run with a `results` map, screenshots inline as data URLs.
  When the browser refuses to keep them, the page says « Not kept — press Save run.json now ».
- `runs.import { dir | file, run?, dryRun }` (`lib/run-import.ts`) reads `run.json` (its inline results) and
  `results/*.json` (the newer of the two per test), plans first (new results, comments, questions, answers,
  screenshots, conflicts, tests whose number of steps changed), then writes. It refuses a `run.json` without the format
  `testimus-run-pages/1`, and pages whose `createdAt` is not the project's run of that name (another run with the same
  name: import them under a new name with `run`). A result touched on both sides with a different outcome is a
  conflict: **the newer `updatedAt` wins, the older goes to the result's `history`**; a version already in the history
  is settled and never comes back as a conflict. Comments merge by id (an answer given in the pages is kept),
  screenshots by name. A test with another number of steps in the pages keeps its marks here (a step's number no longer
  says which step it is; its comments lose their step), and the plan says so. What the pages hold came from another
  PC: results go through `normalResult`, and only plain files are read — never through a link, on the file or a
  folder above it. A run the project does not have is made from the pages' frozen tests and pictures;
  `run.json.importedAt` is stamped. The pages' server is shipped code, not `src/`: the « processes only in
  `src/shared/run/` » rule is about `src/`.

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
  never imports the registry). **A run is given the tools its job uses, not every read of the app** (2026-11-10):
  every tool's definition is sent with every turn, and 62 to 68 of them were 10 000 to 15 000 tokens a turn — for a
  run that only looks at pictures too. `READS` lists the read-only commands of each kind (figures, headers, media:
  none; check, analyze, generate, fix, run, columns, study, overview: the document and test reads their skill uses,
  17 to 26 tools; chat: a wide set, a question may be about anything; triage: all of them — a problem of the app may
  be anywhere), `EXTRA` what a kind answers with or may change (check `check_record`; analyze `analysis_record`;
  generation `tests_create/edit/save/addImage`, `check_run`; fix and `claude.run` `tests_edit/save/addImage`;
  triage and study `actions_propose`); `action` keeps the whole set minus another Claude run, Jira writes and the
  machine. A name in `READS` that is not a read-only command fails a test. Everything else goes to
  `--disallowedTools`, with `Edit`/`Write` refused on
  `docs/**`, `index/**`, `.testimus/**`, `contexts/**`, `.claude/**`, `project.json`, `xray.json`, `columns.json`,
  `.mcp.json`, `CLAUDE.md`, `test-runs/**`; the writes of `runs.*` are off every run kind, `action` included (§9b).
  The `overview` kind (§5) is the one run that may write a file under `docs/`, `docs/OVERVIEW.md`: instead of
  `docs/**`, every document folder and other file of `docs/` by name, plus `tests/**`, `eval/**` and every other entry of the
  project root by name (absolute rules, as the run starts; Claude Code honours the `Edit(…)` rules for every file
  tool, the `Write(…)` ones are kept for older versions); a write elsewhere that got through fails its job and is undone
  (`claude/overview-scope.ts`).
- **Snapshots and Revert** (`claude/snapshot.ts`): a run that may edit records `.testimus/runs/<runId>/run.json` (who,
  model, effort, job) and copies of what it may change (tests, and for actions project.json, xray.json and the document
  folder). Revert works from the run id, also after a restart, refuses when a test changed after the run
  (`edited-after-run`, unless `force`), never deletes a test the run did not write. Cancel kills the whole tree.
- **Chat** (`chat.ask`): a session per conversation (`--resume <session_id>`, `.testimus/chats/`), skill `ask-docs`,
  sources in the same `docId#anchor "quote"` form. « The documents do not say » only after `rag_mentions` and
  `rag_related`.
- **What goes with a run is decided in one place** (`claude/given.ts`, 2026-11-10; before, seventeen modules each
  built their own context lines with four inheritance rules, the overview was appended by the runner, and the check
  opened the contexts' folders without ever naming them). `given(project, kind, subject, pick)` gives the **pieces**
  of a run and the block every prompt carries after its instruction:
  - *the overview* (`docs/OVERVIEW.md`, a pointer) when it is given to the runs, not for the kinds overview, figures,
    headers, media;
  - *the saved contexts* by **one rule** (`attachedContexts`): a run reads the contexts of what it is about — a
    test's own list (`local.json`) or a document's own list (`doc.json`) when it has one, else the project's
    `claude.contexts`; several tests, each one's; the whole project, the defaults and every test's own list; ids
    whose folder is gone drop out; what the user picks for one run replaces it. Every kind of run goes by it — a
    question, a comment draft, the check and the overview get the project's defaults like the others. A context's
    notes of 4 000 characters or less are **said in full** in the prompt (no file to open); longer ones, its files and
    its outside paths are pointed at;
  - *what the team knows about the documents of the run* (`docs/<id>/context.md`): said in full for the documents
    the run is about — the ones a test cites, a generation's scope, the document of a document job — no longer left
    for Claude to go and read;
  - *the documents Claude may search*, for the kinds that search: listed, and one **can be left out of a run**. A
    document left out is closed for real, not asked politely: `Read(docs/<id>/**)` is denied, and the run starts
    with its own MCP config (`.testimus/runs/<runId>/mcp.json`) whose env names the documents, so `rag_search`,
    `rag_mentions`, `rag_related`, `rag_passage`, `rag_figure` and `docs_show` leave them out or refuse them
    (`doc-left-out`) for that run only;
  - *the user's note and the conversation*, said in full.
  Every command that starts a run takes `contexts` (the run's list) and `without` (`overview`, `context:<id>`,
  `doc:<id>`, `docnote:<id>`): a choice for this run only, never kept. The runner records what was sent with the
  run (`run.json` `sent: { chars, tools, given }`).
- **A request is shown before it is sent** (`claude.preview { use, scope?, docs?, sections?, contexts?, without?,
  generation?, note?, conversation? }`): the instruction (its template), the skill it names, the project rules, the
  tools of that kind of run, then the pieces of `given` — worked out by the function the run itself calls, so what is
  listed is what is sent. With `generation` (a request of « Ask for changes ») the contexts and the documents in scope
  are the ones that generation ran with, as `gen.revise` takes them from its ledger (§8). Each piece says how it
  reaches Claude (`inline`, `pointer`, `auto`: loaded by Claude Code,
  `search`), its size, why it is there, and whether the run can go without it (`locked`: the instruction, the skill,
  the rules, the tools, the user's own words). The Context button of every Claude block opens it (§12).
- **One request, several parts** (`claude/parts.ts`, 2026-11-10): a request carries as many parts as fit — four
  tests to check, and what to say about the generation they come from — and each part is answered on its own, through
  a command of the app (`check_record`, validated as it is called) or in a tagged block of the reply read against a
  schema (`readBlock`). What came back is kept; what did not is asked once more, alone (`askParts`); a part still
  unanswered is told to whoever asked. A request never fails whole because one of its parts did.
- **Claude actions** (`actions.*`, `.testimus/actions/`): proposals from the check, the generation and triage, and after
  a generation from its « what is next » run or the core's own rules (§8), shown beside the problem they fix; stale when the problem's place (`where`:
  `doc:`, `test:`, `job:`, `gen:<generation>` or `project`) changes; one open action per problem; dismissed stays
  dismissed. `actions.list { generation }` gives a generation's own and its tests'. A Claude action never starts
  `gen.revise`. `actions.run` refuses an action whose test, document, generation or job is gone (code `action-gone`,
  the fix says to dismiss it). Triage has two templates: a failed job's (`triage`) and a document's conversion
  problems' (`triage-doc`, with what the team knows about the document). **Who proposes** (2026-11-10): a run proposes
  with `actions_propose` only where it looked at a problem of the app's — triage, the conversion check, a question
  about a problem — by one rule said once (`ACTION_RULE`: what it looked at and can fix from the files, at most 3,
  never a choice of the team, a plan whose last step says how anyone will know it worked); a test's findings and a
  generation's items left out are never proposed by a run: the core builds those actions from the check (§9, §8).
  **An action is known to have worked by what is left** (`last.left { was, now, of }`): after a run on a test the
  test is checked again and its findings counted, after a run on a document its conversion warnings — counted by
  Testimus, never taken from Claude's reply.
- **The action file** `.testimus/actions/<act-id>.json`: `{ id, title, scope, where, problem, why, plan, stamp,
  proposedBy: { run, model, effort, at, runId? }, suggest?: { model, effort }, state: open | running | done |
  dismissed, at, last?: { runId, ok, summary, at, model, effort }, target?: { kind: project | document | test |
  generation | job, id } }`. **`target` is what the action works on** (2026-11-08), filled by the core when the action
  is proposed (`lib/actions.ts targetOf`: a `gen:` problem is its generation's, else the test or document of its scope,
  else the place of its problem, else the project); a file written before has none and is read the same way. Its name
  is never stored: `actions.list` adds `target.name` (`lib/names.ts`: the test's summary, the document's title — its
  code beside it —, the generation's request — its date beside it —, the job's label, the project's name), so a
  renamed test renames its group and no id reaches the page.
- **One order for every list of actions**, from the core (`sortActions`, the order `actions.list` returns): the
  target on screen first (`view: { kind, id }`: the dock passes the test in focus or the document open, Generate its
  generation), then project, documents, tests, generations, jobs; by name inside a kind; by date proposed inside a
  target. The page only cuts that list where the target changes (`lib/actions.ts groupByTarget`) under a head « Kind ·
  name » (`ActionGroup`: badge + name, one component for both) — the dock's Actions tab, Generate's suggestions. An action shown alone
  beside its problem (a conversion warning) says its target (« on document « Traction » »). Triage of a failed job is decided by the core (`actions.triageFailed`), once per job, only when Claude is
  there. Action runs are snapshotted.
- **What Claude is given is visible** (Settings › Context; `claude.prompts`, read only, readable by every run kind):
  the project's skills (`.claude/skills/*/SKILL.md`, the team's own too), every prompt Testimus builds, `CLAUDE.md`
  and the contexts attached by default, grouped by use, each with what sends it (screens and commands). **A built
  prompt is shown as its template, from the builder the run itself calls**: every module that runs `claude -p` exports
  `prompts` — its builder given the parts filled per run as `{placeholders}` — each with the **kind of run** that
  sends it, **what the run gives back** (`answers`) and, worked out from that kind, **what goes with it** (`takes`:
  the overview or not, the documents listed or not, the contexts' rule, the tools); `claude/catalog.ts` lists them,
  so the screen never shows a copy of the text. The block every prompt carries is one entry (`given`). A module that
  runs Claude without its entry fails `tests/unit/core/claude/catalog.test.ts`; so does a module outside `commands/`
  that runs Claude through another (`generateTests`, `runOnScope`, `triage`…) without `promptsUsed` naming the
  templates it causes, and a `claude.run` scope without its `ask-<kind>` template. The skills are shown after
  `shipSkills`, as the next run sends them; `prompts-sent.test.ts` keeps the exact text each run sends for one input
  (`prompts-sent/*.txt`, updated with `vitest -u` when a prompt changes on purpose). Decided: a skill takes the group
  and the « used by » of the built prompts that name it (« Use the X skill »); one no prompt names is a Team skill;
  each default context is its own entry (its `context.md`); the two sign-in probes (`claude.status`, the doctor) are
  listed too; `claude.run`'s run moved from its command to `claude/scoped.ts`.
- **Who says what, once** (2026-11-10, when every prompt, the eleven skills and the project `CLAUDE.md` were
  rewritten): the *prompt* holds what is this run's alone (the request, its scope, the columns, the shape of the
  answer); the *skill* how the job is done; `CLAUDE.md` what holds for every run and for a person in a terminal (what
  is in the folder, `test.md`, the sources, the columns). A rule lives in one of the three. `CLAUDE.md` went from
  15.8 to 8.4 thousand characters — it is read by every run — and `generate-tests` from 18.7 to 11. The skills tell
  Claude to send independent calls in the same turn: a turn costs the whole conversation again. A prompt names the
  project's language by its name (`claude/language.ts` `languageName`: « French », never « fr »), every prompt the
  same way.
- **The rules of `CLAUDE.md` follow the app** (`lib/shipped.ts`): everything above `## Team notes` is Testimus' and is
  brought up to the app's version at every run, like a skill; the team's notes below are kept as they are. Rules the
  team edited are kept and the new file is written beside (`CLAUDE.new.md`). A project made before this rule held no
  record of its file: the rules of every `CLAUDE.md` Testimus shipped are known by their hash (`RULES_BEFORE`), so an
  unedited one is recognised. Before, a project kept for ever the rules of the day it was made.
- **Prompts are measured, not believed** (2026-11-10): a change of prompt or skill is run for real on two
  configurations — Sonnet high and Opus high — before and after, on a copy of a project with a real specification:
  the check on tests with planted errors (how many are found, how many false alarms on right tests), a generation on
  one section (the tests, what is left out and whether each reason holds, the actions proposed), and the tokens of
  each. The figures of 2026-11-10 are in §16.
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
- **Files changed on disk are read again by the data layer alone** (`readAgain`, `lib/data/events.ts`, 2026-11-08):
  the reads a screen shows at once when idle, and a read **in flight is never dropped and started over** — it lands,
  then is marked stale once more for every burst that came meanwhile (it may have read the files before they moved),
  so it is read again at once if a screen still shows it, else when one does; the
  others are only marked stale. The shell's old « tests changed » signal on each burst (it drew the whole shell again
  and dropped the tests list in flight) is gone. Burst of 30 `test.md` writes, Tests open: `tests.list`
  asked 6 times, 3 of them dropped → asked 3 times, none dropped.
- **A running job's events reach the cache once per frame** (a timer stands in for frames in a hidden window, so the
  taskbar's progress still follows); a status is applied at once, after the events before it. 3 000 events streamed as
  fast as they come: the job's detail worked out 3 000 times (14.3 s) → 35 times (0.8 s). A detail read that lands
  while events wait for the frame already holds them: they are not added twice (`unseen`).
- **Sign of life**: a skeleton shimmers (still under `prefers-reduced-motion`); under the skeleton of a read the kit's
  `Loading` says after 1 s what loads, in the words of that read (`lib/data/loading.ts`, one vocabulary, never a
  screen's own text), and the seconds; from 10 s « Still loading… » and a neutral banner « Testimus is answering
  slowly. The page keeps waiting. » with Try again (the request under way is dropped, the read asked again). One line
  per read on the page. List `reading` puts it under a list's loading rows. An error stays the screen's danger banner.
- **One chunk per screen** (`app/Screens.tsx`, `React.lazy`): the page loads the shell and what it uses — React, the
  data layer, the kit the shell draws — in two files of 550 kB (was one of 1 456 kB, the kit catalogue's 433 kB
  included); a screen's own chunk (8–104 kB) comes the first time it shows, the empty pane meanwhile. Forcing the whole
  kit into the first files (a Rolldown chunk group) was measured at 880 kB and left out: a kit piece only screens use
  travels with them. Opening Tests on the big project: 1.49 MB of script → 0.37 MB, the list shown in 580 → 380 ms
  (warm), the longest task 90 ms → none over 50 ms.
- **One kit** (`src/ui/components/ui/`): one component per control, and every drawn piece of the design (Field,
  SaveState, Answer, Ask, Passage, Raw, Facts, Timer, Pane, Tile, Card, Badge vocabularies…). `Text` is every field
  (boxed, inline, bare, table cell) with its save state, Claude's lock and its autosave; `ClaudeBlock` (every place
  Claude is asked) is built on `Text`, and its « Context » button always comes from `components/claude/useRunContext`
  (2026-11-10; it replaced the « + » menu of saved contexts): it opens `ContextDialog`, which lists everything
  `claude.preview` says the run is given — what can be changed first (the saved contexts, the documents and what the
  team knows about them, the background, the user's words), what every run of the kind gets last (instruction, skill,
  rules, tools) — and reads the piece picked beside the list: why it is there, how it travels (said in full, pointed
  at, loaded by Claude Code, searched), its file and its text as Claude gets it; on top, the tokens Claude starts with
  and the documents it may search (2026-11-10: it replaced a graph of links to the request, which said nothing the
  list did not). A tick holds for this run only (`contexts` /
  `without` in the command's input); a locked piece is shown and cannot be unticked; the saved contexts are created,
  edited and deleted there, and the block's own text is saved as one (no second text box for a note; guard G3). The
  same dialog picks a kept list (a document's, a test's) in its `standing` mode. Nothing of the
  browser's own UI shows (a select's list is the kit's `Menu`, a
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
- **Layout**: a left rail of icons only (Documents · Generate · Review · Tests · Run · Jobs, then Settings, the system
  check and the version; each name in its tooltip and its accessible name, Review's count in a pill), the top bar, and
  each screen's **sections** (decided on 2026-11-09, canvas « Testimus — Sections et onglets »; it replaced the dock
  on the right, the drawers and the breakpoints each screen had of its own). A screen has 2 to 4 sections in columns,
  at most 2 per column one above the other; each section holds tabs; every content of a screen is a tab with its icon
  (required by its type: a collapsed section is read from its icons), its count or state dot, its content and its
  foot (48 px, at the bottom whatever scrolls above). A tab is dragged by its grip to another section (its tab bar,
  its middle, an edge that splits the column or opens one), sent with Alt Shift and an arrow or the section's menu;
  a section whose last tab leaves goes, and with 2 sections left a last tab cannot leave (the drop zone says why); a
  section folds to a strip of its tabs' icons (a column) or to its tab bar (a section of a split column). The edge
  between two columns (or two sections of a column) is a grip dragged freely: a column keeps 200 px at least (the
  work's 420), a section of a split column 120 px, and no ceiling but the room the others need; dragged 32 px past a
  least size, the section it would fold says « Release to collapse », and releasing there folds it (a column keeps the
  width it had for when it opens again); a narrow
  window folds the rightmost columns to their strip, the work's (the tab marked `main`, 420 px at least) and the one in
  use last, the one in use kept when both cannot fit. The
  top bar's « Sections » group counts them (3/4), adds a column (it arrives empty and offers the screen's tabs; Esc
  drops it), splits the section in use, resets the screen's own layout; Ctrl Shift B folds the section in use. A
  screen with one thing to show keeps 2 sections, the second collapsed. The model is `lib/workspace/` (pure
  `layout.ts`, `useWorkspace` keeping it per screen in lib/prefs `layout<Screen>`), the pieces are the kit's
  `components/ui/workspace/`. **Claude is a tab of every screen** (`useClaudeTab`): the shell keeps one dock (its
  conversation and runs survive a change of screen) and moves its element into the Claude tab of the screen shown;
  a request (Ask Claude, a run, the palette) shows that tab, Ctrl J shows it or folds it. **What a piece of the work
  opens to consult or decide beside it is a tab, never a pane inside the work's tab** (the test's analysis): the piece
  offers a side tab (`useSideTab`, its content drawn into it through a portal, so it stays the piece's) while it is
  open; it arrives in the section it was in last, else the nearest one right of the work, else a new column on the
  right (`layout.ts` `place`), shown, and goes when closed. A source opened anywhere (`openSource`) is read in the
  **Source tab** of the screen shown (`SourceTab`: the shell offers it to the screen's sections, `useBar`), in place of
  the screen's own Source tab when it has one (Review), closed when the screen changes; only a screen without
  sections shows it in a dialog. Setup and the kit catalogue
  have no sections. Minimum width 520 px. The project at the top of the rail opens a menu of the known projects (a quick switch) and one action, « All
  projects… », to First launch › Project — the one place that opens a folder, opens by Jira key, creates, hides,
  deletes or shows a project in Explorer; reached from the app (its route says so, `#/setup/project/app`: the project
  menu, the palette, an empty screen's « Open a project… »), opening one there goes back to the app; on the first
  launch it walks on to Search, even once a first project is open.
- **Navigation is the top bar's**: a screen that went down a level — a test being run (`Run › <run> › Test n of m`),
  a test edited in Review (`Review › <key> › Editing`), a document read from a test — puts the way back in the top bar,
  through `ScreenHeader`: an arrow before the title, then the trail, where a crumb that is a level is a link to it. The
  arrow alone when it goes up within the screen (its tooltip says where), with its words when it leaves the screen
  (« Back to LFRPS12-1420 »: the trail does not hold the place it goes to). A screen's panes, bars and banners hold no
  « Back »; a list beside a detail (Review's queue, Tests, Jobs, Settings) is a choice, not a level, and has none:
  it is a tab of its own section.
  Modals and First launch keep their own steps.
- **One filter bar** above a list that narrows (New run's tests, Review's queue, the runs —
  `components/filters/FilterBar`): words, then one menu per dimension (a quiet button with its name; ticked, pressed
  and saying what it keeps, « State: to fix »), its ticks counted with the other filters as they are, ticks adding up
  inside a menu and menus narrowing each other; « n of m shown » with Clear only while one is on. A dimension with a
  single value is not shown. The sort is the list's own, in its head. The page filters what it has read: Review reads
  the whole queue (draft and to-fix — validated tests are in Tests) and narrows it there, so it is read again only
  for another sort. Decided on 2026-11-09 (canvas « Testimus — Pickers and filter bars »): it replaced the
  segmented states, the pill toggles and « Only with findings ».
- **Names, never internal ids**: a label is what speaks to the user — a test's summary (its Jira key beside it in mono
  when it has one; a local test carries a « Local » badge), a document's title (and its code), the project's name, a
  context's or column's name; a missing one is « Untitled test / document / context », never the id
  (`src/ui/lib/labels.ts`: `testName`, `testLabel`, `testRef`, `contextLabel`, `nameTests` for a text that still
  names tests by id, such as Claude's own words, `useTestNames`). The core names what it reports (a job's label, a
  check's verdict, its messages: `src/core/lib/names.ts`) and the page shows that name; the page applies the test rule
  only to the tests it holds, and `tests/unit/ui/lib/names-parity.test.ts` keeps its copy equal to the core's (the page
  cannot import a value from the core). An id (job, `local-…`) stays visible only in a job's folded
  « Technical details », beside its name. `tests/e2e/ids.spec.ts` fails on a `local-<hex>` in any visible text.
- **Images and videos on the Documents screen** (2026-11-08, design wave C « Media »): a list row carries a type badge
  (Word · PDF · Text · Images · N · Video · mm:ss, a mixed document « Images · N · Video ») and an outline « Observed »
  badge for an observed images or video document. « Add documents… » takes Word, PDF, text, images and videos; two or
  more images added together ask « one document with the N images » (with its title) or « one per image » (a kit
  Modal); a single image or a video goes straight in. An images or video document opens on its **Images** tab (a grid
  of kit Cards: the picture, its anchor in mono, Claude's description; one opens large with its facts and « Remove
  from the document… »), a **Video** tab (the kit's `Video` player — HTML5 `<video>` through `/files` with Range, a
  `start`, a `seek` — with Claude's chapters and the timed transcript as kit Lists beside it: a click seeks, the line
  being said is the selected row; the key frames under it) and the Text tab; its head has « Add images… » (`media.add`)
  and « Reference, not observed » / « Observed, not the reference » (`docs.set reference`); the context stays in the
  side panel, which also lists `relatesTo` (About). A source `doc#t:04:30` or `#frame:04:30` opens the Video tab at that
  moment, `#img:3` that image large. « Observed » on a source chip is decided by its **document** (`useObserved()`
  reads the cached `docs.list`), never by its anchor. Generation chooses these documents like any other. An import of a
  folder shows the images of one folder as one row (« N images from <folder> »).
- **How the documents fit together on the Documents screen** (design wave C « Overview »): the list's first row
  (`~overview`, a route no document id can take; « By Claude », what it was last updated after), then the documents
  under a « Documents » group head; its page renders the text as React elements (headings, Claude's words with their
  source chips, in the reading face; never HTML), the Switch « Give it to every Claude run », Edit (the kit's Text,
  autosave against the file's mtime), Update now (Claude, violet), ⋯ › Rewrite from scratch… (a confirmation), a
  compact Claude banner saying what the last update changed with « Show changes » (the kit's new `TextDiff`, a line
  diff of before and after), the documents changed since. Settings › Claude has the two switches.
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
reads a path itself (opening one would send the user's NTLM hash), and by a command that walks a folder it is given
(`docs.scanFolder`, `docs.addFolder`), whichever face calls it (`src/shared/unc.ts`). `/files` serves only inside a known project, with a
sandboxing CSP, streamed; it answers one byte range (`Range: bytes=a-b`, `a-`, `-n` → 206 with `Content-Range`,
`Accept-Ranges: bytes` always, past the end → 416, a malformed range → the whole file) so the page's video player can
seek; the guard runs before it as for any request. The page's CSP: `default-src 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src
'self' 'unsafe-inline'; connect-src 'self'` — no inline script, no `eval`. `system.setCredentials` accepts only
`https://<tenant>.atlassian.net` and `*.getxray.app` unless `otherHost`. Scripts call the API by loading `/` first for
the cookie (`tests/e2e/helpers.ts`).

**The server of a run exported as pages** (`serve.mjs`, §9b) is another, smaller face, on a PC that may have no
Testimus: it listens on **127.0.0.1 only**; answers only a local `Host` (`127.0.0.1:<port>` or `localhost:<port>`: no
DNS rebinding) and refuses an `Origin` that is not its own; serves only files of its own folder (a path that climbs out,
a hidden file → 404); writes only with `PUT`, which a foreign page cannot send without a preflight it never gets, and
only `results/<testId>.json` (a JSON object, 2 MB at most) or a picture `results/<testId>/<name>.<png|jpg|gif|webp|bmp>`
(20 MB at most) for a test **of its run.json** — `run.json`, the page, the server itself and any other path are refused
(403), each write to `.tmp` then renamed. The page builds its DOM from text nodes (no `innerHTML`); the run embedded in
it has every `<` escaped. `runs.import` copies a screenshot only under a plain picture name, never a path, and only
from a plain file of the folder (`lstat`, real path checked): a link the pages carry is never followed.

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
- **Changelog**: `CHANGELOG.md` at the root is the one record of what each version changes for the team — `## <x.y.z>`
  (no date) then one short line per change, in French, newest first, `## Unreleased` on top. Each commit that changes
  what the team sees edits Unreleased (a Claude Code hook, `scripts/changelog-hook.ts`, stops a `git commit` without
  it unless the commit is only tests, docs or tooling, or says `[no changelog]`); a line about the same thing is
  rewritten, not doubled. `npm run publish` turns Unreleased into the version (refused when empty), and the
  release's `release.json` notes are those lines; the file ships as `app/CHANGELOG.md`. Settings › Changelog
  (`system.changelog`, plus `system.updates`' `newer`: the lines of the folder's newer releases) lists them newest
  first; the version in the rail and in Settings opens it, and the « available » toast links there instead of
  quoting notes.
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
- A document whose outline alone is longer than an answer of `docs.show` (≈ 2 000 headings) still gets it whole on
  the first page and with `brief`: paging the toc too waits for a real document that needs it.
- Requirement coverage is computed **outside** the app, from the step column the team fills with requirement ids.
- Not proven yet: signing and execution policy on a tester's PC (E0); live read-only checks of `xray.pull` and of the
  `issue` reads on the Windows PC; whether a custom field is cleared with `""` or `null`; the benchmark's gold set
  (bootstrap by Claude, to be validated by the testers — every figure above is provisional); measuring Performance,
  Balanced and Quality on the reference document (`node scripts/refdoc.ts`); the `observed` colour token for images
  and videos. **Images and videos as documents, not proven on Windows** (built on a Mac, 2026-11-08): the pinned
  ffmpeg win64 build was downloaded and its SHA-256 pinned, but never run on a Windows PC; the real pipeline (ffprobe,
  the sound, scene detection, a frame at a moment) was run with the Mac's ffmpeg 7.1.1 on the fixture video; Whisper
  (`whisper-small-q8` through transformers.js) was never run — its file list and hashes come from Hugging Face's API,
  and the French quality of the small model on a real PCC recording is unmeasured; the mosaics' tile labels need a
  font for librsvg (the prompt lists every tile's moment anyway); HEVC `.mov` from an iPhone may not play in the
  page's player (Chromium has no HEVC on Windows without the system codec).
- **The prompts of 2026-11-10, measured** (§11 « Prompts are measured »; real `claude -p` runs on a copy of a
  project holding the specification `SOSIE_211_D401-1_3`, « before » = the code and prompts of the commit before the
  rework, one run per cell, so a figure is an order of magnitude, not a mean):

  | Check of 4 tests, 6 planted errors | Sonnet high before | after | Opus high before | after |
  |---|---|---|---|---|
  | Planted errors found | 6 | 6 | 6 | 6 |
  | Findings on the 2 right tests | 1 warning | 1 warning | 3 warnings | 2 warnings |
  | Requests / tool calls | 4 / 41 | 1 / 21 | 4 / 56 | 1 / 23 |
  | Input tokens | 1.60 M | 0.39 M | 2.36 M | 0.43 M |
  | Wall time | 32 s | 58 s | 53 s | 81 s |

  | Generation, « L'objet Sectionneur (S) de l'image Traction », §5.6.6 | Sonnet high before | after | Opus high before | after |
  |---|---|---|---|---|
  | Tests written (steps) | 2 (12) | 3 (23) | 2 (25) | 3 (29) |
  | Findings of the check on them | 0 | 1 warning | 0 | 1 warning |
  | Passages opened | 31 | 30 | 96 | 70 |
  | Items left without a test | 6, one free category | 7, each a reason with its evidence | 11 with duplicates, 5 free categories | 6 |
  | Second look at them | none | 6 confirmed, 1 unsure | none | 5 confirmed, 1 unsure |
  | Actions proposed | 1 generic | 0 | 5 generic | 1 (« Fix 1 warning in … ») |
  | Runs / tool calls | 4 / 51 | 5 / 103 | 6 / 163 | 6 / 180 |
  | Input tokens, all runs | 1.83 M | 2.67 M | 7.72 M | 5.90 M |
  | Wall time | 115 s | 229 s | 331 s | 324 s |

  Read: the check finds the same errors for a quarter to a sixth of the tokens (one request for four tests, 17 tools
  described instead of 62), and takes longer on the clock since nothing runs side by side any more. The generation
  now writes one test per type of the object (the specification gives three types, each with its own menu) where it
  wrote two; what it leaves out has no duplicate and no free category, and no action is proposed for an item no
  document can decide. Sonnet spends more in all (2.67 M against 1.83 M) for nearly twice the steps — 116 k tokens a
  step against 152 k; Opus spends a quarter less for more steps. Two things are **not measured**: the Opus « after »
  column was run before the last change (a planned run reads the sections of its plan instead of searching the scope
  again — on Sonnet that change took the same request from 4.68 M to 2.67 M), and the quality of the tests was judged
  by reading them (Claude, the session that wrote the prompts), not by a tester on the simulator. A first « after »
  version without the search line wrote a single test and opened 2 passages on Sonnet: the line « Search before you
  design » stays in the unplanned prompt for that reason.
- Test runs as pages (§9b) were designed from the description of the team's interactive test sheet
  (`D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\skills\testing\`: HTML + `data.json`, OK / NOK per line) and the
  design, on a Mac where that sheet is not: **the port was not compared with the original**. Not proven either:
  `start.cmd` on a colleague's Windows PC (Node from the installed Testimus, `start ""` opening the browser), a browser
  that blocks `localStorage` on `file://`. Answering a tester's question happens in the Run screen only, not in Review
  yet, and Claude does not draft answers there.
- The job fence (§3) relies on the watcher reporting a project's paths in the order they were written: true of
  Windows' and macOS' recursive watch; on Linux, where Node watches each folder apart, a write reported after the
  fence would be missed by that job's `changed` (the watcher's own event still reaches the page). Measured on macOS
  only; the Windows PC is to check. The first `tests.list` of a big project (600 `test.md` parsed) is left synchronous.
