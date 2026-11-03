# ROADMAP.md

Each phase is usable on its own and ends on SPEC §15. Tick a line when it is built and verified;
the behavior itself is described in SPEC.md, not here.

## Phase 1 — Base: what Xray Editor does, behind the three faces

The testers can use it as soon as this lands, with the CSVs they already make.

- [x] Scaffold (SPEC §1): Node 26, TS 7 (erasable only), Vite 8, vitest 5, playwright, Biome;
      `src/faces/cli.ts` with the registry, `help`, `--json`
- [x] Registry → MCP (`testimus mcp`) and HTTP (`testimus serve`, SSE progress) adapters
- [x] `project.init` + `templates/project/` (CLAUDE.md, `.mcp.json`, skills)
- [x] Port `testfile` / `table` / `adf` with generic step fields and `### Sources`, round-trip tests
- [x] Port `jira` / `sync`: pull, folders, push plan, push; `xray.fields` (custom step fields)
- [x] `xray.json.prefs`: field order, folded by default, hidden
- [x] `xray.importCsv` local mode (column mapping saved), then direct mode
- [x] UI: port shell, editor, ui vocabulary, styles; generic fields; Claude dock (`claude -p`)
- [x] `serve --mock` with the fixture Jira; e2e green
- [x] `system.setup` / `system.doctor` (CLI, MCP, first-run screen)
- [x] `npm run release` + `install.ps1` (portable Node, prebuilt natives, no admin); proven on a
      clean Windows Sandbox account — v1: installed for real in `%LOCALAPPDATA%\Testimus` (doctor green,
      project init, docx indexed, serve) and into a fresh folder with fresh user dirs; Windows Sandbox is
      not enabled on the build PC (needs admin), and PATH / Start-menu entries await the user's go-ahead

## Phase 2 — Documents and index

- [x] `docs.add` / `docs.convert`: docx → `doc.md` with stable anchors + figures; PDF fallback
- [x] Figure descriptions by Claude at conversion
- [x] `rag.index`: section chunks, context headers, FTS5 + `sqlite-vec`, bge-m3 local; models as
      profiles (`rag/models.ts`, `project.json.rag`)
- [x] Default model profiles shipped in the release `models/`; `system.pullModel`; doctor checks
      the project's profiles
- [x] `rag.search`, `rag.passage`, `rag.figure` over MCP
- [x] `rag.eval` + the testers' question set; settings fixed by measurement; bge-m3 vs
      Qwen3-Embedding-0.6B — v1: measured on the fixture set (bge-m3 kept); the testers' set over the
      real D401 documents is still to write
- [x] `chat.ask` with `--resume` sessions and source chips; Documents screen

## Phase 3 — Generation with sources

