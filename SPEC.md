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
| A skill + Python script imports the CSV into Xray | Review happens in Jira, after import | Tests are written locally, reviewed, then pushed |
| Testers reread, fix, add screenshots in Jira | Slow, no trace of what was checked against what | Check skills flag anomalies per test; the review view shows test, anomalies and source passage side by side |
| Xray Editor (BHP) for local editing | Three fixed step fields | Every Xray step field, custom ones included, with per-project folding |

## 1. Stack (decided — reopen only with a reason written here)

- **One TypeScript code base on Node 26 LTS** (LTS since 2026-10-28, supported to 2029-04; the
  release ships its own copy, §14, so colleagues' PCs need no Node). The **core** runs in Node; the
  UI is React 19 + Vite 8, no UI library. Two of Xray Editor's « no » were reopened by the v3 cleanup (2026-11-03):
  - **StyleX** (`@stylexjs/stylex` + `@stylexjs/unplugin`, pinned) for every style: the design tokens are
    `src/ui/styles/tokens.stylex.ts` (`defineVars`, a dark scheme by media query, `createTheme` light/dark set on `<html>`
    from `data-theme`), a component's styles live in its `.tsx` (`stylex.create`), so a deleted component takes its styles
    with it and an unknown token breaks `tsc`. Reason: fifteen hand-written sheets had drifted (1 839 sizes in px, rules of
    one area patching another's components). Compiled at build time by Vite (dev with HMR and readable class names, vitest
    compiles too); no runtime injection, no CSS file but the fonts, no raw HTML.
  - **TanStack Query v5** (`@tanstack/react-query`, pinned) is the one data layer of the UI (`src/ui/lib/data/`): a cache
    per command and input, deduplication, cancel, invalidation from the event stream, optimistic updates with rollback,
    the autosave as a mutation, server reachability. Reason: that work was written by hand in 58 effects, 4 window
    events, 12 module stores and 3 autosave timers.
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
- Fonts (Inter, Source Serif 4, JetBrains Mono) come from `@fontsource-variable/*` and are bundled into
  the UI: the app works offline and behind a proxy that blocks Google Fonts.
  - **Biome** 2: lint and format in one tool, one config, run by `npm run check`. (Oxfmt is faster
    but still beta.)
- Considered and left out, so nobody adds them by reflex: React Compiler (the UI is small and ported
  code already memoizes where it matters), a UI kit, Radix/MUI or Tailwind (the kit is ours, built on the design system;
  a headless primitive is allowed for one component only if accessibility demands it, with the reason written here),
  Storybook (the component catalogue is the app's own `#/kit` screen), **Effect** (typed errors, concurrency, resources:
  it would help with cancel, timeouts, retries and guaranteed cleanup, but it does not cover the worst risk — the parent
  process killed, handled by `--exit-with-stdin` and `taskkill /T` —, would duplicate zod, the contract of the three faces,
  and would mix two paradigms; that code lives instead in one layer of ours, `src/shared/run/` (§2). Reopen Effect for that
  layer if it grows past about 500 lines, or if a cancel or cleanup defect comes back),
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
  HTTP streams it, MCP sends notifications), the activity tracker, and `invoke` — another command of the registry in
  the same project (`gen.bench` runs `gen.tests` and `claude.revert` so; no command imports the registry). The
  registry's type (`CommandMap`: each name → its input, its output, whether it answers with a job id) is what the page
  imports, types only: a command name the registry does not know does not compile.
- **The page has one data layer** (`src/ui/lib/data/`, TanStack Query): a read is cached under
  `[project, command, input]` (the machine's own reads under `null`), kept until an event says it changed — the
  `changed` paths and the job events of the one `/api/events` stream map to the reads they touch (a job event also
  updates `jobs.list` and `jobs.show` in place; the stream follows the open project only, so moving to another project
  drops the reads of the one left, and a project one comes back to is read again; a job is followed in the project it
  was started in); a plan (`xray.plan`, `models.planPack`, `models.planDir`, any dry run)
  is never cached; an action is a mutation that reads again what it touched; an autosaved field is a mutation too
  (400 ms after the last key or on blur, one save in flight per document, `ifMtime` → `conflict` shown, a draft kept
  while it fails; « Reload from disk » makes the version read again the base of the next save; a save goes to the
  project of its key, even when it leaves after the window moved to another; a command that reads an autosaved file
  sends its pending save first and is refused, saying why, while that edit cannot be written — a conflict or a
  refused save). Nothing else in the page fetches, opens a stream or touches browser storage (`lib/prefs.ts` holds
  the presentation preferences).
- **One place for processes, cancels and resources** (`src/shared/run/`, Node only, so the desktop shell imports it too):
  `work.ts` — cancellable `sleep` and `timeout`, `retry` with a growing delay or the server's `Retry-After`, `semaphore`
  (the six Jira calls) whose waiters leave on a cancel, `scope` whose cleanups run last-in first-out whatever ends it
  (result, error, cancel, time out), `every`, `debounce`; `process.ts` — start a program directly or through a `.cmd` shim
  (the metacharacter refusal), the registry of live children, killing **the whole tree** (`taskkill /T /F` on Windows; off
  Windows each child leads its own process group, killed with the descendants `ps` knows), stdout and stderr line by line,
  timeout and cancel, every child killed when the parent goes (`--exit-with-stdin`, signals, exit). Nothing else in `src/`
  spawns, kills or waits (a guard test, §15).
- **Events name their project.** Every event of `/api/events` carries `project` (null: the machine's own work, a model
  download); a page follows only its own project. Besides the job events, a recursive watcher per project in use emits one
  `changed` event per burst of writes (200 ms), naming the paths — an edit, a save, Claude Code in a terminal, a sync —, the
  project's `CLAUDE.md` included, its index and the app's bookkeeping under `.testimus/` left out (but proposed actions). A
  `UserError` may carry a stable `code` a page branches on; `conflict` (the file moved on disk since it was read) is HTTP 409.
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
  415); `/api` (the command list) and `/api/events` (the event stream) answer `GET` only (405 otherwise); only `GET /api/system/version` is public (start-up probes), and it ignores any project the request
  names. The guard runs before anything else: a request it refuses touches no file. The project a request
  names (`?project=`, or the `X-Testimus-Project` header, URI-encoded — a malformed one is a 400) is then
  matched as a string (resolved, case-insensitive on Windows) against the known projects (the open one or
  `settings.projects`) before anything touches the disk, and only the matching known entry is opened; an
  unknown one is a 403. A request that names none gets the open one, or none once its folder is gone. A UNC or device path (`\\host\…`, `//host/…`, `\\?\…`, `\\.\…`) is refused wherever
  the HTTP face reads a path itself (the project selector, `/files/<path>`): opening one would make Windows
  sign in to that host with the user's NTLM hash. Paths inside a command's JSON input are the command's
  business (e.g. `models add` from the team share). `/files` serves only inside a known project, with a
  sandboxing Content-Security-Policy. The UI page itself (`index.html`) is served with
  `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self'
  'unsafe-inline'; connect-src 'self'` in both the browser and the desktop app: no inline script (the theme is
  applied before the first paint by `/theme.js`), no `eval`, images from the project or `https:` (step images that
  live in Jira), nothing fetched from another origin. Claude is
  spawned without a shell when it resolves to an `.exe`; through a `.cmd` shim no argument may carry a cmd
  metacharacter. `system.set` keeps a `claude.exe`/`.cmd` path as typed (the status then says it does not run) but refuses one holding a cmd metacharacter;
  `system.setCredentials` accepts only `https://<tenant>.atlassian.net` and `*.getxray.app` unless `otherHost`.
- `serve` flags for a parent process (the desktop shell, §13), none of them a command: `--port 0` lets
  the OS pick a free port, and the guard checks the port actually bound; `--port-fallback` takes a free port when
  the one asked for is taken or reserved (EADDRINUSE, EACCES); `--ready-json` prints, once
  listening, one line `{"ready":true,"url":"http://127.0.0.1:<port>/","pid":…,"version":…}` and nothing
  else ever goes to stdout (errors before it go to stderr with a non-zero exit); `--exit-with-stdin`
  stops the core when its stdin closes. `testimus mcp` always ends when its stdin closes (Claude, its parent, is gone) or on a stop signal, killing every program it started and stopping its model servers first. `TESTIMUS_SHELL=<face>/<version>` (set by the shell) names the
  face in `system.version` (`shell`) and in the doctor (« desktop 0.2.0 », else « browser »).
- The core is the only writer of the project folder's managed files (`.remote.md`, `index/`,
  `.testimus/`). Claude edits `test.md` files directly (§11) and the core re-reads them.

## 3. The project folder

A project is **a folder that is also a Claude Code project**: open it in a terminal, run `claude`,
and the same skills, contexts and MCP tools are there. `testimus project init <dir>` copies
`templates/project/` into it. The folder can live anywhere (local disk, SharePoint sync, SVN) and is
shared by sharing the folder.

**Files are the state.** Every file below is plain text a person can read and edit, with one module of the
core that reads and writes it (nobody else opens it). The JSON files use camelCase keys; `test.md` keeps Xray
Editor's snake_case frontmatter. A file the app derives (marked *derived*) can be deleted and is rebuilt; it is
never edited by hand.

```
<project>/
  CLAUDE.md                 project rules for Claude (from the template, then the team's)
  .mcp.json                 declares `testimus mcp` — Claude reaches every command (rewritten by every run)
  .claude/skills/           the shipped skills (generate-tests, plan-tests, check-test, fix-test, edit-test,
                              ask-docs, define-columns, study-document) + the team's own
  project.json              { name, jiraProject, jiraOffline?, language, labelPrefix, folders,
                              rag: { reference?, queryTask?, passageMaxChars?, retrieval?, claudeHeaders?,
                              describeFigures? }, claude: { model, effort, presets, contexts }, glossary? }
  columns.json              the team's step columns, in display order (below)
  xray.json                 derived: { fetchedAt, fields: [{ id, name, type, builtin, required?, disabled? }] } —
                              Xray's step fields as Xray last gave them (§10)
  contexts/<id>/            context.md (frontmatter `name:`, `paths:` as a list, then the notes as body) and
                              files/ — reference material attached to runs (Xray Editor §7). `paths` are folders
                              or files outside the project, each passed as --add-dir. The project's own; the
                              shared library every project sees is <data dir>/contexts/<id>/ (same layout; an
                              own id wins)
  docs/<docId>/             one document (§4)
  tests/<id>/               test.md (§6), images/, and beside it:
                              local.json  { contexts?, columns? } — the test's own settings: its FULL context
                                          list ([] = none, absent = the project's claude.contexts) and how its
                                          columns fold ({ <column>: open|filled|collapsed }); not part of
                                          test.md, so it never makes a test modified; it moves with the folder
                                          on push-rename. Left empty, the file goes
                              .remote.md  derived: test.md as Jira last sent it (§10)
                              check.json  derived: the last check (§8)
                              .state.json derived: { remoteChangedAt?, generatedPrint? } (§6)
  eval/behaviors.jsonl      the project's retrieval benchmark set (SPEC-RAG §10)
  index/rag.db              derived: chunks, full text, vectors per space, graph, and the state of the last
                              index run (meta `index_state`); rebuilt by `rag.index`, not shared
  .testimus/                derived, not shared: jobs/<id>.jsonl, runs/<runId>/run.json (+ before/, §11),
                              gen/<generation>.json (§7), chats/, actions/, eval/ (reports), pages/, uploads/,
                              shipped.json (the template files shipped, §11), jira-project.json (cache)
```

`columns.json` is a list, one entry per column, in the order the editor shows them:
`[{ name, id?, description?, mode: "open"|"filled"|"collapsed"|"hidden", referenceSource? }]`. An entry with
`id` follows that Xray step field (a field renamed in Xray keeps its entry); one without `id`, or whose field
Xray no longer has, is a **local column** — kept in `test.md`, never pushed. `description` is what Claude writes
in the column (empty: Claude leaves it empty; absent: never described — a custom field new from Xray says so);
the built-ins have a default description. `mode` is how the column shows in every test (§10). An Xray field no
entry names comes after the entries, with its defaults (`filled` for Data and for a field switched off in Xray,
`open` otherwise). `columns.save`, `columns.setModes`, `columns.order` and `columns.remove` write it, each time
the whole list as it is shown; reading Xray again makes it follow Xray (§10).

Global settings (`<data dir>/settings.json`, `%APPDATA%\Testimus` on Windows): `{ projects, lastProject,
claude: { exe }, models: { allowRemote }, agents?, ui?, rag? }` — known project folders, last project, the
`claude.exe` to run, whether models may be downloaded (the one place that says it), how many Claude runs at the
same time, the page's `testimus.*` preferences mirrored (`ui`), the model choice of this PC per project
(`rag.byProject`). `<data dir>/models.json` holds the models folder, the installations and the team's own
catalog entries.

**Credentials** are Xray Editor's, in the same files (its SPEC §2, `src/lib/jira.ts`), shared with the
user's Atlassian skills (`xray-find`, `atlassian-import`, `comment-task`…): one set per user, read in
place, never copied into a project or into Testimus' settings.

