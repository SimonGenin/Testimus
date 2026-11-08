# CODE.md — working in the Testimus code

Where things are, how a change is made, how it is proven. The why behind the rules is ARCHITECTURE.md.

## Layout

```
src/core/command.ts   command(), Ctx (ctx.invoke runs another command), UserError (fix, code) — the shape of every command
src/core/commands/    one file per command group; index.ts = the registry and its types CommandMap / CommandInput /
                      CommandOutput; zod in/out + run(ctx, input)
src/core/env.ts       the one seam: http, home/data dirs, spawnClaude — tests and --mock swap it
src/core/jobs.ts      long work: progress, steps, processes, cancel, rerun, .testimus/jobs/<id>.jsonl, SSE
src/core/watch.ts     one recursive watch per open project → `changed` events
src/core/types.ts     shared types; schemas.ts the zod pieces several groups share
src/core/shell.ts     which shell runs the core (TESTIMUS_SHELL), loopback NO_PROXY, clean shutdown
src/core/lib/         the domain modules:
                        testfile, test-blocks, test-edit, table, adf, store, check, review, columns, contexts, actions,
                        agents, atomic (every owned write), changed, file-memo (reads per file version), natural (the
                        one collator), creds, project (+ project-info, project-init), doctor (+ doctor-row,
                        doctor-models), hash, zip, updates;
                        docs (+ docs-convert, docs-index, docs-pipeline: add → convert → index);
                        media (+ media-pipeline: batches of photos, body.md + part.md → doc.md);
                        jira/ (http, read, steps, labels, push) and sync/ (connect, pull, push), ported from Xray Editor;
                        models-* (catalog, packs, download, install*, registry, resolve, perf, advice, quality, store,
                        dir, use);
                        machine/ what this PC has, knowing no model (probes = the seam: nvidia-smi, WMI, registry,
                        llama-server --list-devices, memory, drives; sources, gpus, profile);
                        fit/ will a model run here (placement, need, support, verdict)
src/core/rag/         convert* (docx/pdf/html/png → doc.md + figures), pdf-tags-*, anchors (the one reader of anchors),
                      chunk, embed, db, indexer, search/ (lexical, vector, hybrid, passage), runtimes/ (transformers,
                      llamacpp, llama-server, ort), graph, related, mentions, glossary, stem-fr, fingerprint,
                      activation, eval (+ eval-set, eval-score), bench, compare, refdoc, schemas, inspect, pdf
src/core/search/      search.all (Ctrl K and the tests list): query, match (accents, French stems, prefixes, typos,
                      codes), tests corpus, vectors (index/tests-vectors.json)
src/core/claude/      run (claude -p), access (tool access per run kind), stream, snapshot/revert, diagnose, status,
                      chat, generate (+ gen-prompt, gen-reply), check, fix, review, columns, actions, figures, headers,
                      prompt, limits, ledger, schemas, media, study, comment
src/core/mock/        --mock: fixture Jira (jira.ts, jira/), scripted Claude (claude*.ts), fake machine, models, updates
src/shared/           Node only, used by the core and the desktop shell: run/work.ts, run/process.ts, loopback, table,
                      tests (which test a file path touches)
src/faces/            cli.ts, mcp.ts, http.ts — thin adapters over the registry, no domain logic
src/desktop/          Electron shell: main, preload, bridge (+ bridge-types), core spawn, window, log, pages/
src/ui/
  app/                routes, shell, project boot, dock, palette actions
  components/ui/      the kit — one component per control, StyleX, tokens only; the only place that renders a bare
                      <button>/<input>/<select>/<textarea>; type.ts (text styles), halo.ts (focus halo), icons.ts,
                      rowWindow.ts (long lists)
  components/         claude/, shell/, sources/ — composites shared by several screens
  screens/<screen>/   one folder per screen (documents, generate, tests, review, jobs, settings, setup, doctor);
                      screens/kit/ is the catalogue (#/kit under --mock)
  lib/data/           the data layer: client (call, the HTTP seam), query (useRead, useCommand, execute, keys),
                      events (one SSE stream → cache), autosave, provider
  lib/prefs.ts        presentation preferences (typed, localStorage); lib/theme.ts; lib/desktop.ts (the bridge)
  styles/             tokens.stylex.ts (generated) and fonts.css
models/catalog.json   the model catalog (entries, packs, measured figures)
templates/project/    copied into every project by `project init`: CLAUDE.md, .mcp.json, the runtime skills
                      (generate-tests, plan-tests, check-test, fix-test, edit-test, ask-docs, define-columns,
                      study-document, draft-comment) — product code; every Claude run refreshes the skills first
                      (lib/shipped.ts)
templates/reference/  the Syntec reference document (pack quality on every PC)
scripts/              release.ts, publish.ts, desktop.ts, install.ps1, testimus.cmd, testimus.ico, tokens.ts, icons.ts,
                      refdoc.ts, screens.ts + screens-catalog.ts (+ SCREENS.md)
tests/unit/           vitest by area (core/<zone>/, ui/<zone>/, shared/, desktop/, scripts/), helpers/, guards/
tests/e2e/            playwright (desktop/ drives Electron; kit.spec captures the catalogue)
tests/fixtures/       the LFRPS12 sample project, docx, evidence, rag, snowball-fr
.claude/skills/       dev skills: xray-cloud-api, port-from-xray-editor, docx-ingest, rag-eval
.build/, .sandbox/    build journals and test data of past passes (git-ignored)
```

