# Testimus

Local app that turns specification documents into reviewed Xray manual tests: documents → index
(RAG) → generation with sources → anomaly check → human review → Xray sync. A Node + TypeScript core
with three faces (CLI, MCP, HTTP + React UI), wrapped in an Electron desktop shell. Claude Code
(`claude -p`) does the reading and writing.

ARCHITECTURE.md says how it is built and why, CODE.md how to work in the code, ROADMAP.md what comes next,
CLAUDE.md holds the working rules.

## Prerequisites

- Node 26 LTS and npm 11 (`node` must be on the PATH: Node runs the `.ts` sources directly)
- Claude Code CLI on the PATH, logged in (generation, check and fix go through `claude -p`)
- Optional, for local embeddings in dev: `TESTIMUS_MODELS=D:/Projects/Testimus/.models`

```bash
npm install
```

## Run the desktop app (dev)

The desktop shell starts the core (`serve`) itself and opens the window on it. It serves the built UI,
so build the UI first.

```bash
npx vite build
```

```bash
npm run desktop
```

`npm run desktop` bundles `src/desktop` into `dist/desktop` and opens Electron. Flags go after `--`:

```bash
npm run desktop -- --mock
```

```bash
npm run desktop -- --ui-dev
```

```bash
npm run desktop -- D:/path/to/project
```

- `--mock` copies `tests/fixtures/project/` to a temp folder and fakes Jira and Claude — safe to click
  anything.
- `--ui-dev` runs Vite with hot reload instead of the built UI (no `vite build` needed).
- A folder argument opens that project instead of the last one.

Shell and core logs: `%LOCALAPPDATA%\Testimus\logs\desktop-<date>.log`.

## Run in a browser (no Electron)

```bash
npm run serve:mock
```

```bash
node src/faces/cli.ts serve --project D:/path/to/project
```

Opens `http://localhost:4317`. Same UI, minus the desktop bridge (native pickers, notifications).

## CLI and MCP

```bash
node src/faces/cli.ts help
```

```bash
node src/faces/cli.ts mcp --project D:/path/to/project
```

## Checks

```bash
npm run build
```

```bash
npm run check
```

```bash
npm test
```

```bash
npx playwright test
```

`build` type-checks and builds the UI, `check` is Biome (lint + format), `test` is the unit suite
(Claude, Jira and the network are faked), Playwright runs the e2e suite against fresh `serve --mock`
servers and the Electron shell.

## Release and install on a colleague's PC

```bash
npm run release
```

```bash
powershell -ExecutionPolicy Bypass -File dist\testimus-0.1.0-win-x64\install.ps1
```

The release folder holds `Testimus.exe`, a portable Node, the bundle and the models; `install.ps1`
needs no admin rights (`-Root`, `-NoShortcut`, `-InstallClaude`… see the script).

> Never write to a production Jira project (LFRPS12, BHPTCC) during development — use `--mock` or
> `--dry-run`.