- [x] `generate-tests` skill (from the testers' prompt, with source rules)
- [x] `gen.tests` job; Generate screen with live output
- [x] Figures from documents embedded in generated steps

## Phase 4 — Check and review

- [x] Mechanical check (sources resolve, quotes found)
- [x] `check-test` skill, parallel over a batch; `check.json`
- [x] Review screen: editor + findings + highlighted source passage; Validate / To fix
- [x] `fix-test` skill from a To fix note; review state mirrored to Jira labels

## Parity with Xray Editor (2026-11-02, behavior in SPEC §3, §10, §11, §12, §13)

The capability-by-capability verdict (114 rows, all OK) is PARITY.md.

Audit of everything Xray Editor lets a user see, do or edit, then the gaps closed:

- [x] Core: `contexts.*` (per project, per-test override), `tests.restore` / `columns` / `setColumns` /
      `removeImage`, preconditions in `tests.edit`, `xray.preconditions`, `xray.browse`, `filled` column mode
- [x] Tests editor: `⋯` menu (Clone, Download from Jira, Undo local changes, Open in Jira, Delete local copy), remote
      re-check on open, step diff marks + Jira version + restore + deleted placeholders, preconditions editor and
      panel, contexts chip box, Columns popover, Details persisted, resizable column, reload on focus
- [x] Step card: header fold toggles (open · when filled · collapsed), Ask Claude per step, project column kinds,
      split tracks, Undo by field with image clean-up, orphan detach, empty field = insert strip
- [x] Sidebar: tab counts, direct/total folders, infinite scroll + sticky head, pull queue + pulling pane, hover ✕,
      resizable width, narrow drawer, activity popover, toast countdown
- [x] Claude dock and Settings: see SPEC §13 « Claude dock » and « Settings »

## RAG v2 — SPEC-RAG.md (built 2026-11; behavior in SPEC §4, §5, §8, §12, §14)

- [x] R1 Benchmark v2: `behaviors.jsonl`, L1 metrics, `rag.compare` (bootstrap), reports with fingerprints, `gen.bench`
- [x] R2 Evidence model: document graph, passage cap, `quote-not-at-anchor`, `quote-weak`
- [x] R3 `rag.mentions`, `rag.related`, `expand`; skills updated; evidence ledger, `review.evidence`
- [x] R4 French lexical search: Snowball stemmer, glossary, stop words
- [x] R5 Vector spaces by fingerprint, migration, per-machine activation, BM25 fallback, transformers.js devices
- [x] R6 Model manager: catalog, `models.*`, storage folder (move · keep · copy), path and download (SHA-256),
      Settings › Models, doctor rows
- [x] R7 Ollama runtime and panel — Removed by decision (D-12): GGUF runs on llama.cpp only
- [x] R8 Hardware fit, timings journal (fed by every runtime), advice with the benchmark's quality side, packs, first-launch pack
- [x] R9 llama.cpp runtime: managed server, build download, backend choice
- [x] R10 Experiments of SPEC-RAG §10.8 on the RATP corpus (L1, 25 variants; L2 bounded), thresholds per reranker,
      reference kept on Light, pack variants reordered — provisional until the testers validate the bootstrap set
- [x] R11 Qwen3-Reranker through transformers.js (`yes-no-lm`), figure descriptions v2 (labels, kind) on the bench
      documents (figure recall 0.69 → 1.00, provisional); multimodal embeddings stay deferred

## Desktop app — SPEC-ELECTRON.md (behavior in SPEC §1, §2, §13 « Desktop shell », §14, §15)

- [ ] E0 Signing and execution policy on a tester's PC — cannot be done on the build PC; open
- [x] E1 `serve --port 0 --ready-json --exit-with-stdin`, clean stop, `TESTIMUS_SHELL`
- [x] E2 Shell: core spawn, splash and error page, window state, lock-down, single instance, quit with jobs
- [x] E3 Bridge in the UI: Browse, `pathOf` → `docs.add { file }`, pickers, taskbar progress, notifications, reveal, CSP
- [x] E4 Release: pinned Electron + SHA-256, rename, icon, fuses, asar (integrity), locales, shortcuts, `Unblock-File` —
      proven in a fresh folder (no Windows Sandbox on the build PC; a clean account remains with E0)
- E5 (optional, out of scope this round): updates from a team folder, proxy from Windows settings

## Smart columns — 2026-11-03

- [x] A step column is a smart column: Claude fills it from its description (Settings › Smart columns); nothing else
      about a column is special — the documents, the index, the check and the skills know no column by name

## Claude actions — built 2026-11-03

- [x] A1 `actions.*` commands (list, show, propose, dismiss, run, triage), action files in `.testimus/actions/`, stale when the
      problem place changes, one open action per problem, a dismissed problem stays dismissed
- [x] A2 Run kinds `action` (the whole command set minus another Claude run, Jira writes and the machine) and `triage`;
      `claude.run` scope `doc`; snapshots copy project.json, xray.json and the document folder, so Revert puts them back
- [x] A3 One right panel « Ask Claude » with a scope (step, test, document, project), action cards with their own model and
      effort, the open actions of the scope listed under the thread
- [x] A4 Claude action buttons beside the problem: document warnings, documents list, Review rows and findings, test header,
      Generate, failed jobs; counters in the screen headers
- [x] A5 Proposals from the check and the generation (`actions_propose` in their prompts and skills), a triage of a new
      document's warnings with the import's model and effort, and of a failed job when Claude is there
- A6 (later) Jira writes from an action: the push plan shown in the card, pushed on the user's yes

## Runtime skills from the claude -p traces — built 2026-11-03

What 85 real runs showed (one « whole document » generation: 103 turns, 20 tests written from one read, one of 40
steps, 172 findings, `vague-result` first; `rag_related` never called):

- [x] K1 `plan-tests` skill: on a large scope the generation may answer with a `test-plan` block instead of tests;
      `gen.tests` then runs generate-tests once per planned test (every one, three at a time), one revert for all
      (`planned` in the result); a failed run stops the plan, what is left is in `skipped` and `remaining`, and
      `gen.tests --resume <generation>` (the UI's Resume) writes it under the same generation and revert
- [x] K2 `edit-test` skill for the Claude panel on a test or a step (`claude.run` names it), with `check_run` allowed
- [x] K3 generate-tests: an expected result is observable on the screen (else left out), the test states its starting
      point, a chapter is not a scenario, every `check_run` finding fixed (`quote-weak` too), re-read with `tests_show`
- [x] K4 check-test: `rag_mentions` once per object, a missing case is checked
      against the other tests first; figures read at the path `rag_figure` gives
- [x] K5 the team context is `docs_show`'s `context` (most documents have no `context.md`)

## Later

- Execution support: test sheets for testers, screenshots from R4 runs, NOK → bug draft