- `%USERPROFILE%\.atlassian\credentials.json` — `{ "baseUrl": "https://<tenant>.atlassian.net[/wiki]",
  "email", "token" }` (`/wiki` only when the user typed it, or already there — Xray Editor's rule). Jira base =
  `baseUrl` without its `/wiki` suffix; auth = HTTP Basic
  `email:token`.
- `%USERPROFILE%\.atlassian\xray_credentials.json` — `{ "clientId", "clientSecret", "apiBase"? }`
  (`apiBase` defaults to `https://xray.cloud.getxray.app`). Auth = `POST {apiBase}/api/v2/authenticate`
  → a JWT, kept in memory, renewed on 401.
- Read tolerantly: a UTF-8 BOM is stripped, unknown keys are ignored.
- Written only by `system.setCredentials`, by **merging** into what is there: unknown keys (`accountId`,
  `apiBase`) and the `/wiki` suffix survive, because other tools need them (Xray Editor's
  `saveCreds`).
- An error names the file to fix (`Jira 401 — check ~/.atlassian/credentials.json`); a secret is
  never logged, never put in a job log, a prompt or a `claude -p` argument.

## 4. Documents

```
docs/<docId>/
  source.docx | source.pdf  the original, copied in (never the SharePoint file itself); both when the other
                              rendering is kept beside it (`twin`)
  doc.md                    derived: converted text with anchors
  figures/fig-<n>.<ext>     derived: every picture, in reading order
  figures.json              [{ file, anchor, caption, description, labels?, kind? }] — description, labels and
                              kind written by Claude
  doc.json                  below
  context.md                what the team says about this document (free text, read by every run)
```

- `doc.json` — the folder name is the document id, so the file does not repeat it. What the team decides sits
  apart from what the conversion found:
  `{ code, title, version, date, kind: "spec"|"minutes"|"other", status: "draft"|"submitted"|"validated",
  amends?: [docId], contexts?: [contextId], conversion?: { from?, reader?, numbers?, notes? },
  source: { name, file, sha256, uploaded? }, twin?: { file, sha256 },
  converted?: { with, at, warnings, stats?: { sections, figures, chars } } }`.
  `status` is what the team decides, not what the file says: the UI edits it (`docs.set`, with `amends`, the title,
  the contexts and `context.md`). `contexts` are the saved contexts Claude reads with this document (absent: the
  project's defaults). `conversion` is how the document is converted, chosen by the study (`study-document`) or
  the team, kept so every reconversion gives the same result. `source.name` is where the original came from — its
  path on this PC, or the uploaded file's name with `uploaded: true`; `source.file` is the copy in the folder;
  `twin` is the other original beside it (the `.pdf` of a `.docx`, or the reverse). `converted` is absent until the
  first conversion (`docs.add` with `convert: false` copies only); its `warnings` are the known losses.
- Figure descriptions: Claude `Read`s each picture and returns `{ description, labels, kind }` — `description` one
  or two sentences in the project's language, `labels` every text visible in the picture copied verbatim (titles,
  buttons, menu items, fields, legends, symbol names; at most 100; `[]` when none), `kind` one of `screen | diagram |
  symbol | table-image | photo`. A later reply with a description only keeps the labels and kind already there.
  `figures.json` is written after every batch of 20, so a run cut short keeps what is done. The caption is the only
  quotable text of a figure: a `fig:N` citation is checked against the caption paragraph in `doc.md`, never against
  `figures.json` (description and labels are Claude's reading).
- Adding and converting: `docs.add` adds one document (a path or an upload, with its `.pdf` rendering, and the
  conversion options); `docs.addFiles` adds the files dropped or picked together — a `.docx` and the `.pdf` of the
  same name become one document, a `.pdf` alone is one, anything else is refused (`code: not-a-document`), each is
  only copied. `docs.convert` (and `docs.add` when it converts) is one job: the copy is converted (with `study`,
  Claude studies it first and checks it after), Claude describes the figures, the tests citing it are re-checked,
  Claude looks at the conversion warnings (`triage`, skipped when Claude is not installed on this PC) and, with
  `index`, the search index is updated in a child job once the other conversions of the project are done (one
  index run at a time; a run asked for meanwhile waits and the requests made while it waits share it). A failed
  index run keeps the conversion and says why (`index.error`).
- `docs.list.indexed` follows the rule of `rag.status`: `missing` until an index run read the document, `stale`
  when its text changed since or the active model's vectors are incomplete, `fresh` otherwise.
- `context.md` is saved with the version it was read at: `docs.show` gives `contextMtime`, `docs.set { context,
  ifMtime }` refuses with `code: conflict` when the file changed on disk since.
- `docs.remove <id>` deletes every trace of a document: its folder (copies, doc.md, figures, context), its rows in
  `index/rag.db` (chunks, full-text rows, vectors in every space — a complete space stays complete — graph
  edges and its entry in the index state), and the other documents' `amends` naming it. Tests citing it are left as
  they are; the check reports their sources as missing.
- **Conversion prefers `.docx`** (structure and images intact); PDF is the fallback. A `.pdf` added while the
  `.docx` of the same name sits beside it converts the `.docx`, the `.pdf` kept as its twin to lend its pictures;
  `docs.add --pdf` keeps both; `docs.convert --pdf` or `--docx` adds the other rendering later.
- **Anchors** are what sources point at, so they must be stable across reconversion — never numbered by position:
  - every heading carries its section number as anchor: `## 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->`;
  - figures: `![Figure 40 – Représentation graphique sectionneur](figures/fig-40.png) <!-- fig 40 -->`;
  - a PDF page break: `<!-- page 59 -->` (absent for docx, which has no reliable pages).

  A source writes them `§5.6.6`, `fig:40`, `page:59` (§6). A code the documents use (a requirement number, an
  alarm code) is no anchor: it is text, found by search and `rag_mentions`, and a column that holds such codes is
  a smart column like any other (§6, §8).
- Known losses, reported in `converted.warnings` instead of hidden: Word comments, shapes drawn in
  Word (only their labels survive), `.emf`/`.wmf` (kept as they are: converting them needs native
  tools that §14 rules out).
- Fixed while building (2026-11, proven on SOSIE_211_D401-1_3 01.01: 116 sections, 21 figures, identical anchors
  on reconversion):
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
    dropped; a tagged PDF can be read through its structure (`conversion.reader: "tagged"`). RATP PDFs draw
    heading numbers as pictures, so always prefer the .docx (or give the study the numbers it saw).
  - Amendments: an amendment document lists what it amends in `doc.json.amends` (`docs.set`). The graph links it
    to what it amends (`amends` edges, document and section level), so search, `rag_related` and the skills find
    the amendment next to the text it changes; an amendment wins over what it amends.

## 5. Index (RAG)

RAG v2 (built from SPEC-RAG.md, 2026-11). Principles kept from it: completeness never depends on the embedding
model (structural and lexical tools give the same evidence on every PC; embeddings and rerankers only rank);
extraction is done once; an index holds several vector spaces; models are data; everything runs on this PC; the
user decides where big files go; a model or setting becomes a default only by winning the benchmark. Ollama is not
used: GGUF models run on llama.cpp, which Testimus downloads itself (same files as Ollama's `qwen3-embedding` tags).

- **Chunking follows the document**: one chunk per lowest-level section, split further only above
  ~800 tokens, never across a heading. Each chunk keeps `{ docId, anchor, path: "5 > 5.6 > 5.6.6",
  figureIds[], kind, text }` (`kind` `section` or `figure`) and a context header (deterministic, or one sentence written by Claude
  when `rag.claudeHeaders` is on — Anthropic's contextual retrieval).
- **Figures are chunks too**: caption + Claude's description + one line `Visible text: <label> · <label> …`,
  pointing at the image file, so a search can return a picture (a button label or a symbol name finds its screenshot
  by BM25 as well as by vectors) and a generated step can embed it. A caption pasted without its picture is
  still a figure (no file; its caption is the « Figure N – … » text of its paragraph).
- **Hybrid search**: SQLite FTS5 (BM25 — exact codes, device names, French stems) +
  `sqlite-vec` (semantic recall), merged by reciprocal rank fusion; an optional reranker reorders the
  fused candidates. A reranker that fails (server down, out of memory, any error) leaves the fused ranking as it
  is, with a warning logged — never an error; when it answers, nothing changes. At this scale (≈ 2,000 chunks for the RATP corpus) `sqlite-vec`'s exhaustive search
  answers in milliseconds; one file holds text, FTS5, graph and vectors, no server.
- **Lexical search in French**. `chunks_fts` has four columns: `header`, `text`, `codes` (`fig N` of
  each figure the chunk holds, the section number) tokenized by unicode61 without diacritics — the exact forms — and `stem`, the
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
  - `rag.mentions <term>` returns **every** passage of every document (`docIds` to narrow) that contains the term: the exact phrase (case and accents ignored,
    whole words only, so an id never matches a longer id; an acronym of one or two letters keeps its case), its
    French stems (not for a code or an all-capital acronym; stop words skipped), and its glossary expansions both
    ways — or a JavaScript regex (`regex`, case-insensitive). A section's title (also of a section with no text of its
    own — only sub-sections), its text, and a figure's caption and description are searched. Hits are grouped by
    document (most hits first) and section (document order), with `count` and one line of context per hit (at most
    10 per section). Paginated by sections (`page`, `pageSize` ≤ 200), never a top-k; `forms` lists what was
    searched. Measured on the 22 J5 documents: « sectionneur » 81 hits in 31 sections of 6 documents, « DSO » (+
    « Départ Sur Ordre ») 277 hits in 94 sections of 9 documents, 0.7 s from the CLI; « DSO » in SOSIE_4111_D401-1: 21 hits, the title of
    § 3.15 included.
  - `rag.related <ref> [--depth 2]` returns the graph neighbours of `docId#anchor` (`§x.y`, `fig:N`; the anchor is
    read as people write it: « § 5.6 », « fig 40 », a chunk part `~2` dropped — `rag/anchors.ts`, the one reader of
    anchors) or of a bare `docId`, each with its kind, direction (`out` = ref → neighbour), title (section title or
    caption), path and depth: cross-references both ways, parent and children, siblings (each once), figures, and the
    amending documents — the document itself and the amending sections that name this section or one of its
    ancestors; amending documents come first. Depth 2 adds the neighbours of the neighbours once (siblings are not
    expanded), up to 200 neighbours in all (every depth-1 neighbour is kept): beyond that, `truncated: true` and
    `total`. An unknown document or anchor is an error.
  - `rag.search` `expand` (default `project.json.rag.retrieval.expand`, else `none`): `section` adds, after the k
    hits, the parent section of a section hit and the section a figure sits in; `graph` also adds the sections each
    section hit cross-references or amends.
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
  dimension · max input tokens · text recipe version. The model identity is the SHA-256 of its weights — the GGUF file or the ONNX weight file(s) of the entry's
  dtype — never a path, so a moved model keeps its space; the device is not part of it.
  - `rag.index` updates chunks, FTS and edges once, then embeds only what the **active** space lacks. One index run
    at a time per `rag.db`: a second `rag.index` (or a conversion's index step) waits for the running one. `--force`
    chunks every document again (each chunk asks for its header again), rebuilds the FTS table and re-embeds the
    active space only: a chunk that comes out the same keeps its row, so every other space keeps its vectors. A chunk
    added, changed or removed leaves every other space `complete: false`; activating that model again embeds only
    the missing chunks. `rag.spaces` lists spaces (model, runtime, vectors,
    complete, active, size, last used); `rag.dropSpace <id-prefix>` deletes one, never the active one without
    `--force`. The state of the last complete index run (`{ embedding, dims, builtAt, docs: { <id>: content hash },
    space }`, what `docs.list` compares for `fresh` / `stale` / `missing`) is kept in `rag.db` itself (meta
    `index_state`): the index is one derived file.
  - When the active space is missing or incomplete, or the query cannot be embedded (also with a model forced by
    `rag.eval --embedding`), `hybrid` search runs on BM25 alone: every hit carries `degraded: true` and the reason
    is logged as a warning (the command or job log), even when nothing is found — never an error, so Claude keeps
    working while vectors build. A reranker failure is logged the same way but does not set `degraded`; `rag.eval`
    lists every fallback it met in its warnings.
- **Which models this PC uses** (`rag/activation.ts`): this PC's choice in `settings.json.rag.byProject[<key>]`,
  the key being the project folder's real path (lower-cased on Windows); else `project.json.rag.reference` (a pack
  `{ "pack": "light" }` or a pair `{ embedding, reranker }`, the team's reference that the benchmark measures);
  else the Light pack. A step is
  taken only when its embedding model is installed here (a missing reranker is reported and left out). With none
  installed, `rag.index` builds the lexical index only and says why. `rag.status` reports the active model, where
  its choice came from (`machine | reference | light | none`), the active space and any degradation.
  The index stays per machine; two colleagues on different models get the same kind of sources, checked the same
  way.
- **Models are data** (`models/catalog.json`, shipped; plus the user's own entries in
  `%APPDATA%\Testimus\models.json`). An entry names one exact quantization, its sources (`hf` repo at a pinned
  revision with the SHA-256 of every file — or the git blob id of small non-LFS files —, the GGUF `file` SHA-256), its runtimes (`transformers`, `llamacpp`), dims, max input tokens, pooling, instructions, `dtypeByDevice`,
  `rerankerKind` (`cross-encoder`, `yes-no-lm`, `http`), sizes, devices, tier and its `lighter` / `heavier`
  neighbours. Nothing in the code or the UI names a model. First catalog (15 entries, all tried on the dev PC):
  bge-m3 q8 / fp16 and Qwen3-Embedding-0.6B q8 / fp16 (ONNX, transformers.js); Qwen3-Embedding 0.6B Q8_0, 4B
  Q4_K_M / Q8_0, 8B Q4_K_M / Q8_0 (GGUF, llama.cpp); bge-reranker-v2-m3 q8 / fp16 and
  Qwen3-Reranker-0.6B ONNX (`yes-no-lm`); Qwen3-Reranker 0.6B / 4B / 8B Q8_0 (GGUF, llama.cpp). Excluded as
  before: licences that forbid commercial use.
- **Packs** (`catalog.json.packs`): a named intent that each PC resolves for its own hardware — **Light** (bge-m3
  q8 on the CPU, no reranker), **Performance** (Qwen3-Embedding-0.6B fp16 on DirectML, else q8 on the CPU),
  **Balanced** (4B Q4_K_M + Qwen3-Reranker-0.6B, else Qwen3-Embedding-0.6B Q8_0 GGUF + Reranker-0.6B), **Quality**
  (8B Q4_K_M + Qwen3-Reranker-4B, else 8B Q4_K_M + Reranker-0.6B, else 4B Q4_K_M + Reranker-0.6B; 80 candidates,
  rerank top 40). Ordered by the benchmark: Q4_K_M is never worse than Q8_0 here and saves 3.2 GB of VRAM on the 8B, so
  8B Q8_0 is left to Custom; bge-reranker on the CPU is too slow to be a variant. Hand-picked
  models are « Custom ». A unit test over `catalog.json` proves that every pack resolves with transformers.js and
  llama.cpp (every model has a Hugging Face source and a transformers or llama.cpp runtime) and that Light and
  Performance need transformers.js alone.
  - `models packs` resolves each pack to its first variant whose models are obtainable here and fit together,
    else to its lightest variant that is not « RAM too small » (flagged), else « not available on this PC », and
    says why each skipped variant was skipped, with the numbers, plus what is left to download. Each card also gives its variant's speed on this PC from the journal and its quality on the
    reference document (below): how often search ranks the answering article first and in the top 5, measured on
    this PC when it was, else the catalog's figure measured by Testimus, else « quality not measured yet »; and, when
    the project's own behavior set has a report for that pair, its quality on this project (the `must` evidence
    recall at 10, search+graph when available, provisional when the report is). `models planPack
    <pack>` shows the plan (downloads, folder, reindex, expected speed) and changes nothing; `models usePack <pack>` is
    one job with its steps: download what is missing (and the llama.cpp build if a GGUF needs it; the bar runs over
    all of it), try each downloaded model (`models verify`: load, one sentence, its dimension) — one that does not run
    here fails the job and the project keeps its pack —, activate the variant for the project on this PC and start the
    index job (a child job; its id is in the result, `indexJob`); `--download-only` stops after the tries. `models
    use` is the Custom pack (installed models only): it keeps the other half of the pair unless told, says whether it
    fits and names a lighter model of the same kind that fits (`--dry-run` stops there and changes nothing), then
    activates and gives the index job it started. `models packs` gives each pack the next lighter pack available here
    (`lighter`), which the fit confirmation offers. `models dirs` says where this PC keeps the models and the llama.cpp
    runtimes (null while not chosen). First launch proposes the
    heaviest pack that fits without running a GGUF or a reranker on the CPU and without falling to the processor when
    it is made for a GPU (`processorOnly`: some variant up to the one resolved has a GPU model and this one runs on
    the processor — Qwen3-0.6B q8 indexes 2.1 passages/s there against bge-m3 q8's 6.6/s, so Light is faster),
    Light when the hardware is unknown or nothing else qualifies.
- **Models on this PC.** The machine registry `%APPDATA%\Testimus\models.json` holds the models folder (`dir`),
  the llama.cpp folder (`runtimesDir`, default `<dir>\runtimes`), `allowRemote` (the old
  `settings.json.models.allowRemote` is still read), the installations (`model`, `via` path · download,
  `runtime`, `path`, `revision`, `dtype`, `device`, `sha256`, `status`, `verifiedAt`) and the llama.cpp build. A
  `models.json` or `settings.json` written before Ollama was removed stays readable: its `ollama` block and
  `useOllama` key are ignored, and an installation `via: "ollama"` is dropped on read (said once on stderr). The
  chosen folder, `TESTIMUS_MODELS`, `%LOCALAPPDATA%\Testimus\models` (v1 downloads) and the release `models/` are
  searched, the last three read-only. A model resolves, per PC, to: the file already
  registered or found in those folders; else a download from Hugging Face served by transformers.js
  (ONNX) or llama.cpp (GGUF). ONNX runs on DirectML when the entry has a `dml` dtype and the PC a GPU, else on the
  CPU; GGUF runs on the GPU when there is one.
  - `models add <path>` registers a Hugging Face folder (matched by the catalog's file list), a `.gguf` file
    (matched by size, then its SHA-256) or a llama.cpp folder, probes it (one sentence, dimension checked) and
    never copies unless `--copy`.
  - `models pull` (a job) downloads only the files of the dtype, at the pinned revision, through Node's `fetch`
    (never `curl.exe`, never without certificate checks): each file goes to `<name>.part`, resumes with a Range
    request, is checked against its SHA-256 (or git blob id) and is renamed only then; a mismatch deletes it and
    fails the job; a cancel keeps the `.part`. **No model is written before the user chose the folder**: without
    one it stops with « Choose where models are stored: `testimus models setDir <folder>` » (or `--dir`), error code
    `models-dir-unset`; the UI asks with a dialog listing the drives. It refuses when the drive has less than 1.2 × what is left to
    download. Whether downloads are allowed is `settings.json` `models.allowRemote`, and only there.
  - `models planDir <folder> --move | --keep | --copy [--runtimes]` says what changing the folder would do (drive, free
    space, size and files to move) and changes nothing; `models setDir` with the same flags does it, as a job
    (`models-dir`, its subject `move to <folder>`, `copy to <folder>` or the folder) that a cancel stops with nothing
    changed (`cancelled: true` in its result). Without a choice it stops and asks;
    downloads are grouped by folder, so a folder two variants of one repository share (bge-m3 q8 / fp16) moves once and
    every installation that points to it follows. Move on the same drive renames, on another drive copies, checks every
    file's SHA-256 and deletes the old copy; copy keeps the old one; keep re-registers the downloads by their path. A
    file already at the target is reused when its SHA-256 is the same; one of another size (refused at the plan, so
    `planDir` says it) or another SHA-256 (refused before anything moves) stops it with the file named. A cancel or a
    failure leaves the old copy and the registry untouched. Refused, with the reason: not enough space (for what is left
    to write), not writable, a running index or model job (not the folder change itself), a folder inside a project.
  - `models remove` deletes a download's own files — those of its dtype, never a file another registered installation
    in the same folder uses (tokenizer, config…), so the other variant stays installed and verifiable —, only
    unregisters a path. `models list` gives each installation the size of its
    own files. `models verify` (a job, `models-verify`: a load takes seconds to minutes and can be cancelled) records
    `verified` or `broken` in the registry (a mutating command, so read-only Claude runs do not get it).
- **Runtimes** behind one seam (`probe`, `embed`, `rerank`), chosen by the installation:
  - **transformers.js** (in the app): device per installation (`cpu`, `dml` DirectML, `webgpu` experimental), dtype
    per device from the catalog; inputs truncated by tokens at `maxInputTokens`; last-token pooling pads on the
    left so batches work; fp16/fp32 texts are batched by token length (≤ 4,096 tokens, ≤ 8 texts); q8 models embed
    one text per call, because their dynamic activation quantization makes a vector depend on its batch-mates (cos
    0.935 measured on Qwen3 q8). Rerankers: `cross-encoder`, and `yes-no-lm` for Qwen3-Reranker ONNX — the yes/no export
    (`onnx/model_yesno_<dtype>.onnx`, logits `[batch, 2]` = [no, yes] at the last position) is fed the Qwen3-Reranker
    template (system « Judge whether the Document meets the requirements based on the Query and the Instruct provided.
    Note that the answer can only be "yes" or "no". », user `<Instruct>: {task}\n<Query>: …\n<Document>: …`, assistant
    `<think>\n\n</think>\n\n`, task = `project.json.rag.queryTask`), one pair per call (the export takes no position
    ids), the document cut — never the template — beyond `maxInputTokens`; score = P(yes) = softmax(no, yes). Measured on
    the dev PC (SPEC-RAG §16.3 question, 5 passages): the answer first (0.994; DG 0.62, ways of de-energising 0.37,
    disjunction alert 0.07, sectionneur menu 0.004), 0.7 s on the CPU after a 1.3 s load, against 28 ms for the GGUF
    Q8_0 on the GPU. Its scores are not on the GGUF's scale: a `threshold` is set per model id, and none is measured for
    it yet. Measured on the dev PC: bge-m3 q8
    CPU 6.6 passages/s, fp16 DirectML 92/s; Qwen3-0.6B q8 CPU 2.1/s, fp16 DirectML 27/s.
    onnxruntime-node is the one transformers.js asks for (1.30), except on an Intel Mac (macOS x64): no release
    after 1.23 ships that binary, so a resolve hook (`rag/runtimes/ort.ts`) loads the optional dependency
    `onnxruntime-node-darwin-x64` (`npm:onnxruntime-node@1.23.2`) and its `onnxruntime-common` in its place, for
    transformers.js and the doctor alike; Windows and Apple silicon keep 1.30, and the release does not carry the
    alias. Checked on a macOS x64 PC (i9-9980HK, onnxruntime 1.23.2, `models verify`): bge-m3 q8 (1024 dimensions),
    Qwen3-Embedding-0.6B q8 (1024), BGE Reranker v2 M3 q8 and Qwen3-Reranker-0.6B q8 all load and answer; the
    catalog lists them in `provenOn: ["darwin-x64"]`.
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
  - Ollama is not used (removed by decision D-12, 2026-11-02): GGUF models run on llama.cpp, which Testimus
    downloads itself (same files as Ollama's `qwen3-embedding` tags).
- **Fit.** `models hardware` profiles the PC without admin rights: RAM and CPU from Node; NVIDIA GPUs from
  `nvidia-smi` (total and used VRAM); other adapters from WMI `Win32_VideoController`, their VRAM from the
  registry's `HardwareInformation.qwMemorySize` (free VRAM unknown); the onnxruntime version that loads here
  (`onnx`, null when it does not load — the doctor's onnx row says why); free space per drive; models loaded by Testimus'
  llama.cpp servers (each server named by the catalog id of the model it serves). A model already loaded for the pair being judged is not
  one of the « other loaded models »: it does not unload itself, and its memory counts as already there; for another
  candidate it is named among the models to unload. Cached 10 minutes; `TESTIMUS_MACHINE` imposes a profile (mock,
  e2e). A model needs what was measured on this PC (journal), else the catalog's `ramMB` / `vramMB`, else 1.2 × its
  download. `models fit` judges the embedding and the reranker **together**: fits (need ≤ free × (1 − headroom));
  tight (within the margin, or only once other loaded models are unloaded — they are named); gpu-too-small (need
  > total VRAM: runs partly on the CPU); ram-too-small (refused); unknown (no VRAM figure: « Testimus measures it on
  first use »); unsupported (refused, judged before the memory: onnxruntime does not load on this PC (`onnx` null)
  and the model runs on transformers.js, or the profile's `system` — Node's platform and arch —
  is not Windows and a model runs on llama.cpp, shipped as Windows x64 builds only, or is a 16-bit DirectML variant,
  whose 8-bit processor twin is the one to run; a pack skips such a variant like an unavailable one, so on a Mac
  Quality is not available and Performance and Balanced resolve to their CPU variant; a profile without `system`
  is a Windows one); untested (memory is not proof: the catalog is proven on Windows x64, the reference PC, and
  elsewhere a model counts as proven only when its catalog entry lists the system in `provenOn` (`darwin-x64`…) or a
  `model.load` succeeded on this PC (journal); otherwise « Not proven on <system> (onnxruntime <version>) »,
  ahead of the memory verdict, which the message still gives; a pack prefers a proven variant like a fitting one).
  Everything on the processor says so: « Fits on the processor (no GPU Testimus can use) ». Messages carry the
  numbers. On the dev PC (RTX 5080 16 GB): 8B Q8 + reranker 4B = tight (13.6 GB for
  11.6 GB usable), 8B Q4 + 4B = fits, so Quality resolves to its second variant.
- **Timings journal** `%LOCALAPPDATA%\Testimus\perf\journal.jsonl`: one line per model operation — `model.load`,
  `embed.query`, `embed.index` (one line per index batch of 16), `rerank`, `search.bm25`, `search.vector`,
  `search.total`, `claude.run` — with only ids, counts and times: `{ at, op, model (catalog id; the Claude model for
  claude.run), fingerprint (vector space id), runtime, device, quantization, items, tokens?, ms, loadMs?, peakRssMB?,
  vramMB?, partialOffload?, oom?, project?, jobId? }`; never document or query text (unknown keys and multi-line
  strings are dropped). Every embedding and rerank goes through one dispatcher that writes its line; a model loaded
  during an operation gets its own `model.load` line and its time is taken out of the operation's `ms` (kept as
  `loadMs`; `search.*` subtract it too). Loads: transformers.js records the process peak RSS; llama.cpp the NVIDIA
  memory used before and after the server is ready (`nvidia-smi`). `partialOffload` stays in the line format (lines
  written before D-12 carry it, and the advice and the doctor still read it); no runtime sets it today, since
  llama.cpp loads every layer on the GPU (`-ngl 99`) or runs on the CPU by choice. A load or an operation that fails for lack of memory
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
  candidate before switching ». `models dismissAdvice` hides an advice until its figure moves by more than 25 %. Testimus
  never switches by itself.
- **Reference document.** Testimus ships `templates/reference/syntec/`: a project holding the Syntec collective
  agreement (IDCC 1486, 90 articles, one `<!-- § article-n -->` anchor each) and `eval/behaviors.jsonl`, the 100
  questions of MTEB-French SyntecRetrieval (lyon-nlp, Apache-2.0), each with the one article that answers it,
  written and checked by its authors (`validated: true`). It is the same test on every PC and needs no project, so
  a pack's quality can be shown before anyone writes a behavior set. `models measure <pack>` (or `--embedding
  --reranker`, a job `models-measure`) copies it to `%LOCALAPPDATA%\Testimus\reference\syntec\` (its index and
  reports stay there between measures), runs `rag.eval` on it with the pack's variant for this PC and the pack's
  retrieval settings, and reports how often search ranks the answering article first and in the top 5 — recall@10
  is near 100 % for every pack on a 90-article document and does not tell them apart (bge-m3 q8, hybrid: 60 %
  first, 91 % in the top 5, 96 % in the top 10, measured 2026-11-03). Its search times feed the perf journal like
  any search. `node scripts/refdoc.ts [pack…]` measures every pack variant whose models are on the PC it runs on and
  writes the figures into `models/catalog.json` (`packs[].measured`: pair, first, top5, questions, app, date);
  variants that need Windows (DirectML, llama.cpp) are measured on the dev PC.
- **Benchmark** (SPEC-RAG §10). Retrieval settings and models are chosen by measurement over
  `<project>/eval/behaviors.jsonl`: one line per functional behavior `{ id, question, queries[], evidence: [{ ref:
  docId#anchor, role, must }], category?, validated? }`, roles `definition`, `rule`, `condition`, `exception`,
  `amendment`, `contradiction`, `figure`; a line in another form is refused. A line with `validated: false` (a bootstrap set proposed
  by Claude, not yet confirmed by a tester) makes every report **provisional**.
  - `rag.eval` (L1, a job) runs each behavior under two fixed policies: `search` (rag.search on the question and
    each query, fused by RRF) and `search+graph` (the same, plus `rag.related` on the anchor of
    each top-k passage, plus `rag.mentions` on the queries and the codes and acronyms of the question). Metrics at
    k = 10, 20, 50: evidence recall (mean share of `must` evidence found), complete (share of behaviors with every
    `must` found), precision, characters returned to Claude, recall by role (exceptions, amendments,
    contradictions first); nDCG@10 and MRR on the search ranking. The report, `.testimus/eval/<date>-<setting>.json`,
    stores the chunker version, header mode, vector space id and fingerprint, effective retrieval settings,
    reranker, ks, corpus hash, set hash, app version and the provisional flag. `rag.eval` brings the index up to date
    first (so it is declared as changing files); its output schema is the report itself, field by field. Without overrides it measures this
    PC's active models; `--embedding` / `--reranker` take a catalog id installed here,
    embedded into its own vector space of `index/rag.db` (the active space, the index state and this PC's choice are
    untouched); `--mode bm25` embeds nothing; `--retrieval.<key>` overrides any retrieval setting for the run.
  - `rag.compare` pairs reports by behavior; the mean difference in `must` recall at k gets a bootstrap 95 %
    interval (10,000 resamples, fixed seed). A configuration is adopted only when the interval is above zero and
    no role's recall goes down (exceptions first); then this section records the result and
    `project.json.rag.reference` changes. On a provisional set the decision is provisional.
  - `gen.bench` (L2, a job, costly) runs, per configuration × behavior × run, the configuration's activation,
    `rag.index`, then `gen.tests` on the question; it scores the agentic recall from the evidence ledger, tests
    written, findings, quote errors, cost and duration; reverts each run's tests unless `keep`; restores the
    previously active configuration.
- **Benchmark results** (R10, 2026-11-02, RATP J5 corpus: 22 documents, 3,027 chunks; bootstrap set of 40 behaviors,
    181 evidence items, **not validated by the testers — every figure is provisional**; reports in
    `.sandbox/v2/project/.testimus/eval/`, summary in `.build/v2/r10-results.md`). Under `search+graph` every
    configuration finds 0.96–1.00 of the `must` evidence at k = 10 (BM25 alone 0.975) at ≈ 15 × the characters of
    `search`: completeness comes from the graph tools, not from the model. Under `search` (must recall @10 / @50):
    bge-m3 q8 hybrid 0.819 / 0.946 (reference); vectors alone 0.754 / 0.920; BM25 alone 0.815 / 0.912;
    Qwen3-Embedding 0.6B 0.819 / 0.931 (ONNX fp16 and GGUF give the same ranks); 4B Q4/Q8 0.810–0.814 / 0.940; 8B Q4
    0.853 / 0.952; 8B Q8 0.819 / 0.952. No embedding passes the adoption rule; Q4 is never worse than Q8. The French
    stem column and a French query instruction make no measurable difference (the instruction stays English). Only
    8B Q4 + Qwen3-Reranker in `threshold` mode passes the rule, at k = 10 and 20 (0.6B at 0.2: +0.058 [+0.009,
    +0.112]; 4B at 0.1: +0.054), never at k = 50 — and its thresholds were chosen on the same set, so the gain is an
    upper bound. Thresholds set by the benchmark (`rag.retrieval.rerank.thresholds`): `qwen3-reranker-4b-q8` 0.5
    (keeps the `topk` recall at 50 with 32 passages per query instead of 50), `qwen3-reranker-0.6b-q8` 0.2.
    bge-reranker-v2-m3 q8 on the CPU takes ≈ 22 s per query of 50 passages. **`project.json.rag.reference` stays the
    Light pack**: the rule is not met at k = 50 nor under `search+graph`, and the gain needs a reranker, which stays
    out of Claude's generation loop. The pack variants were ordered from these figures (below).
    Figure descriptions v2 on the 15 bench documents with figures
    (313 pictures, 25 Claude runs, 13 min): under `search`, figure-role recall 0.69 → 1.00 @10 with bge-m3 q8 (overall
    +0.025 [0.000; +0.063], not adopted), 0.85 → 1.00 @20 with Qwen3-Embedding-8B Q4; `search+graph` unchanged
    (saturated). Multimodal embeddings stay deferred (SPEC-RAG §11). Provisional: the gold set is not validated.
- The index is **derived**: `rag.index` rebuilds what changed (by `doc.json.source.sha256` and chunk hash).
  Nothing in it is ever the only copy of anything; sources point at `doc.md` anchors, never at chunks.
- Claude also reads `doc.md` files directly (Grep/Read) — the index finds, the file proves.
- Details fixed while building (2026-11):
  - Chunk ids: `docId#§x.y`, `docId#§x.y~n` for the parts of a split section, `docId#fig:N` for a figure
    (its path is the section that shows it).
  - Document graph, rebuilt with the chunks into `rag.db` `edges(src, dst, kind, doc_id)`, full references
    (`docId#anchor`, a bare `docId` for a document-level amendment): `refers` section → `§ x`, `cf. x`, `voir le
    chapitre x`, `section x.y` of the same document and `<code> §x` of another, existing sections only;
    `parent` / `sibling` from the numbers; `shows` section → its figure markers; `amends` from `doc.json.amends`,
    and section-level when the amending text names a section (`P25 § 2.1`) that exists in exactly one amended
    document and not in the amending one (7–29 such edges in each J5 PA). Measured on D401-1_3: 102 `parent`,
    418 `sibling`, 43 `shows`.
  - Passage cap: `rag.passage` text is capped at `project.json.rag.passageMaxChars` (default 12,000). Above it:
    `truncated: true`, whole lines around the quote given (from the top without one) plus the header rows of the
    table it sits in, `outline` = every sub-section `{ anchor, title, chars, figureIds }`, and `readMore` =
    `Read docs/<id>/doc.md lines a–b …`. `rag.passage { ref, around: <quote> }` centres the capped window on
    the line where the quote starts (case, spaces and `*` ignored, over several lines) and returns `quoteFound`
    (whether the section's own text holds it). A document that is not in the project fails with the error code
    `doc-gone` (the page tells a removed document from a wrong anchor without listing the documents).
  - Context header: Claude's sentence comes from `claude/headers.ts`, handed to the indexer by `rag.index` and
    `rag.eval` (the indexer itself never calls Claude), asked only for new or changed chunks,
    and only when `project.json.rag.claudeHeaders` is true (off by default: on 900 pages it costs hundreds of
    runs). Figure descriptions are written by Claude once per document, in batches, at conversion
    (`rag.describeFigures`, on by default). Without Claude (or when it fails) the deterministic header
    `<code> <title> — <path> <section title>` is used and a warning is logged.

## 6. Test file (`test.md`)

Xray Editor's format (its `SPEC.md` §3: frontmatter, `## Step N <!-- id -->`, embedded screenshots
as `![](images/… "params")`, wiki tables, escaping, lossless round-trip) with three changes:

1. **Step fields are the smart columns.** Each `### <Column>` heading is a column of `columns.json` (§3): Xray's
   `Action`, `Data`, `Expected Result`, every custom step field, and the project's local columns (kept here, never
   pushed). No column is special: what one holds is what its description asks for. Columns are written in the
   order of `columns.json`. A heading no column names is kept verbatim and reported. Xray Editor's
   `### Expected` / `### Result` are read as `Expected Result`.
2. **`### Sources`** (local, never pushed) — one line per claim the step relies on:
   `- <docId>#<anchor> "<short exact quote>"`, e.g.
   `- SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"`.
   `docId` is the document id or code; an anchor is written `§5.6.6`, `fig:40` or `page:59` (the anchors of §4).
   A quote must appear verbatim (whitespace-normalised) in `docs/<docId>/doc.md`, inside the cited passage; that
   is checked mechanically before any model looks at the test (§8). A line may end with `@<column> "<item>"`: it
   backs that item of the column (a code, a value written in the cell) — what a column with **Reference source**
   on asks of every item it holds; the editor makes the item a link to its passage.
3. **Review state** in the frontmatter (local; mirrored to Xray as a label on push, §9):
   `review: draft | checked | to-fix | validated`, `review_note: "…"`, `reviewed_by`, `reviewed_at`,
   `generated_by: "<job id>"`. `labels:` are the team's own: the review label (`<labelPrefix><review>`) is never
   written there — a pull reads the review from it and drops it, a push adds it from `review:` (§10).

The other sections: `## Description`, `### Attachments` under a step (the pictures of the step no field embeds,
`- images/<file> <!-- <Jira attachment id> -->`). Frontmatter: `key`, `project`, `summary`, `folder`, `labels`,
`status`, `covers`, `cloned_from`, `preconditions` and the review keys.

Tolerance (after the adversarial review, 2026-11): the frontmatter fence is `---` with optional
surrounding whitespace, CRLF and BOM tolerated; unknown `##` sections, unknown frontmatter lines,
comments, multi-line values (YAML lists) and an unknown `review` value are written back unchanged, with
a warning; a `### Result` / `### Expected` alias yields to a column of that exact name.
Attachments and embedded images must be relative paths inside the test folder (the parser warns, a write
refuses anything else). The review keys are read-only for the editor (`tests.save` keeps them from disk):
only `review.set`, the check, the fix and `tests.restore` (Undo local changes, which puts the whole snapshot
back, its review state included) change them; `review.set` refuses a file whose frontmatter is
not closed.

Writing rules: `labels:` and `review:` are always written, `review_note` is always quoted, empty fields
are left out, and text before a step's first `###` is read as Action.

Beside it (§3): `check.json` is the last check's output (§8), derived, never edited; its `testHash` is the
sha256 of `test.md` after the frontmatter, so a review decision does not make findings stale.
`.state.json` `{ remoteChangedAt?, generatedPrint? }` is what the app derived about the test, never edited:
`remoteChangedAt` (Jira changed since `.remote.md`) is set by the sync's re-check and cleared by a pull or a push;
`generatedPrint` is the print of the content a generation wrote, so a generated test the team then edited shows as
edited. A state left empty leaves no file. `local.json` holds the test's own contexts and column folding — never
part of the test, so changing them never makes it modified.
The parser stays tolerant (never throws on a human or Claude edit; returns warnings).

## 7. Generation

- Input: a request (a feature in words), documents or document sections (`docId#§x.y`), or a mix, a
  target Xray folder, the project's language (default `fr`). `gen.preview` says, before any run, which tests
  `discard` would replace (Claude's tests still awaiting review, never one pushed to Jira) and which documents of
  the scope are not indexed or stale.
- Run: `gen.tests` starts a job that runs the project's `generate-tests` skill through `claude -p`
  with the MCP tools available. The skill searches the index, reads the cited sections and figures,
  and writes one `tests/local-<8hex>/test.md` per test with `review: draft`.
- Index gate: the scope is the documents and sections given, or every converted document for a request in words
  alone. `gen.tests` refuses, before any Claude run (resume included), when a document of the scope is not indexed
  (`docs.list.indexed` `missing`: never indexed, or its last index run failed; no index state in `index/rag.db` at all names
  the whole index as missing) — search cannot find it, so the tests would have no sources; the error says to reindex or
  to leave it out of the scope. A document `stale` (changed since its last index) only logs a warning: search still
  finds its previous version.
- Rules the skill enforces (they come from the testers' current prompt, sharpened by what went wrong
  with it):
  - positive and negative paths, black-box or white-box technique chosen per feature and named in
    the description;
  - every smart column is filled as its description says (§6), and only with what a source supports;
  - every expected result has a source; no source → the step is not written, the gap is reported;
  - "not simulated" is written only when a source says so;
  - no reference inside Action / Expected text; references live in `### Sources`;
  - figures from the documents are embedded where the step needs them.
- Output of the job: the test ids written, and what it could not test (with why). The skill
  ends its reply with a fenced `gen-report` block `{ "tests", "skipped": [{ item, why }], "consulted" }`
  that the core parses (`claude/gen-reply.ts`; a request that takes more than one test is planned first in a
  `test-plan` block, then written one run per test); the result is also kept in `.testimus/gen/<generation>.json`. Every new test is
  stamped `review: draft` + `generated_by: <jobId>` and gets its mechanical check at once. The run is
  snapshotted, so a whole generation can be reverted (`claude.revert`).
- **Evidence ledger**: from the run's stream-json tool calls (never from the model's report) the core derives what
  the generation opened — `rag_passage`, `rag_related` and `rag_figure` references, `Read` of `docs/<id>/doc.md` mapped to every section the line range crosses, `Read` of a
  figure image mapped to its `fig:N` — and the searches it made (`rag_search` query, `rag_mentions` term, `Grep`
  pattern on the documents). Failed calls are ignored; a search result is not an opened passage.
  `.testimus/gen/<generation>.json` (one `GenLedger`, read and written by `claude/ledger.ts` only: `{ at, input,
  runId, tests, consulted, searched, plan?, done?, reportedConsulted? }` then the full result) stores `consulted`
  (references, in the order opened), `searched` (`{ tool, query }`) and `reportedConsulted` (the gen-report's own
  list); `gen.tests` returns `consulted` as a count and the generation's name; `gen.bench` reads that generation's
  ledger and scores agentic recall from `consulted`; a resume reads its plan there. The ledger is written before
  the new tests are stamped and checked; the full result then replaces it in the same file.
- Figures: `tests.addImage` copies a file or a document figure (`docId#fig:N`) into `images/` and embeds
  it at the end of a built-in field; `tests.storeImage` (the editor's paste, `{ name, ext, dataBase64 }`) only
  stores the file, the editor putting the reference at the caret. Figure descriptions run in batches of 20 figures per Claude run (read-only, effort low).

## 8. Check (anomalies)

Two passes, run on demand, on generation, and before review:

1. **Mechanical** (core, no model, `lib/check.ts`): the test has steps; each step has an Action and an Expected
   Result (`empty-field`, error); no `raw` embed Xray cannot show (`raw-embed`, error); no step repeats another
   (`duplicate-step`, warning); an expected result has a source (`source-missing`, warning); every source
   resolves — `docId#anchor "quote"` well formed, the document exists (by id or code), the anchor exists
   (`source-missing`, error) — and its quote is found (below); a column whose **Reference source** is on has a
   source for its items (`column-unsourced`, warning) and a source naming an item finds it in the cell
   (`item-not-found`, warning); a step citing a document figure that has a picture embeds it (`figure-not-embedded`,
   warning, unless the step already holds a picture of unknown origin).
2. **Semantic** (`check-test` skill, one test per run, as many at a time as the PC allows — `agents`): for each
   step, does the cited passage say what the expected result claims (`unsupported`, `contradicted`)? Is each smart
   column filled as its description says? Plus: the step tests something other than what it says (`wrong-object`),
   a negative path or a case missing (`negative-missing`, `case-missing`), « not simulated » without a source
   (`not-simulated-unsourced`), an expected result too vague to check (`vague-result`), two documents that disagree
   (`documents-conflict`, resolved by `doc.json` — an amendment wins over what it amends, a validated document over
   a draft — else reported), a cited figure the tester needs and the step lacks (`figure-not-embedded`), `other`.

`check.json`: `{ at, testHash, findings: [{ step?, kind, severity: "error"|"warning"|"info",
message, sources: [docId#anchor], pass: "mechanical"|"semantic" }] }`. A finding is stale when
`testHash` no longer matches.

Rules fixed while building (2026-11):
- Quotes match whitespace-normalised and case-sensitive, ignoring `*` and `<!-- … -->` on both sides, and only
  inside the cited passage: `§x` = the section with its subsections, `fig:N` = the caption paragraph only (what the
  picture shows is the semantic pass's job, and `check-test` must `Read` the image before accepting it), `page:` =
  up to the next page. No quote → `quote-not-found` (warning); not in the document → `quote-not-found` (error); in
  the document but not in the passage → `quote-not-at-anchor` (error) naming where it is — the section whose own
  text holds it, else a caption — with both references in `sources`. Under 4 words or 20 characters, or found more
  than once in its passage → `quote-weak` (warning). The review panel highlights a quote only at its anchor.
- A document that changes (reconversion, removal) re-runs the mechanical pass of the tests citing it; the semantic
  findings stay while they were stamped for the same `test.md`.
- `check.run` decides the semantic pass itself: not asked, it runs when Claude Code is connected (`claude --version`
  answers), else the check is the mechanical pass only and says so (`semantic: "skipped"`, `why`); `semantic: false`
  is the mechanical pass only; `semantic: true` runs it anyway (a missing Claude then leaves its warning on each
  test). The page never decides it.
- `check.run` writes the mechanical findings first; the skill sends its findings with `check_record`,
  which replaces the semantic ones, keeps the mechanical ones and stamps the current `testHash`. A failed
  semantic run leaves an `other` warning. Semantic runs get Read, Glob, Grep, Skill and only the read-only MCP tools
  plus `check_record`; a test a check run edits anyway is put back.
- `review.evidence` reads the generation's evidence ledger (§7) to show what was read and what was cited; it adds
  no finding.

## 9. Review

- The review view shows, for one test: the steps (editor, §13), its findings, and the **source
  passage** of the selected claim with the quote highlighted (and its figure). The panel asks
  `rag.passage { ref, around: quote }`, so a quote far down a section longer than the cap is shown and highlighted;
  when the section's own text does not hold it (`quoteFound: false`) it says so and offers Open in document.
- Two decisions: **Validate** (`review: validated`) or **To fix** with a note (`review: to-fix`).
  "To fix" offers **Ask Claude to fix it** (`fix-test` skill, scope = this test, note as request): one command,
  `review.fix { id, note }`, marks the test `to-fix` with the note (as `review.set` would) then runs the fix;
  the result goes back to `checked` after a re-check, never straight to `validated`.
- A test goes `draft` → `checked` only after a successful semantic check. `to-fix` needs a note;
  `validate` clears it; `reviewed_by` is the OS user name. Review changes touch frontmatter lines only,
  so they never make findings stale. `review.fix` = fix run → re-check → `checked` (findings may
  remain), with a run id for Revert.
- A push of a test that is not `validated` asks for confirmation.
- On push, the review state becomes a Jira label (`testimus-validated`, `testimus-to-fix`) so the
  team sees it in Jira; the label prefix is a `project.json` setting.
- `review.evidence <testId>` → `{ testId, jobId | null, consulted, read: [{ ref, title, cited }], searched }`:
  « sources read » (what the generation opened; `cited` when a step's source is that reference or one of its
  sub-sections) and the searches it made. The Review screen shows them.

## 10. Xray sync

Everything Xray Editor does (its `SPEC.md` §5–§6: pull with images, folders, preconditions, covers
links, dirty detection against `.remote.md`, push plan, 429 back-off, sequential execution that
stops at the first failure), plus:

- **Step field schema**: `xray.refreshFields` reads every step field of the project, custom ones included,
  into `xray.json` `{ fetchedAt, fields: [{ id, name, type, builtin, required?, disabled? }] }` — what Xray says
  and nothing else, read again on demand (`xray.fields` answers the copy in `xray.json` without asking Xray). Source (checked read-only on LFRPS12,
  2026-11-02): GraphQL `getProjectSettings(projectIdOrKey) { testStepSettings { fields { id name type
  required disabled values } } }` — the built-ins come back as `action`/`data`/`result`, LFRPS12 adds
  `Exigence` (`text-single`, id `69d5fcb02f2b49abf7fb76e6`). Steps read `customFields { id name value }`
  (Exigence value: `"EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660"`) and write
  `customFields: [{ id, value }]` in `CreateStepInput` / `UpdateStepInput`. How each column shows is the team's,
  in `columns.json` (§3): one `mode` per column — the project layer of Xray Editor's column folding (its §8):
  `open` (every step), `filled` (only on a step that holds something — the default for Data and for a field
  switched off in Xray) or `collapsed` (folded on every step, its toggle shows `Name ●` when it holds
  something), plus `hidden` (a Testimus extra: left out unless a step holds text in it). `columns.setModes` and
  `columns.order` change them. A test's `local.json` `columns` (§3) overrides the folding column by column
  (`tests.folds`, `tests.setFolds`), the step card's own toggle overrides both for the session, and Action
  and Expected Result never fold. Reading Xray again (`xray.refreshFields`, also before every push) rewrites `xray.json`;
  `columns.json` follows a field renamed in Xray (same id: its description and mode go to the new name), keeps a
  field Xray dropped as a local column (its text stays in the tests) and turns a local column the team then
  created in Xray into that field.
- Fixed while building (2026-11): the review label is `<labelPrefix><review>` and replaces any other
  label of that prefix; a pull reads the review state back from that label and drops it from `labels:` (test.md never holds it; a
  review label moved in Jira alone still shows the test changed in Jira), and keeps the local
  `### Sources`, `review_note` and `generated_by`. A field value Xray returns as a list is
  joined with `", "`. Screenshots embed only in the three built-in fields. The project id and test
  issue type are cached in `.testimus/jira-project.json`. Not yet proven live: whether a custom field
  is cleared with `""` or `null`.
- Push safety (after the adversarial review, 2026-11): `xray.plan` (= `xray.push --dry-run`, one
  code path: a read a Claude run may call, since tool access cannot tell a dry run from a push) returns a `planHash`
  (the ordered operations and `test.md`); `xray.push` requires it and refuses when it no longer matches, so the plan
  executed is the plan shown (a resume uses the kept plan's hash). One push per test at a time; the
  create re-reads the local test first. A test changed in Jira is pushed only with `overwriteRemote`; the push dialog sends it when the user confirms a
  plan that shows « Changed in Jira since your pull » (no extra tick, as in Xray Editor).
  A cancel is honoured between operations (the one in flight finishes; the job is « cancelled » only when
  nothing ran after it). Attachments must be files inside `tests/<id>/`. An empty or space-containing
  `labelPrefix` falls back to `testimus-` with a warning.
- Code: `lib/jira/` is the client — `http.ts` (auth, the six-request semaphore, the cancellable 429 wait: a
  request and its wait follow the job's cancel, and outside a job the cancel of the command that asked — a search
  the page gave up ends at once and gives its slot back),
  `read.ts` (project, fields, folders, tests, preconditions, pull), `steps.ts` (a step both ways: custom fields,
  embedded attachments), `labels.ts` (review labels), `push.ts` (the plan and its operations); `lib/sync/` puts it
  on the project folder — `connect.ts` (the key, `jira-project.json`, `xray.json`), `pull.ts` (images, undo on any
  stop, the remote check), `push.ts` (the plan of a test, its hash, op-by-op execution, one push per test).
- **Never write to a production Jira project during development.** Write paths are proven by unit
  tests over a fake `http` asserting exact payloads (Xray Editor's rule). Live checks are read-only.

## 11. Claude

- Every run is `claude -p` with the prompt on **stdin**, cwd = project folder,
  `--output-format stream-json --verbose`, `--model`, `--effort`, `--permission-mode acceptEdits`,
  `--add-dir` for each attached context, `--mcp-config .mcp.json` and `--allowedTools` covering
  `mcp__testimus__*` (a project `.mcp.json` alone is not trusted in `-p` mode). Stream events are
  forwarded to the UI as they come (tool calls, text, tokens: `usage` input + cache creation + cache read, and output). Also `--strict-mcp-config` and
  `--tools Read,Edit,Write,Glob,Grep,Skill` (chat: Read, Glob, Grep, Skill only). Every run and
  `project.init` rewrite `.mcp.json` so it starts the same Testimus (the installed shim, or `node
  <checkout>/src/faces/cli.ts mcp` in development).
- Runs are recorded under `.testimus/runs/<runId>/run.json`, one file per run: who ran (`kind`, `model`, `effort`,
  `jobId`, `label`) and, for a run that may edit tests, its snapshot (contents before, hashes after, the tests the
  run itself wrote, changed steps; copies of the files it may change under `before/`); **Revert** works from the run id, also after a restart, refuses when a
  test changed after the run (unless `force`, which the UI sends only from an explicit « Revert anyway »),
  and never deletes a test the run did not write; the refusal carries the code `edited-after-run`. The Generate screen shows the check results `gen.tests`
  returns (`checks`); it starts no check of its own.
- Tool access per run kind (after the adversarial review, 2026-11), computed in `claude/access.ts` from the command
  list the registry hands over (`provideCommands`; the Claude layer never imports the registry):
  chat, figure descriptions and context headers get the read-only commands only (`mutates: false`, no job, no
  `system`, `project`, `jobs`, `claude`); the check adds `check_record`; generation adds
  `tests_create`, `tests_edit`, `tests_save`, `tests_addImage`, `check_run`; a fix or `claude.run` adds
  `tests_edit`, `tests_save`, `tests_addImage`. Every other Testimus tool goes into `--disallowedTools`,
  with `Edit`/`Write` on `docs/**`, `index/**`, `.testimus/**`, `contexts/**`,
  `.claude/**`, `project.json`, `xray.json`, `columns.json`, `.mcp.json`, `CLAUDE.md`. Model names and effort are
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
  shipped skills use them (SPEC-RAG §4.6): `generate-tests` calls `rag_related` on each section in
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
  panel are ported from Xray Editor as they are. « Is Claude there » is `claude --version`, shared by every caller
  for one configured program: it gives up after 10 s (the hanging process is killed), an answer that failed is asked
  again next time, and a caller's cancel ends only its own wait. A run that answered counts as « there ».
- **Triage**: `actions.triage { docId | jobId }` has Claude look at a document's conversion warnings or a failed
  job and propose actions; without Claude it looks at nothing and says so (`skipped`). The core, not the page,
  decides which failed jobs Claude looks at: `actions.triageFailed { jobId }` (the page calls it once per failed
  job) starts one cheap triage (project model, effort low, cause `after-failure`) for a failed job of the
  documents, the index, the figures, a generation or a check — never a Claude run or a Jira call — once per job,
  and only when Claude is there; otherwise it returns why not.
- Claude acts on the app only through the MCP tools and by editing files in the project folder;
  it never calls the HTTP API.
- **Contexts** (Xray Editor §7): a run on a test attaches the test's own list (`tests/<id>/local.json` `contexts`) when
  it has one, else the project's `claude.contexts`; ids whose folder is gone drop out (`effectiveContexts`).
  `claude.run`, the fix and the semantic check use that list unless the caller names its own; the dock's
  per-run chips can switch any of them off for one run. Managed by `contexts.*` (§12).

## 12. Command catalog

Group | Verbs (all with `--json`; mutating ones marked *)
---|---
`project` | `init`* (makes the folder a project and the current one; gives its name and Jira key), `openKey`* (open or create by Jira key; the current one), `info` (project.json + xray.json + the step columns in order with their modes + counts for the rail, all typed), `list`, `notes` (the project's CLAUDE.md, with its `mtime`), `setNotes`* (`ifMtime`: refused with code `conflict` when CLAUDE.md moved on disk), `set`* (patch project.json: names, language, label prefix, folders, rag keys incl. reference, queryTask, passageMaxChars, retrieval merged key by key; glossary; Claude defaults; gives project.json back), `open`* (last project), `forget`*, `delete`*
`docs` | `add`* (job: copy + convert one document; a path, or an upload as base64), `addFiles`* (job: the files dropped or picked together, a .docx paired with its .pdf, copied only), `convert`* (job: convert, figures, re-check of the citing tests, triage, and with `index` the search index), `inspect` (profile of the originals), `page` (a page of the PDF copy as a PNG under .testimus/pages), `list` (with index freshness), `show` (+ `contextMtime`), `set`* (status, amends, context with `ifMtime`…), `describeFigures`* (job, Claude), `remove`* (`--dry-run`)
`rag` | `index`* (job; one run at a time per index), `search` (mode hybrid · bm25 · vector; `expand`), `passage` (docId#anchor → text + figures, centred on `around`, capped; code `doc-gone` for a missing document), `figure`, `mentions` (every passage holding a term, no model), `related` (graph neighbours, no model), `eval`* (job, L1; updates the index, writes its report), `compare` (reports → intervals), `status` (active model, space, freshness per document), `spaces`, `dropSpace`*
`search` | `all` (Ctrl K: tests, documents, passages, by words and by meaning), `index`* (job: embeds the tests for search by meaning)
`chat` | `ask`* (job, streamed; writes the conversation under `.testimus/chats/`), `list`, `show`
`claude` | `run`* (job: a scoped request « On this test » — step, test, tests or project), `revert`* (runId; refuses with code `edited-after-run`), `status` (installed, version, signed in, how to connect)
`actions` | `list`, `show`, `propose`* (from a Claude run), `dismiss`*, `run`* (job, Claude, snapshotted), `triage`* (job, Claude: a document's warnings or a failed job), `triageFailed`* (the core decides whether Claude looks at a failed job, and starts the triage)
`contexts` | `list` (the project's own and the shared library's, each with `shared`; `--from <project>` lists another project's own), `show` (with context.md's `mtime`), `create`* (`--shared` puts it in the library; `notes` and `paths` at once: « Save as context » is one call), `share`* (move into the library or back into this project), `set`* (name, notes, outside paths; `ifMtime` refused with code `conflict` when context.md moved on disk), `addFile`* (a path or an upload), `removeFile`*, `remove`*, `copy`* (from another project: notes, paths and files; a taken id gets a new one), `ofTest` (effective · own · project), `ofProject`, `setTest`* (a test's full list, or null to follow the project)
`columns` | `list` (the step columns in order: origin, status, description, mode), `save`* (a description, Reference source, or a new local column), `setModes`* (open · filled · collapsed · hidden, by column), `order`*, `remove`* (a local column), `suggest` (job, Claude, read-only: proposals for columns.save)
`tests` | `list` (with `awaiting`: generated, not validated yet), `show` (typed: the test, the remote copy, the last check, the picture files present and test.md's `mtime`), `create`*, `edit`* (field-level patch incl. preconditions, and step ops set · add · remove · move · sources, steps numbered from 1), `save`* (the whole test, the editor's save; `ifMtime` refused with code `conflict` when test.md moved on disk — sent again without it, it writes over), `restore`* (Undo local changes: test.md ← .remote.md), `clone`*, `addImage`* (a file or a document figure → `images/`, embedded in a step), `storeImage`* (a pasted picture → `images/`, test.md untouched), `removeImage`* (a picture no step lists any more), `folds`, `setFolds`* (per-test folding, in `local.json`), `remove`*
`gen` | `tests`* (job), `preview` (what `tests` would replace, documents not indexed or stale), `bench`* (job, L2 benchmark with Claude; costly)
`check` | `run`* (job: mechanical pass, then the `check-test` skill when Claude is there; writes `check.json`; says `semantic: done · skipped`), `record`* (the skill's semantic findings for one test), `show`
`review` | `set`* (validate / to-fix + note), `fix`* (Claude, job; with a note, marks the test to-fix first), `queue` (what awaits review), `evidence` (sources read)
`xray` | `fields` (the step fields in `xray.json`, no network), `refreshFields`* (read them again from Xray — also before every push and when a project opens; a field switched off in Xray is kept with `disabled`, `required` kept), `connect`*, `disconnect`*, `folders` (the tree with counts), `search`, `preconditions` (the project's, with definitions), `browse` (an issue's Jira page), `pull`* (job), `status` (one test), `statusAll` (job, every test), `plan` (what a push would do, and its `planHash`; = `push --dry-run`, readable by Claude runs), `push`* (job; `from` resumes after a failed operation)
`models` | `catalog` (with the fit on this PC), `list`, `dirs` (the models and runtimes folders), `add`* (path A), `pull`* (job, checked download), `pullRuntime`* (job, llama.cpp build), `remove`*, `verify`* (job), `planDir` (what changing the folder would do), `setDir`* (job: move · keep · copy), `use`* (Custom; dry-run: fit and a lighter model), `packs` (with the next lighter pack), `planPack` (a pack's plan), `usePack`* (job with steps), `measure` (job), `hardware`, `fit`, `perf`, `advice`, `dismissAdvice`*
`jobs` | `list`, `show` (the job — with the `fix` and the stable `code` of the error it failed on — and its typed log), `rerun`* (the same command with the input the job kept, the new job caused by it: `retry`), `cancel`*, `clear`* (forget finished jobs and their logs)
`system` | `credentials` (which credential files exist and are complete; `check` also checks them read-only), `setCredentials`* (merge into ~/.atlassian, then check both connections read-only), `secrets` (the saved token, Client ID and secret, to show back in the form; denied to Claude runs like every `system.*`), `doctor`, `version` (with `shell`: browser or desktop <version>), `settings`, `set`* (claude.exe, model downloads, agents at the same time, the page's preferences), `testAgents`* (job: how many Claude runs this PC carries)

Every command is documented by its zod schema; `testimus help <group.verb>` prints it.

## 13. UI

- Served by `testimus serve` at `http://localhost:4317` (`--port 0` for any free port), opened in the default
  browser, or inside the desktop app (« Desktop shell » below).
- Layout: left rail (Documents · Generate · Tests · Review · Jobs), main pane, **Claude dock on the
  right everywhere** (chat with the documents, or a scoped request on the current test).
- **Documents**: list with code, version, status; preview of `doc.md` with anchors and
  figures; `context.md` editor; ⋯ › Delete removes the document and every trace of it.
- **Generate**: the request, scope (requirements, sections), folder; the job's live output; the tests
  as they land.
- **Tests**: Xray Editor's sidebar and editor, with fields from `xray.json` (order, folded,
  hidden), a `Sources` strip per step (chips → passage), the review state badge.
- **Review**: queue of tests to review; per test: editor + findings + source passage; Validate / To
  fix.
- Screens as built (2026-11), following the design « Testimus — UI draft »:
  - **Claude dock** (parity with Xray Editor §7–§8, 2026-11-02). The « On this test » tab (« On the project » with no
    test open) offers step N, whole test and whole project (`{kind:"project"}`); with no test the scope is the
    project, a focus change resets it to the test. Quick asks are chips that put their prompt in the box (editable,
    `aria-pressed`; typing clears it; the run is labelled « <scope> · <preset> »). Models fable · opus · sonnet ·
    haiku · custom… (a typed alias), effort low…max, per run over the project defaults (a new project: opus / high, as
    in Xray Editor). « Context: » chips list the
    focused test's effective contexts (`contexts.ofTest`, the project defaults with no test), each a toggle for this
    run only, reset when the focused test changes; the run sends the effective list minus the ones switched off. Each
    answer ends with « 12.3 s · 24k tokens in · 1.2k out · opus / high · session … » (« no tokens reported »; on a
    subscription the cost means nothing, so it is kept in the results but not shown); a seconds counter runs
    beside Cancel; the folded dock shows « Last run: N s — <first line of the summary> ». On a test or the project the
    dock shows the last run only (Xray Editor's result card): the request stays in the box, every run with a snapshot
    gets its card (« 0 steps changed » too, with Revert), and the card goes when another test is opened; « Ask the
    documents » stays a conversation. A failed run offers Retry (same prompt, scope, contexts,
    model, effort), Show / Hide raw output and Open Settings. Not connected: « Claude is optional — everything else
    works without it », « Set the path myself… » (Settings at the Claude program field), and a « not connected » chip
    on the folded dock. In the desktop app a pin toggle (« Always on top ») sits in the dock header.
  - **Contexts dialog** (Settings › Claude « Manage contexts… », and the test header's « Manage contexts… »): the list
    (name, « N files · N paths · notes »), « + New context », « Copy from another project… » (a known project, then
    one of its contexts: `contexts.copy`); a shared context reads « shared · … » in the list; the editor: « Shared with
    every project » (`contexts.share`; the footer then reads « shared library · <id>/ »), Name and Notes (saved 400 ms after the last
    key, on blur, on switch and on close), Paths (typed + Add, « Browse folder… » in the desktop app, ✕; absolute
    only), Files (uploaded through `contexts.addFile`, ✕), Delete context (one click, as in Xray Editor; « Deleted for every project » as its tooltip on a shared one). Every
    write invalidates the reads of the contexts (`contexts.list`, `contexts.ofTest`, `contexts.ofProject`, `project.info`), so the dock, Settings › Claude and the test header read them again; a change on disk (`contexts/`, `project.json`, a test's `local.json`) does the same through the event stream.
  - **Settings additions** (parity with Xray Editor §2, §8): a version pill `v<version>` beside the title; Settings ›
    Claude is four cards — Connection to Claude, Claude dock, Quick asks, Contexts (the last three need a project;
    `#/settings/claude-dock`, `-quickasks`, `-contexts` scroll to them). The connection card holds the Claude program field (Browse in the desktop app; Check saves it then runs `claude.status
    {refresh:true}`; « ✓ <version> · found » / « ✕ <error> · not found · Claude is optional », the connect panel when
    not found; `#/settings/claude-exe` focuses it) and the agents at the same time; the dock card the default model
    (with custom…) and effort; the quick asks card the quick asks edited in place / added / removed by index; the
    contexts card the default contexts as toggle chips by name and « Manage contexts… ». Settings › Access lists both
    credential files with their paths as found · valid / missing / invalid — <problem> (`credsStatus.invalid`,
    `problem`). The guided connection (first launch and Access): (1) site and email — a tenant name or any page URL is
    reduced to its https site root, a typed `/wiki` kept and nothing added (Xray Editor's rule; an unchanged site keeps
    the spelling already in the file; a host outside atlassian.net is sent with `otherHost`; `system.setCredentials --site`
    cleans up the same way), « Will be saved as <value> »; (2) « Open API tokens » with the
    instructions (the plain token, not *with scopes*; longest expiry; shown only once); (3) the Xray key path « ⚙
    Settings → Apps → Xray → API Keys → Create API Key, for your own user », « Open Jira apps »
    (`<site>/plugins/servlet/upm`), « only a Jira admin sees that page »; secrets hidden until Show; « Saved in <dir> »
    reveals the folder; « Save and test the connection » answers per service in words (connected as <name>; email or
    token refused, a scoped token does not work; no Jira Cloud site at that address; key accepted; Xray id or secret
    refused, the secret is shown only once; Xray did not answer; « Fill in … first »). Settings › Project edits the
    project's CLAUDE.md (`project.notes`, `project.setNotes`; saved 400 ms after typing and on blur). Settings ›
    Appearance has « Window · Always on top » in the desktop app (bridge `setAlwaysOnTop`, `testimus.alwaysOnTop`,
    re-applied at start). While a job waits out a Jira/Xray 429 its progress line reads « Rate limited — waiting Ns ».
  - **Tests — sidebar** (parity with Xray Editor §8, 2026-11-02). Tabs **Local N** and **Jira N** (`tree.totalCount`,
    a skeleton bar while the tree loads); the tree (`xray.folders`) loads when the sidebar mounts. Keyed by the open
    project: a switch drops the caches, ignores answers asked by the old project, cancels its pulls and closes the open
    test. Tools: **New test** (into the selected Jira
    folder when the Jira tab shows with no query, else the open test's folder, else `/`), Clone, Pull, Show in Explorer
    (desktop). Search: on Local it filters, and offers « Search Jira for “q” »; an issue key or a bare number switches
    to Jira by itself (`xray.search` completes the number with the project key); on Jira it runs `xray.search {text}`
    after 300 ms and filters the folder names (`search “q”` · `N found`); loading draws skeletons, never stale rows.
    Tree: root **Test Repository**, counts `direct/total` (one number when equal), a hover ↓ pulls a whole folder; the
    selected folder's list sits below with a sticky head (path, running count `100 of 645`), slices of 100 fetched
    by a sentinel within 240 px (IntersectionObserver; a slice in flight is never asked twice, a stale answer is
    dropped), `all N loaded` at the end; an empty folder says so with a New local test button. Jira row: summary, key,
    status pill (green done/ready/closed/pass, amber review/progress/block), the local sync badge, `N steps`, title
    « Not pulled yet — opening it downloads it into the project ». Local row: a ✕ on hover or focus deletes the local
    copy — at once when pushed and unchanged, else after the « Delete the local copy? » dialog (the tests opened lately
    are the palette's « Recent », per project; the sidebar has no recent list since 2026-11-03). **Pull queue**: a click on a row with no local copy
    starts its own `xray.pull` (the core runs 3 at a time) and shows at once the pulling pane (key, summary, spinner, the
    job's progress line or « contacting Jira… » / « waiting for a free slot… », Cancel, « N more pulling in the
    background »); the pane follows the last row clicked; a pull that lands unwatched only refreshes the list, an
    unwatched failure is a toast, a watched one the « Pull failed » pane with Retry / Back; leaving never cancels. The
    sidebar is resizable 240–480 px (`testimus.sidebarWidth`, double-click resets); below 900 px it is a slide-over
    with a scrim (☰ « Show test list », Escape, opening a test or ✕ « Close list » close it). Activity: a fixed slot in
    the sidebar head (and in every other screen's header, beside the palette button) shows a spinner and the count of
    running jobs; its popover lists each (kind glyph, subject, latest
    progress, elapsed time, Cancel) and closes on Escape, outside click or when empty. Timed toasts show their seconds
    left in the action button (`Undo · 5 s`). In the browser, a file dropped beside a drop target never replaces the
    page.
  - **Parity, second pass (2026-11-02).** A field switched off in Xray shows in the Columns menu and Settings › Step
    fields as « off in Xray », folded unless a step holds something (can be set open); a required one is « required »
    in Settings and a push warns « <field> is required in Xray and empty in step N ». The test bar says « Refreshing
    from Jira… » while a download runs; Push to Jira is disabled while the push plan is open (« The push plan is
    open ») and says « Claude is working — wait for it to finish » during a Claude run; the step last worked on keeps a ring — even
    when it is marked modified or changed by Claude, and while focus is elsewhere (the dock, the header); the ⋯ menu's « Delete local copy » is red, behind its own separator; the
    preconditions are asked once per project when a test opens, the Xray folders when the folder picker opens, and each
    failed load is a toast, asked again next time (a project with no Jira key asks Jira nothing). After any Claude run on
    the open test the editor reads the file back, even when the run reports no change. The dock sends with Ctrl+Enter
    (Enter is a new line) and offers « Show raw output » after every run, not only a failed one. In the split layout
    Expected Result gets 1.25fr whenever Action is the only other field shown, project columns beside them or not.
    « New context » in the Contexts dialog creates a shared context (seen by every project, as in Xray Editor;
    « Shared with every project » unticked keeps it in the project); `contexts.create` without `--shared` stays in the
    project. In the desktop app the page's `testimus.*` preferences are mirrored into settings.json (`ui`, via
    `system.set`) every few seconds and when the window hides, and put back when the page starts on a new origin
    with none (the core had to take another port). Push to Jira is disabled when the test has no local change since its last sync,
    even if Jira changed since (download instead); any Claude run — on this test, another one or the whole project
    (`claudeRunning` = `*project*`), started from the dock, the CLI, MCP or another window — locks the editor: the lock
    is read from the running Claude jobs of the project (`jobs.list`, kinds `claude` and `fix`), so a reload keeps it and
    the end of the job lifts it even when the dock is gone; « Delete local copy » in the ⋯ menu always asks (the sidebar's ✕
    asks only for a changed or never-pushed copy); the sidebar has Xray Editor's two boxes — « Search Jira » (any text jumps to the Jira tab and asks Jira, a key or a number too) and « Filter tests » (narrows the local tests, the Jira folders and the listed Jira tests without asking Jira; Enter or « Search Jira for … » sends it to the first box); a failed reload on window focus is a toast; the
    « not a step field » push warning names only columns that hold something; files copied into a project (documents,
    context files) are written atomically too, and folders (a context copied or shared, a clone's images) are copied to
    `<folder>.tmp` then renamed (`copyDirAtomic`). After a push Jira took but whose read-back failed, the toast says the local copy was not
    refreshed and points to Download from Jira; Download and Restore step re-check a Claude run on confirm; Revert saves
    the pending edit first; Jira folder loads and searches show in the activity indicator (no Cancel: they are not
    jobs); a Claude run on a test or the project may start with an empty box (the scope and the house rules are the
    request); a saved email, token, Client ID or secret emptied in the connection form is erased (`system.setCredentials
    --clear`); the Jira key is upper-cased as typed in Settings › Project; values typed in Settings › Claude and
    Settings › Project are saved when Settings closes, not only on blur; an emptied Name, Jira key or label prefix is
    not saved and the field says why, keeping the empty box for what is typed next. « Show in Explorer » on a folder opens the folder (a file is shown
    selected); a context path may be relative (read from the project folder, Claude's working directory); the Claude
    program path is kept as typed even when it does not run (the status then says ✕ not found with the install guide;
    only characters a command line would run are refused); a custom step value Xray returns without its column's name
    is left out; the projects menu has « Open by Jira key… » (`project.openKey`: a known project with that key, else
    a new project folder named after it beside the last one); while Jira or Xray access is incomplete the empty Tests
    pane is the connection form (« Connect to Jira and Xray »). Every file the app owns under a project or the user's profile is
    written to `<file>.tmp` then renamed, the `.tmp` removed if the rename fails; a unit test fails on any other
    `writeFileSync` in `src/core` outside the model files and the mock. A cancelled Claude run that already changed files
    is shown like a finished one (changed steps marked, the editor reloaded, Revert offered). A 429 wait outside any job
    shows « Rate limited — waiting Ns » beside the activity indicator (event `notice`). The connection form shows the
    saved token, Client ID and secret back (hidden until Show) and sends only what changed; `system.secrets` is kept
    off the MCP server (`mcp: false` on the command) and denied to Claude runs. A column value Xray holds as
    something other than text (toggle, number, multi-select) is kept in test.md as its JSON spelling and pushed back
    parsed. A new project starts with the quick ask « Rephrase in house style ». Credentials, context notes and the project's CLAUDE.md are written
    atomically.
  - **Tests — editor** (parity with Xray Editor §8, 2026-11-02). Test bar: key (`local` before the first push),
    folder (typed, or picked from the Xray folder tree merged with project.json folders), save state (« Claude is
    editing… » during a run), **Ask Claude**, **Push to Jira** (disabled while Claude edits, while the edit on screen
    is not saved — a change on disk under it or a refused save — and when the test is in sync), and a `⋯` menu: Clone (saves first, opens the copy), Download from Jira (with a key; re-reads the file
    first and asks « Download from Jira? » / **Overwrite local** only when there are local changes), Undo local
    changes (only while the test differs from `.remote.md`; « Undo every local change? » counts `N modified · N added ·
    N deleted step(s)`; `tests.restore`), Open in Jira ↗ (`xray.browse`, the desktop's openExternal or a new tab),
    Delete local copy (asks unless pushed and unchanged; the pending autosave is dropped first). Download, Undo,
    Restore and Delete are refused while Claude edits. Chip row: review, sync, the **remote re-check** made on every
    open of a pushed test (`xray.status {id}`: « checking… » → nothing, « changed in Jira » (amber, click = Download)
    or « conflict » (red, local changes too, click = the Overwrite confirm); unverified → title « Not verified against
    Jira »), Jira status (informational), cloned from, and **Details / Hide details** (persisted per browser,
    `testimus.showDetails`, default shown): labels and covers chip inputs, Preconditions (chips + a select over
    `xray.preconditions`, « none in this project » when there are none, no free text), Claude contexts (the
    effective list as chips, ✕ detaches, a select attaches, « reset to project defaults » when the test has its own
    list, « Manage contexts… » opening the Contexts dialog when the project has none) and the description.
    Preconditions panel above the steps: per attached key a chip opening it in Jira, its summary (« not loaded » when
    the list lacks it) and its definition verbatim (pre-wrap), read-only. Steps row: count, **Columns** popover
    (scope this test / all tests, per foldable field open · when filled · collapsed, « use project's », « follow the
    project »), layout Stacked / Action | Expected (persisted). **Step diff marks** against `.remote.md` (by step id,
    only while the test differs): amber `modified` chip and border with a « Jira version » toggle opening the read-only
    snapshot (same blocks, images open in the lightbox) and « Restore this step »; blue `new`; an unnumbered dashed
    `deleted` placeholder where a snapshot step went, with its Jira version and « Bring the step back ». Restoring
    warns when a snapshot screenshot is no longer in the folder. Empty test: « This test has no steps yet » + **Add
    first step**; else a full-width dashed « Add step ». The editor column is resizable from both edges (min 560 px,
    double-click resets to 1180 px centred, `testimus.editorWidth`). Autosave 400 ms, flushed on leaving the editor,
    window blur, before push, Claude, clone and download; Push, Clone, Delete local copy, Revert Claude's changes and
    the deletion of a dropped image do not start while that save cannot be written (they say why; Download asks, the
    edit counting as a local change to lose); on window focus a test.md whose mtime changed outside the
    app is reloaded (after saving any pending edit). A failed or closed push reloads the test from disk.
  - **Tests — step card**: number chip coloured by state (modified amber, new blue, unreadable red with a red outline
    and « Not fully read — never pushed »); one header toggle per foldable field (`aria-pressed`, `Name ●` when
    folded with content, both ways, session only, carried with the step); Ask Claude (scope = this step); ▲ ▼
    (Alt+↑/↓), insert below (Ctrl+Enter), delete with a 6 s Undo refused after a reload. Built-in fields are columns of
    blocks; a project field is a single line (`text-single`), a growing textarea (`text`) or read-only (anything
    else), the requirement field is chips, and a field the project lacks says « not in Xray ». Split layout puts
    every open field in one grid row (a field 1fr, Expected 1.25fr beside Action alone, a line field .6fr, a text
    field .8fr) and stacks below 760 px of card. An empty field is its insert strip alone (16 px gutter costing 8 px,
    buttons fade in under the pointer, a table cell's strips show on cell hover). Paste of a screenshot outside a
    text block appends it to the field. A block's ✕ (text, table, image) offers Undo of that field only; a removed
    screenshot no step embeds any more, and a detached « not embedded » attachment (its own ✕), is deleted from
    `images/` when the Undo expires (`tests.removeImage`, which refuses a file test.md still lists).
  - **Review** — three columns: queue (review.queue; filter All/Checked/To fix, sort Most issues/State/Folder/
    Recent, Only with findings, folder), the test read-only (findings placed on their step, test-level ones on top, stale
    marked; Edit opens the editor in place), source panel (rag.passage of the selected source or finding). Footer: To fix
    (F, note required, optional « ask Claude » = review.fix shown in the dock) and Validate (V, allowed with open errors,
    moves to the next test). J/K next/previous test, ↑/↓ step. The dock is folded to its strip in Review.
    The source panel ends with « Sources read / related » (`review.evidence`, folded): the passages the
    generation opened (cited ones marked) and the related sections it never opened, each opening in the panel; « not
    recorded » for a test without a ledger. A quote with a `quote-not-at-anchor` finding is not highlighted: the
    finding's message is shown above the passage.
  - **Generate** — request, one picker per tracked kind (search by id or text over traces.find; requirements.csv text
    for the requirement kind) — none when the project tracks nothing, with « Track ids… » instead —
    sections (docs.show toc), folder; the index gate of §7 shown before the run (« Index not ready » with Reindex and
    Generate disabled for a document of the scope not indexed, « Index not up to date » with Reindex for a stale one,
    Generate disabled while an index runs); gen.tests job shown live (passages read, tests landing as cards from « Writing
    local-… » progress) and « What Claude did » (below); at the end check.run on the new tests, then the summary (written, requirements covered, not
    covered + why) and « Review these tests ».
  - **Documents** — list (code · version, title, status, search state from docs.list.indexed, warnings);
    drop or pick .docx/.pdf → docs.add job (by `file` path in the desktop app, `{ name, dataBase64 }` in the browser) — when the index has no vectors on this PC, a line « Search on words only » gives the reason and « Choose a search pack » then rag.index job; detail edits status
    (Draft · Submitted · Validated), amends, context (docs.set); ⋯ ›
    Delete (red) asks « Delete this document? » then docs.remove; shows the toc and the section text, each tracked kind's ids and the
    figures as links. Above the list, « Tracked ids »: a chip per kind (count; a warning when its column is not in Xray),
    « Track ids… » and « Coverage ».
  - **Coverage** dialog (Documents, Generate, Settings › Tracked ids): per kind « N of M ids covered by K tests », a
    bar, and Not covered / Covered / Not in the documents — each id with its document, section, line and the tests
    and steps citing it (a click opens the test). « Generate tests for the N missing ids » opens Generate with them
    picked. = traces.coverage.
  - **Track ids** dialog (Documents, Generate, Settings): « What should Testimus pick out of the documents? » in words
    (examples offered) → « Ask Claude » (traces.propose job, its reads shown) or « I know the pattern »; then a live
    card — name, patterns (one per line, checked as typed), Xray step column (existing custom fields offered) — with
    what the patterns find (ids, per document, first 12 with section and line), Claude's « why », and « What changes »:
    the step column, the Generate picker, and whether Xray has the column (if not: how to add it, « Check Xray again »
    = xray.fields). « Track these ids » = traces.save.
  - **Jobs** — list (kind, subject, progress, duration, result) and detail (live log from jobs.show + events, Cancel);
    a job in which Claude ran shows « What Claude did » instead of the plain log. « Run again » = `jobs.rerun`: the
    same command with the input the job kept (not kept when large or secret), the new job caused by the old one
    (`retry`).
  - **What Claude did** (one component, every Claude job) — the run's events folded into phases (got ready, read,
    plan, write, check, end; a write after a check is « Edited … after the check »), each with its time and what it
    did: the skills followed; per document read, a bar of its lines with the pages read, its chapters, and a dot per
    section opened from the index (on its line in doc.md); the searches; the tests planned; the last test written;
    the check verdict of each test (from the « id: n error(s), m warning(s) » progress); the last thing Claude said,
    as one line. « Show the n actions » lists them grouped (read, searched for, opened, followed links from, every
    mention of) or in order; the raw log stays one click away.
  - **System check** — system.doctor rows as icon + word (OK / To do / Failed / Not checked / Info). A row with an
    `action` shows it as a button in place of the CLI fix text: the command runs (a job is followed to its end,
    then the check runs again), or — when the user has a value to give — `models.setDir` opens the models folder
    dialog, `models.add` the folder picker (Settings → Models in a browser), `system.setCredentials` / `system.set`
    / `models.usePack` open Settings → Access / Claude / Models. « Check Claude sign-in » (doctor {claude:true}) sits
    in its row and keeps the words saying what to do beside it; the rail's status dot shows the last result.
  - **First launch (#/setup)** — shown once per session when the credential files are incomplete or no project is
    open: Access (system.credentials prefilled, secrets never sent back, Save and test = system.setCredentials), Project
    (project.list / project.open / project.init; each known project's « … » menu has « Don't show »
    (`project.forget`) and « Delete » (`project.delete`): a folder still there is deleted after a confirmation, the
    open project included — the window closes it; a folder already gone is only forgotten, without asking; a job
    running in that project refuses it, a model download does not), then **Search pack** (`#/setup/pack`): the four packs with their models and
    download; above them « Analyse my machine » (`models.hardware {refresh}`, then `models.packs` again) lists the
    system and arch, CPU, memory and the GPU Testimus can use. Until it ran, no pack shows a fit and none is
    preselected; after it, each pack has its fit (« Not supported here » and « Untested here » included), « Processor
    only » beside it when the pack is made for a GPU and runs here on the processor, a warning line saying either,
    and the suggestion is preselected (the rule of `models packs` above: on a PC without a usable GPU it is Light);
    « Analyse
    again » measures anew, « Use <pack> » (dry run; the models-folder dialog when a download needs a folder; then
    `models.usePack`), « Skip for now ».
  - **Settings** — Project, Step fields, Tracked ids, Claude, Search, Models, Access, Appearance. Every change saves at once.
    - **Tracked ids**: each kind with its patterns, ids found, column and « In Xray / Not in Xray yet », Coverage,
      Change (the dialog), Stop tracking (confirmation; values already in tests stay).
    - **Search**: the team reference (`project.json.rag.reference`), the models used on this PC and where that choice
      comes from (`rag.status.activation`: this PC's choice · the team reference · the project's v1 model · the Light
      pack · none), the models chosen but missing here, « Search on words only » with `rag.status.degraded`'s reason, the
      index state with Reindex, and the vector spaces (`rag.spaces`: model, runtime, vectors, size, complete, in use here,
      last used) each with Drop (`rag.dropSpace` after a confirmation; the active one with `force` and a warning). No
      model list is written in the UI.
    - **Models**: the models folder (« Change… »); the advice banner (`models.advice`, first item: reason, quality,
      Apply = the pack's plan or `models.use`, Dismiss = `models.dismissAdvice`); the pack cards Light · Performance ·
      Balanced · Quality from `models.packs` plus Custom, the active one marked « In use », each with its variant here
      (« its second choice »), fit chip and message, skipped variants with their numbers, download left, speed, quality
      (on the reference document), « On this project » when the project's own set measured it, « Use this pack ». A pack or a model whose fit is not « fits », and a pack made for a GPU that runs on the
      processor here (« Processor only »), opens a confirmation (« Use the Quality pack anyway? », « Use the Balanced
      pack on the processor? ») with the verdict, what it needs against what is free (GPU or memory),
      **Use anyway** and **Choose a lighter one** (the next lighter pack, or the largest smaller model that fits); « RAM
      too small » and « Not supported here » are titled « … cannot run on this PC » and offer no Use anyway. Use this pack shows `models.planPack` (models, downloads, folder,
      reindex, expected speed), then runs `models.usePack` and follows its job, then the index job it names, on the card (progress, Cancel); running model and
      index jobs are picked up again when the screen opens. Each pack card has « Measure » (« Measure again » once its
      quality is measured on this PC; disabled, with the reason, until the pack's models are on this PC): a dialog says
      what is measured (the reference document, the same on every PC; the project's documents are not used), starts
      `models.measure <pack>` and follows the job (progress, « Cancel the measure » = `jobs.cancel`); closing the
      dialog leaves the job running (Jobs screen, « Measuring · n % » on the card, a toast when it ends), the button
      reopens that job instead of starting another, and a running `models-measure` job is picked up when the screen
      opens. When it ends the cards are read again: quality from the new report, speed from the measure's
      `embed.query` / `rerank` timings in the perf journal. Below, « Model catalog » (folded): `models.catalog` +
      `models.list` rows with state chip, size, fit chip, kind · tier · runtimes, where it is and the speed measured
      here; Install (`models.pull`), Use (`models.use --dry-run` for the fit and the lighter model, then `models.use`), Verify, Remove (after a
      confirmation saying what is deleted); « Add from a folder… » (`models.add`, Browse… in the desktop shell). The
      models-folder dialog opens on the first download and from « Change… »: the drives with free space (from
      `models.hardware`), the roomiest local drive with 1.2 × the need preselected (`<drive>\Testimus\models`), a typed
      folder checked live by `models.planDir` (refusals shown with their reason), Move / Keep where they are /
      Copy when downloads exist; never `wait`: a move or copy is followed as a job.
- Mock seeds: `TESTIMUS_MOCK_SEED` picks the sandbox's projects, comma-separated, the first one open — `fixture`
  (default, the LFRPS12 sample), `empty` (no document, no test, no Jira key), `none` (no project: the first run) or a
  project folder of this PC, copied into the sandbox and never written. `npm run screens` (`scripts/screens.ts`, catalog
  in `scripts/screens-catalog.ts`) starts one mock server per scenario (no project, empty project, fixture, a copy of
  a project of this PC with the fake Jira, Claude absent or logged out, model machines) and shoots every screen, dialog and
  state at 1920 × 1080, 1366 × 768 and 1024 × 768 (740 × 800 on demand), light and dark, a long pane walked a screen at a time, into
  `dist/screens/` with `manifest.json` and `index.html` — the material handed to design work.
- Mock: `serve --mock` also fakes the models side, without network and without touching the PC's models: a machine profile
  (`TESTIMUS_MOCK_MACHINE` = `gpu16` default — 16 GB GPU, 32 GB RAM; `gpu-small` — 4 GB GPU, 16 GB: Quality « GPU too
  small », Balanced « tight »; `cpu-only` — no GPU, 6 GB: Quality not available; `unknown` — a GPU without a VRAM
  figure; `dev` — the development PC; `mac` — macOS arm64, 32 GB, no GPU: Quality « not supported here », the others
  « untested here »; `mac-intel` — macOS x64, onnxruntime 1.23.2, 64 GB, no GPU: Performance and Balanced « processor
  only », Light suggested), written to `<sandbox>/machine.json` as `TESTIMUS_MACHINE` unless that is set;
  the probe after a download (`TESTIMUS_MOCK_PROBE` = `ok` default, journalled like a real load · `fail`: the model
  does not run here);
  a llama.cpp build
  (`TESTIMUS_MOCK_LLAMACPP` = `found` default · `absent`: fetched by a simulated job); the models folder
  (`TESTIMUS_MOCK_MODELS_DIR` = `set` default · `unset`: the first download asks for it). Two models are registered by
  path, two downloaded, one half-downloaded (`.part`), the rest available; the machine registry's catalog points each
  file at a few fake bytes whose SHA-256 is true, so `models pull`, `usePack`, resume, checks and `setDir` run the real
  code on the sandbox. `TESTIMUS_MOCK_ADVICE` = `upgrade` default (Light chosen on this PC, fast queries → « Move to
  Performance ») · `downgrade` (Balanced, slow queries) · `offload` (Balanced, partly on the processor) · `none` seeds the
  timings journal and the choice. `TESTIMUS_MOCK_INDEX=bm25` builds the starting index without vectors (search on words
  only until Reindex). `TESTIMUS_MOCK_DOWNLOAD_MS` (2500) paces fake downloads and pulls. A generation request about
  « avec TK » reads only §5.6.6 and cites one quote under the wrong section (the Review's evidence states).
- Narrow widths (from 760 px, e.g. a laptop at 150 %): Review folds on its own width — under 1020 px the queue folds
  to a strip (previous / next), under 760 px the source panel hides too, so the test keeps ≥ 420 px. The Claude dock
  open beside a screen takes its width (Review at 1440 px with the dock open folds its queue); below 1300 px of window
  the open dock floats over the screen instead (design SYSTEM.md); a
  document added but not indexed shows « Indexing failed » with Reindex under its row; finished add rows
  are shown once (the job stays in Jobs). « Added by Claude » marks only steps beyond the step count
  before the run; any other change is « Changed by Claude ».
- A Jira write from the palette (`xray.push`) always shows its plan first, like the buttons do.
- Shell: Ctrl+K command palette (every registry command by name; a command with input gets a form from its schema), Ctrl+J folds the Claude dock (folded at start and in Review; the user's choice holds until the next start), theme system / light / dark from the rail, step layout and last project remembered per browser; Revert undoes a whole Claude run. The page title is « Testimus — <project name> » (« Testimus » with no project); the desktop window takes it.
- The app logo (`src/ui/public/logo.png`, `favicon.png`; `scripts/testimus.ico` for the Start-menu shortcut)
  sits on a light tile at the top of the rail and on the first-launch screen.
- Built on one kit (GOAL-V3, 2026-11-04): every control is a component of `src/ui/components/ui/` (Button, Text,
  ClaudeBlock, Chip, SourceChip, ChipField, Select, Checkbox, RadioGroup, Switch, Segmented, Menu, Popover, Modal,
  Toast, Tooltip, Banner, Badge, List, ListItem, Tabs, Skeleton, ResizeHandle, Table, EmptyState, Progress, Card,
  Disclosure, Timeline, RailItem, Marked, Icon, Spinner, Kbd); a screen assembles them. `Text` is every field (boxed,
  inline in a step, bare), with its save state, Claude's lock and its autosave; `ClaudeBlock` is every place Claude is
  asked (contexts, quick asks, model and effort, scope, the run and its cancel) and is built on `Text`. Styles are
  StyleX in the component's file, values only from `src/ui/styles/tokens.stylex.ts` (generated from
  `design/tokens.css`), themes as classes on `<html>` following `data-theme`. `#/kit` (under `--mock`) is the
  catalogue: every component in each of its states and options, light and dark side by side.
- Look and feel: the design in `design/` (`SYSTEM.md`, `tokens.css`, the mockups of `design/screens/`; revised
  2026-11-04 for a modern, airy look): clean neutral grounds (near-white canvas, white panes, a rounded white frame
  inset from the window), one ink-blue accent (#3e63dd) for the screen's primary action, the selection and the focus,
  Claude in violet and nothing else in violet, Inter for the interface, Source Serif 4 for text quoted from a
  specification, JetBrains Mono for keys and anchors, soft radii (8 px controls, 12 px cards, 16 px frame and modals),
  light hairlines and faint layered shadows, 32 px controls, 36 px rows and generous spacing; light and dark themes
  are the same token names, a state always icon + word, every pair checked at WCAG AA. Xray Editor's components are
  ported for their behavior and dressed to the design. UI text in English (§16).

### Desktop shell

Built from SPEC-ELECTRON.md (E1–E2). The shell is a window around the HTTP face, not a fourth face: it never
imports `src/core/`, and anything that reads or changes a project goes through `/api`.

- `Testimus.exe` (Electron, `src/desktop/`) starts the core as `node serve --port <last port | 0> [--port-fallback]
  --no-open --ready-json --exit-with-stdin` (the port of the previous run, kept in `window.json`, so the page keeps its
  origin and its localStorage — theme, widths, the palette's recent hits, always on top — across restarts) (release: `node\node.exe app\testimus.mjs` beside the exe; development: `node
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
- Window: size, position, maximized state, zoom and core port in `%APPDATA%\Testimus\window.json`, brought back onto
  a visible display; minimum 520 × 600 (to sit beside Jira: the test list becomes a drawer, headers and side panes
  wrap or stack below 760 px; the open Claude dock floats over the screen below 1300 px); title follows `document.title`; menu bar hidden, edit shortcuts (Ctrl+C/V/X/Z/A) and zoom (Ctrl+= /
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
  (`docs/<id>/`) and on the open test (its `test.md`); Settings › Appearance **Browse…** for the Claude program; external links open in the default browser; taskbar
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
  backend is read from its DLLs). Testimus does not use Ollama: an Ollama installed on the PC is ignored.
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
  3. Runs `testimus system credentials`, asks for what is missing, `testimus system setCredentials`, then `testimus system doctor`.
  - Settings, credentials, downloaded models and projects live outside the versioned folder, so an
    update or a rollback touches none of them.
- **`system.credentials` / `system.setCredentials`**: shows which of the two credential files of §3 exist and are complete (a
  colleague who already uses Xray Editor or the Atlassian skills has nothing to type), asks only for
  what is missing (Jira site, email, API token, Xray client id/secret), merges it into the files as
  §3 says, and checks it read-only (Jira `myself`, Xray authenticate). It is a command like any
  other: the UI shows it as its first-run screen, ported from Xray Editor's Settings credentials
  form.
- **`system.doctor`**: one line per check, each with what to do when it fails (`fix`, CLI words) and, when one
  command repairs it, that command as `action` (`label`, `command`, `input` without the value the user picks,
  `value` = the one in place now):
  - native modules load (onnxruntime's detail is the version loaded; its fix names what the system needs: the
    Visual C++ Redistributable on Windows, `npm install` for the 1.23.2 alias on an Intel Mac);
  - `claude` found, its version, signed in (a minimal `claude -p` run);
  - Jira and Xray reachable and authenticated (read-only);
  - the face (`face`: browser, or desktop <version>);
  - models: the models folder chosen with ≥ 3 GB free (`models.dir`); a model or the folder on the system drive
    with < 10 GB free is a warning (`models.system`); the active embedding and reranker installed and verified
    (`model.embedding`, `model.reranker`); they fit together (`model.fit`, « RAM too small » fails); a model
    partly on the processor in the timings journal is a warning (`model.offload`); the active vector space
    complete (`index.space`); the llama.cpp build (`llamacpp`, a row only while a model in use runs on llama.cpp —
    the GGUF runtime; absent otherwise);
  - disk space for the index; the proxy in use (`proxy`: fails when loopback calls would go through it).

  The UI runs it at first start and whenever a Claude or Jira call fails. Xray Editor's "Claude not
  installed" panel (§11) becomes one of its rows.
- **Models** (§5 « Models on this PC »): the release's `models/` holds the Light pack (bge-m3 q8), so the first
  index needs no download; anything else is registered from a folder (`models add`, e.g. the team share) or
  downloaded into the folder the user chose (`models setDir`; never before that choice).
  `allowRemote: false` (`models.json`, or the old `settings.json` key) turns downloads off for PCs behind a
  proxy that blocks them. Settings: `settings.json.rag.byProject` (this PC's choice per project), `settings.json.rag.budgets`,
  `settings.json.rag.dismissed`.
- Downloads and Jira calls go through the proxy in `HTTPS_PROXY`: the `testimus.cmd` shim and the desktop
  shell set `NODE_USE_ENV_PROXY=1` so Node's `fetch` honours it. Node 26 has no implicit loopback exemption: with
  `HTTP_PROXY` set, a call to llama-server or the core on 127.0.0.1 would go to the proxy (passages and the
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
  another folder than the Start menu, for trials), `-NoSetup`, `-NoPrompt`. `system.setCredentials` reads the token and the
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
Change… Keep / Copy / Move), Settings › Search
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
- Requirement coverage (100 % of the ids a team traces) is computed **outside** the app, from the step column the
  team fills with them (a smart column, §6); a project skill may produce it. Not a screen of Testimus.
- Desktop app releases: Electron is pinned to one version (45.2.1 today) and supports only its last three
  majors, so a release is built **at least every 6 months** to stay on a patched Chromium. Who builds it is the
  release-folder question above. Signing (SPEC-ELECTRON E0) is checked on a tester's PC before the desktop app is
  handed out; until then the browser mode is the fallback.