## Adding a command

1. Put it in its group's file under `src/core/commands/` (a new group gets a file and an entry in `index.ts`).
   Shape: `command({ name: "<group>.<verb>", input, output, mutates, run })`. A verb says what it does; one
   responsibility; a name that lies may be renamed — update CLI, MCP, skills, tests in the same change, no alias.
2. **Every zod field carries `.describe()`**: it is the CLI help, the MCP tool description and the API doc at once.
   The output is typed too.
3. Domain work goes in `src/core/lib/` (or `rag/`, `claude/`), not in the command file. Deep modules: a small
   interface, the work behind it. No interface with one implementation, no speculative abstraction.
4. Long work → a job (`jobs.ts`), with steps and progress; cancel through `ctx.signal`, every cleanup in a `scope`.
   Waiting, retrying or spawning → `src/shared/run/` only.
5. A mutating Jira command has `dryRun` and returns its plan. A command that loses something without a dry run is
   listed in the palette's confirmation list.
6. Errors the user can act on: `UserError(message, fix, code?)`. A stable `code` when a page must branch on it.
7. Decide Claude's access: by default a `mutates: false` command is readable by every run kind; anything else is
   granted per run kind in `claude/access.ts`. Never grant Jira writes or `system.*` to a Claude run.
8. Tests: a unit test that goes through the registry (`invoke` / `call` of its name in `tests/unit/core/`), Claude,
   Jira and the network faked through `env`. `tests/unit/guards/commands-tested.test.ts` counts the commands without
   one: a ratchet that may only go down.
9. If the page needs it: `useRead("group.verb", input)` or `useCommand` / `execute`; the invalidation follows from the
   `changed` paths and job events (`lib/data/events.ts` maps paths to the reads they touch).

## Adding or changing UI

- A screen assembles kit components; it holds no data logic and no bare control. Missing control → extend the kit:
  an option first, a wrapper second, a new component last (with its reason, in the catalogue). Never copy JSX.
- Styles: `stylex.create` in the component's own file, values from `tokens.stylex.ts`, text through `type.ts`. No
  literal colour, no px size, no constant inline style, no `.css`, no `dangerouslySetInnerHTML`. A framed box is a
  `Card`. Markdown and Claude's answers render to React elements, never an HTML string.
- A new kit component or state appears in `#/kit` (`src/ui/screens/kit/`) and in `tests/e2e/kit.spec.ts`. Each kit
  component has a component test covering all its options, queried by role and label (StyleX class names are not
  stable; `data-testid` only when there is neither). Pick a select's option in tests with
  `tests/unit/helpers/select.ts`.
