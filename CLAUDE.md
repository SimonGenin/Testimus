# CLAUDE.md

Testimus — local app that turns specification documents into reviewed Xray manual tests: documents →
index (RAG) → generation with sources → anomaly check → human review (Validate / To fix) → Xray sync.
Node + TypeScript core with three faces (CLI, MCP, HTTP + React UI); Claude Code (`claude -p`) does
the reading and writing. **SPEC.md is the behavioral contract** — read it first, update it in the same
change when behavior changes. ROADMAP.md says what is built and what comes next. LINKS.md says where
every reused piece lives on this PC. SPEC-RAG.md (RAG v2) and SPEC-ELECTRON.md (desktop shell) are
built and kept as design records (findings, measurements, reasons); SPEC.md wins where they differ.
GOAL.md and GOAL-V2.md are the briefs of the two one-pass builds — history, not instructions.

Status: **v1 + v2 built** — ROADMAP phases 1–4, RAG v2 R1–R9, desktop E1–E4. Open: R10 (benchmark on
the RATP corpus), R11 (optional), E0 (signing on a tester's PC), E5. `testimus help` lists every command.

## Commands

```
npm run build                      # tsc (TS 7, type check only) + vite build → dist/ui
npm run check                      # biome: lint + format (npm run format fixes)
npm test                           # vitest, tests/unit (Claude, Jira and the network are faked)
npx playwright test                # e2e (msedge) against fresh `serve --mock` servers, + tests/e2e/desktop/ (Electron); screens in tests/screens/
node src/faces/cli.ts <group> <verb> [--flags] [--json] [--project <dir>]   # Node runs the .ts directly
node src/faces/cli.ts help [group.verb]              # the catalog / one command's flags
node src/faces/cli.ts project set --rag.describe-figures=false   # one key of an object input, no JSON
node src/faces/cli.ts serve [--mock] [--port 4317|0] [--project <dir>] [--no-open] [--ready-json] [--exit-with-stdin]   # UI + API (build the UI first); the last two are for the desktop shell
node src/faces/cli.ts mcp [--project <dir>]          # MCP server on stdio (what claude -p calls back)
npm run desktop [-- --mock] [-- --ui-dev]            # bundle src/desktop → dist/desktop and open the Electron window (desktop:build only bundles)
npm run release                    # dist/testimus-<version>-win-x64/ (Testimus.exe Electron shell, portable Node 26, bundle, models, install.ps1)
powershell -ExecutionPolicy Bypass -File dist\testimus-<v>-win-x64\install.ps1 [-Root <dir>] [-NoPath] [-NoShortcut] [-NoDesktop] [-NoSetup] [-InstallClaude] [-NoPrompt]
```

Dev models: `TESTIMUS_MODELS=D:/Projects/Testimus/.models` (bge-m3, Qwen3-Embedding-0.6B, reranker,
q8). The model catalog is `models/catalog.json`; runtimes are transformers.js and llama.cpp
(Testimus does not use Ollama, D-12). `serve --mock` copies
`tests/fixtures/project/` to a temp folder and fakes Jira and Claude (`TESTIMUS_MOCK_CLAUDE=absent|logged-out`,
`TESTIMUS_MOCK_MAX_ATTACHMENT=<bytes>`, `TESTIMUS_MOCK_JIRA_MS=<ms>`, `TESTIMUS_MOCK_CLAUDE_MS=<ms>`); the other `TESTIMUS_MOCK_*` fake the hardware, runtimes and
downloads (`src/core/mock/machine.ts`, `models.ts`). The HTTP face only
answers the page it served (SameSite session cookie, local Host/Origin, JSON POST): call the API from a
script by loading `/` first for the cookie (see `tests/e2e/helpers.ts`).

Stack: SPEC §1 (Node 26 LTS, TS 7, Vite 8 + Rolldown, `node:sqlite` + `sqlite-vec`, zod 4, MCP SDK v2,
transformers.js 4, Electron 45.2.1 pinned exact, Biome). TS must stay erasable: no `enum`, `namespace` or parameter properties;
imports end in `.ts`.

Machine: Node 26 LTS (fnm default), npm 11, Python 3.13, Claude Code CLI on PATH. Run node tooling from the Bash tool
(`npm`/`npx` are on PATH there, not in the PowerShell tool — same as Xray Editor). Write TS files with
Write/Edit, never bash heredocs (they mangle `\\` in regex literals on this machine).

## Layout

```
src/core/command.ts  command(), Ctx, UserError — the shape of every command
src/core/commands/   one file per command group (index.ts = the registry); zod in/out + run(ctx, input)
src/core/env.ts      the one seam: http, home/data dirs, spawnClaude — tests and --mock swap it
src/core/jobs.ts     long work: progress, cancel, .testimus/jobs/<id>.jsonl, SSE
src/core/types.ts    shared types
src/core/shell.ts    which shell runs the core (TESTIMUS_SHELL), loopback NO_PROXY, clean shutdown
src/core/lib/        testfile, table, adf, store, jira, sync (ported from Xray Editor), check,
                     docs, creds, project, doctor, hash, zip; models-* (catalog, packs, hardware, fit,
                     download, install, registry, resolve, perf, advice, quality, store, dir)
src/core/rag/        convert* (docx/pdf/html/png → doc.md + figures), chunk, embed, models (profiles),
                     db, indexer, search/ (lexical, vector, hybrid, passage), runtimes/ (transformers,
                     llamacpp, llama-server), statements, graph, related, mentions, glossary,
                     stem-fr, fingerprint, activation (vector spaces), eval, bench, compare;
                     inspect (docs.inspect: the profile of an original), pdf (pages drawn: figures, docs.page)
src/core/search/     search.all (Ctrl K, the tests list): query (filters), match (accents, French
                     stems, prefixes, typos, codes), tests corpus, vectors (index/tests-vectors.json), all
src/core/claude/     run (claude -p, per-kind tool access), stream, snapshot/revert, diagnose, status,
                     chat, generate, check, fix, figures, headers, prompt, ledger (evidence ledger),
                     study (a document studied before its conversion, checked against its pages after)
src/core/mock/       --mock: fixture Jira (jira.ts), scripted Claude (claude*.ts), fake machine and
                     models, sandbox setup
src/faces/           cli.ts, mcp.ts, http.ts — thin adapters over the registry, no domain logic
src/desktop/         Electron shell: main, preload, bridge (+ bridge-types), core spawn, window, log,
                     pages/ (splash, error); bundled by scripts/desktop.ts
models/catalog.json  the model catalog (packs and variants)
src/ui/              React app (app/, components/{ui,shell,claude,sources}, screens/, lib/, styles/ —
                     tokens.css holds the design tokens); talks to /api only
templates/project/   copied into every project folder by `project init` (CLAUDE.md, .mcp.json, skills)
scripts/             release.ts, desktop.ts, install.ps1, testimus.cmd, testimus.ico
tests/unit/          vitest (desktop/ for the shell); tests/e2e/ playwright (desktop/ drives Electron);
                     tests/fixtures/ the LFRPS12 sample project, docx, evidence, rag, snowball-fr
```

## Architecture rules (the non-obvious ones)

- **One registry, three faces.** A capability is a command in `src/core/commands/`; CLI, MCP and HTTP
  are derived from it. Never add a route, a tool or a button that calls domain code directly — that is
  how a UI-only feature appears and Claude loses the ability to do it.
- **The desktop shell is not a fourth face.** `src/desktop/` never imports `src/core/`; it starts
  `serve` and talks to `/api`. Its bridge (`window.testimusDesktop`) carries presentation only
  (pickers, paths, reveal, progress, notifications) and every screen must work without it (browser mode).
- **Files are the state.** A project folder is a Claude Code project (SPEC §3). `test.md`,
  `doc.json`, `context.md`, `project.json`, `xray.json` are the truth; `index/`, `.testimus/`,
  `check.json`, `.remote.md` are derived or managed and can be rebuilt or compared, never hand-edited.
- **Sources are data, not decoration.** A claim's source is `docId#anchor "quote"`; the quote must be
  findable verbatim in `doc.md`. Anchors are stable across reconversion — never number them by
  position.
- **No column is special.** A step column is a smart column: Claude fills it from its description, and
  that is all. Conversion, the index, the check, the skills and the UI never know a column by name:
  what a column holds is whatever its description asks for.
- **Jira writes are plans first.** Every mutating Xray command supports `--dry-run` and the UI shows
  the plan before acting. **Never write to a production Jira project (LFRPS12, BHPTCC) during
  development**: write paths are proven by unit tests over a fake `http`; live checks are read-only.
- **Claude runs through `claude -p`** with the prompt on stdin, cwd = the project folder, MCP tools
  from the project's `.mcp.json` passed explicitly. Never the Agent SDK (API key, not the
  subscription).
