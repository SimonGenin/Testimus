# CLAUDE.md

Testimus — local app that turns specification documents into reviewed Xray manual tests: documents → index (RAG) →
generation with sources → anomaly check → human review (Validate / To fix) → Xray sync. Node + TypeScript core with
three faces (CLI, MCP, HTTP + React UI) and an Electron window around it; Claude Code (`claude -p`) does the reading
and writing.

## Read before working

- **ARCHITECTURE.md** — how it is built and why: stack decisions, processes and seams, the project folder and file
  formats, documents, index and models, generation, check, review, Jira, Claude runs, the page, security, desktop,
  release; open decisions. Update it in the same change when a rule, a seam, a file format or a decision changes.
- **CODE.md** — working in the code: layout, how to add a command or a screen, conventions, the mock and its knobs,
  the verification bar, shipping, what lives outside this repo on this PC.
- **ROADMAP.md** — what comes next (the user's list). Nothing in it is built unless the code says so.
- README.md — how a person installs and runs it.

Behavior is described by the code and its tests; there is no line-by-line spec any more (SPEC.md and the GOAL briefs
were removed on 2026-11-06, last in git at `d42ef1d`). `testimus help` lists every command; `testimus help
<group.verb>` prints one command's schema.

## Commands

```
npm run build                      # tsc (TS 7, type check only) + vite build → dist/ui
npm run check                      # biome: lint + format (npm run format fixes)
npm test                           # vitest, tests/unit (Claude, Jira and the network are faked)
npx playwright test                # e2e (msedge) against fresh `serve --mock` servers, + tests/e2e/desktop/ (Electron)
npm run screens [-- --out <dir>] [-- --only <scenario>]  # every screen and state, light and dark → dist/screens/
node tests/unit/guards/report.ts [--detail]          # the architecture guards and what each finds
node scripts/tokens.ts             # design/tokens.css → src/ui/styles/tokens.stylex.ts (then npm run format)
node src/faces/cli.ts <group> <verb> [--flags] [--json] [--project <dir>]   # Node runs the .ts directly
node src/faces/cli.ts help [group.verb]
node src/faces/cli.ts project set --rag.describe-figures=false   # one key of an object input, no JSON
node src/faces/cli.ts serve [--mock] [--port 4317|0] [--project <dir>] [--no-open] [--ready-json] [--exit-with-stdin]
node src/faces/cli.ts mcp [--project <dir>]          # MCP server on stdio (what claude -p calls back)
npm run desktop [-- --mock] [-- --ui-dev]            # bundle src/desktop → dist/desktop and open the Electron window
npm run publish <x.x.x> [-- --notes "…"] [-- --to <dir>]   # the usual way to ship (CODE.md « Shipping »)
npm run release [-- --publish [<dir>]] [-- --channel <dir>] [-- --publish-only]   # build dist/testimus-<v>-win-x64/
powershell -ExecutionPolicy Bypass -File dist\testimus-<v>-win-x64\install.ps1 [-Root <dir>] [-NoPath] [-NoShortcut] [-NoDesktop] [-NoSetup] [-InstallClaude] [-NoPrompt] [-Keep <n>]
```

`serve --mock` copies `tests/fixtures/project/` to a temp folder and fakes Jira, Claude, the machine and the models
(knobs in CODE.md). Dev models: `TESTIMUS_MODELS=D:/Projects/Testimus/.models`. The HTTP face only answers the page
it served: a script loads `/` first for the cookie (`tests/e2e/helpers.ts`).

Machine: run `npm`/`npx` from the Bash tool (not on PATH in the PowerShell tool). Write TS files with Write/Edit, never
bash heredocs (they mangle `\\` in regex literals).

## Rules that do not bend

- **One registry, three faces.** A capability is a command in `src/core/commands/`; CLI, MCP and HTTP are derived from
  it. Never a route, a tool or a button that calls domain code directly — a UI-only feature is one Claude cannot use.
- **Files are the state.** `test.md`, `doc.json`, `context.md`, `project.json`, `columns.json` are the truth;
  `index/`, `.testimus/`, `check.json`, `analysis.json`, `.remote.md`, `xray.json` are derived or managed, never hand-edited.
- **Sources are data.** A claim's source is `docId#anchor "quote"`; the quote is findable verbatim in `doc.md` at its
  anchor; anchors are stable across reconversion, never numbered by position.
- **No column is special.** A step column is a smart column Claude fills from its description; nothing knows a column
  by name.
- **Jira writes are plans first** (`--dry-run`, the plan shown before acting). **Never write to a production Jira
  project (LFRPS12, BHPTCC) during development**: write paths are proven by unit tests over a fake `http`; live checks
  are read-only.
- **Claude runs through `claude -p`** (prompt on stdin, cwd = the project folder, the project's `.mcp.json` passed
  explicitly), on the user's subscription. Never the Agent SDK.
- **Documents never leave the machine** except inside Claude runs: embeddings and reranking are local. No hosted
  embedding or vector service without a decision written in ARCHITECTURE.md.
- **Processes, waits and cleanup live in `src/shared/run/` only** (no `node:child_process`, `process.kill`, `taskkill`
  elsewhere in `src/`, no `setTimeout`/`setInterval` in `src/core/`).
- **The desktop shell is not a fourth face**: `src/desktop/` never imports `src/core/` (it may import `src/shared/`),
  its bridge carries presentation only, every screen works without it.
- **The page has one data layer and one kit**: reads `useRead`, actions `useCommand`/`execute` (`src/ui/lib/data/`),
  types only from `src/core/`; no `fetch`/`EventSource`/storage elsewhere (`lib/prefs.ts` for presentation prefs);
  every control and framed box is a kit component; StyleX in the component's file, tokens only, text through `type.ts`.
  `tests/unit/guards/` and Biome enforce it.
- **Nothing may need admin rights, a compiler or Python on a colleague's PC**: a native dependency without a win-x64
  prebuild is refused.
- **Port, don't share**: code from Xray Editor is copied and adapted. Never edit `D:\Projects\XrayEditor` from here.
- `design/` is the design system, owned by the design sessions: read it, never write it.

## Conventions

Ponytail style (no speculative abstraction, no interface with one implementation, stdlib first); one component per
file, one area per folder; no code comments except deliberate `// ponytail:` markers; TS erasable only (no `enum`,
`namespace`, parameter properties), imports end in `.ts`; tests in `tests/`, never beside the code; every zod field
has a `.describe()`. Identifiers and UI text in English; generated tests in the project's language. Before calling
something done: CODE.md « Proving a change ».

## Branches and commits

The software is young: the work lives on `master`. A branch or a worktree is only a way for several agents to work
at once — use one freely. When the user says « commit » or « merge », the result goes to `master`: commit, then merge
into `master` (fast-forward when possible), and leave the checkout on `master`. Never push unless asked. Other
sessions may edit this checkout at the same time: never stash, `checkout --` or reset files you did not change.

**Every commit the team would notice updates `CHANGELOG.md` « ## Unreleased »** (French, for the team): first look
for a line about the same thing and rewrite it (or drop a line the change makes false); only otherwise add one line —
brief, simple, clear, what the team sees or can do, never file or test names. A hook stops `git commit` without it;
refactors, tests and tooling put `[no changelog]` in the message. `npm run publish` turns Unreleased into the version.

## Talking to the user

Answer in French. Plain words first; code on request.

## Skills

Dev skills in `.claude/skills/`: `xray-cloud-api` (Jira / Xray API facts, read-only checks), `port-from-xray-editor`,
`docx-ingest` (document conversion), `rag-eval` (measuring retrieval). The runtime skills the app ships to every
project are product code, in `templates/project/.claude/skills/` (generate-tests, plan-tests, check-test, analyze-test, fix-test,
edit-test, ask-docs, define-columns, study-document, draft-comment, overview-documents).