- Accessibility: ARIA role, keyboard, visible focus (`halo.ts`), label. A state is icon + word.
- Files over ~300 lines are split (sub-components, hooks) unless there is a written reason.
- New design tokens come from the design system: `node scripts/tokens.ts` (reads `design/tokens.css`, writes
  `src/ui/styles/tokens.stylex.ts`), then `npm run format`. `design/` belongs to the design sessions: read it, never
  write it. Values `scripts/tokens.ts` adds itself may only shrink.

## Conventions

- Ponytail style inside a file: no speculative abstraction, stdlib first. One component per file, one area per folder.
- **No code comments** except deliberate `// ponytail:` markers (the non-obvious why).
- TS stays erasable (no `enum`, `namespace`, parameter properties); imports end in `.ts`.
- Identifiers and UI text in English; generated tests in the project's language (`project.json.language`).
- Tests live in `tests/`, never beside the code.
- **Files are the truth**: a new piece of state is a readable file with one owning module, or derived and rebuildable.
  Owned writes go through `lib/atomic.ts`. Before changing a file format, check whether released copies already wrote
  projects in the old one; a changed format updates `templates/project/`, `tests/fixtures/project/`, the mock and the
  tests in the same change.
- Sources stay `docId#anchor "quote"`, quotes verbatim, anchors never positional.
- Port, don't share: code from Xray Editor is copied and adapted (skill `port-from-xray-editor`). Never edit
  `D:\Projects\XrayEditor` from here.
- The runtime skills in `templates/project/.claude/skills/` are product code: a prompt change is a code change, with
  the mock Claude (`src/core/mock/claude*.ts`) updated when the reply format moves.

## Mock and fixtures

`serve --mock` copies `tests/fixtures/project/` to a temp sandbox and fakes Jira, Claude, the machine, the models and
the updates. Knobs:

| Variable | Values |
|---|---|
| `TESTIMUS_MOCK_SEED` | `fixture` (default, the LFRPS12 sample), `empty`, `none` (first run), or a project folder of this PC (copied, never written); comma-separated, first one open |
| `TESTIMUS_MOCK_CLAUDE` | `absent`, `logged-out` |
| `TESTIMUS_MOCK_CLAUDE_MS`, `TESTIMUS_MOCK_JIRA_MS` | pace the fake Claude / Jira |
| `TESTIMUS_MOCK_JIRA_NO_COMMENT` | `1`: the fake Jira refuses comments |
| `TESTIMUS_MOCK_MAX_ATTACHMENT` | bytes |
| `TESTIMUS_MOCK_MACHINE` | `gpu16` (default), `gpu-small`, `cpu-only`, `unknown`, `dev`, `mac`, `mac-intel` |
| `TESTIMUS_MOCK_PROBE` | `ok` (default), `fail` |
| `TESTIMUS_MOCK_LLAMACPP` | `found` (default), `absent` |
| `TESTIMUS_MOCK_MODELS_DIR` | `set` (default), `unset` |
| `TESTIMUS_MOCK_ADVICE` | `upgrade` (default), `downgrade`, `offload`, `none` |
| `TESTIMUS_MOCK_INDEX` | `bm25`: start without vectors |
| `TESTIMUS_MOCK_DOWNLOAD_MS`, `TESTIMUS_MOCK_UPDATES`, `TESTIMUS_MOCK_UPDATE_MS` | fake downloads and updates |

Other variables: `TESTIMUS_MODELS` (dev models folder, `D:/Projects/Testimus/.models`), `TESTIMUS_MACHINE` (impose a
machine profile), `TESTIMUS_SHELL`, `TESTIMUS_NODE`, `TESTIMUS_API_TARGET` (Vite proxy in `--ui-dev`),
`TESTIMUS_JIRA_TOKEN` / `TESTIMUS_XRAY_SECRET` (secrets for `system.setCredentials` without the command line).

Several mock servers on `localhost` share one cookie jar and clash: give each its own port and use `127.0.0.1`.
`.claude/launch.json` holds the preview configurations.

## Proving a change (the verification bar)

Done means:
- `npm run build` clean (tsc + vite), `npm run check` clean (Biome), `npm test` green.
- `npx playwright test` green against fresh `serve --mock` servers (msedge); screens touched are captured light and
  dark in `tests/screens/`.