- **Documents never leave the machine** except inside Claude runs: embeddings and reranking are
  local (transformers.js, or a local llama.cpp server). Do not add a hosted embedding or
  vector service without a SPEC change.
- Port, don't share: code taken from Xray Editor is copied here and adapted (generic step fields,
  `api.ts` seam becomes the HTTP client). Do not edit `D:\Projects\XrayEditor` from this project.

## Conventions

- Xray Editor's: ponytail style inside a file (no speculative abstraction, no interface with one
  implementation, stdlib first), but one component per file, one area per folder, one CSS sheet per
  area. No code comments except deliberate `// ponytail:` markers. Tests in `tests/`, never beside
  the code.
- Identifiers and UI text in English (UI language is an open decision, SPEC §16). Generated tests are
  in the project's language (`project.json.language`, default `fr`).
- A command's zod schema carries `.describe()` on every field: it is the CLI help, the MCP tool
  description and the API doc at once.
- Before calling a phase done: SPEC §15.
- Nothing may need admin rights, a compiler or Python on a colleague's PC (SPEC §14): a native
  dependency without a win-x64 prebuild is refused.

## Branches and commits

The software is young: the work lives on `master`. A branch or a worktree is only a way for several
agents to work at once — use one freely. But when the user says « commit » or « merge », the result
goes to `master`: commit, then merge into `master` (fast-forward when possible), and leave the
checkout on `master`. Never push unless asked.

## Talking to the user

Answer in French. Plain words first; code on request.

## Skills in this repo (`.claude/skills/`)

- `xray-cloud-api` — Xray Cloud / Jira API facts this app relies on, and how to check one read-only.
- `port-from-xray-editor` — how a module or component moves from Xray Editor into Testimus.
- `docx-ingest` — converting a client document to `doc.md` + figures with stable anchors.
- `rag-eval` — building the question set and comparing retrieval settings.

The runtime skills the app ships to every project live in `templates/project/.claude/skills/`
(`generate-tests`, `check-test`, `fix-test`, `ask-docs`, `define-columns`, `study-document`…). Edit them there; they are product code.