- The architecture guards stay where they are: `node tests/unit/guards/report.ts [--detail]`. The guards at zero stay
  at zero (`npm test` fails above); the counted ones (G2 framed boxes outside the kit, G8 token values added by
  `scripts/tokens.ts`) may only shrink.
- Anything touching Claude or Jira: the read-only live check named in the change. Real Claude runs stay sober
  (`claude -p "reply ok"` for the envelope, one full run at the end). **Never write to LFRPS12 or BHPTCC**; write paths
  are proven over a fake `http` with exact payloads.
- Desktop shell: `npx playwright test tests/e2e/desktop` and no `node.exe` / `electron.exe` left behind.
- Release script: `tests/unit/release.test.ts`, and on a built release `tests/unit/release-desktop.test.ts`; packaging
  or install: install into a fresh `-Root` with `-ShortcutDir`, `-NoPath`, `APPDATA`/`LOCALAPPDATA` pointed at a scratch
  folder, check the shortcuts, `testimus.cmd system version` and `system doctor`, start the installed `Testimus.exe
  --mock` to the Documents screen, close it, no process left.
- Never weaken or delete an assertion to make a test pass; a changed e2e test checks the same behavior.

`npm run screens [-- --out <dir>] [-- --only <scenario>]` shoots every screen, dialog and state (several sizes, light
and dark) into `dist/screens/` — the material handed to design work (`scripts/SCREENS.md`).

## Shipping

`npm run publish <x.x.x> [-- --notes "…"] [-- --to <dir>]` is the usual way: it refuses a version the team folder
already holds (before building), sets `package.json`'s version, builds the release and publishes it (folder: `--to`,
else this PC's Settings › Updates, else the channel of the installed copy in `%LOCALAPPDATA%\Testimus\install.json`).
`npm run release` builds only (`--publish`, `--channel`, `--publish-only`). See ARCHITECTURE.md §15.

## Outside this repo (on the dev PC)

Read the originals; never edit them from here. `.claude/settings.json` grants read access.

| Where | What |
|---|---|
| `D:\Projects\XrayEditor\` | the BHP editor Testimus ported from: `SPEC.md` (§3 test format, §5 module contracts, §6 sync, §7 Claude runs, §9 browser mock), `src/lib/`, `src/components/`, tests |
| `D:\Projects\Transkell\` | the template Xray Editor started from |
| `~/.atlassian/credentials.json`, `xray_credentials.json` | credentials, read in place |
| `C:\Users\s.genin\.claude\skills\xray-find\scripts\` | read-only probes of a live project (`jira_search.py`, `jira_get.py`, `xray_test_steps.py`) |
| `D:\SVN\B040L00192_Australia_BHP_TCC_Sources\.xray\` | BHP's test-authoring knowledge (house style, screenshot typologies, create/upload scripts, `pdf_catalog.py`) |
| `C:\Users\s.genin\Transurb\2_SIM - Documents\02_Projects\L.00320 - France - RATP - SOSIE\01 - Manage\01 - Client\14 - Livraisons documentaires\J5\D401-1 Specifications Fonctionnelles - J5\` | the RATP specs (copy, never open in place) |
| `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\` | `scripts/inline-figures.py`, `documentation/` (converted specs, to compare a conversion), `skills/testing/` (an interactive test sheet: HTML + `data.json`, OK / NOK per line — a model for test runs), `skills/testr4/` (running a test in the real simulator) |
| `D:\transformers-models\` | ONNX models (transformers.js layout) and GGUF embeddings/rerankers, SHA-256 checked |
| `D:\llama.cpp\b12032-cuda13\`, `b12032-vulkan\` | official llama.cpp builds |

## Machine notes (Windows dev PC)

Node 26 LTS (fnm default), npm 11, Python 3.13, Claude Code CLI on PATH. Run node tooling from the Bash tool (`npm` and
`npx` are on PATH there, not in the PowerShell tool). Write TS files with Write/Edit, never bash heredocs (they mangle
`\\` in regex literals). Worktrees: create them with `core.autocrlf=false`; remove the `node_modules` junction
(`rmdir`) before removing a worktree.
