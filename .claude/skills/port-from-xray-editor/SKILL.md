---
name: port-from-xray-editor
description: Recipe for moving a module, component, style sheet or test from D:\Projects\XrayEditor into Testimus — what to copy, what must change (generic step fields, Sources section, the Tauri api seam replaced by the core or the HTTP client), and how to prove the port. Use whenever Testimus code is being written that Xray Editor already has.
---

# Porting from Xray Editor

Xray Editor (`D:\Projects\XrayEditor`) is the proven base. Testimus copies from it; it never edits it
and never imports from it.

## Before copying

1. Read the module's contract in `D:\Projects\XrayEditor\SPEC.md` §5 and its notes in that project's
   `CLAUDE.md`, then the source and its tests in `tests/unit/`.
2. Find where it lands in Testimus (CODE.md « Layout ») and which ARCHITECTURE.md section changes its behavior.

## What lands where

| Xray Editor | Testimus | Change |
|---|---|---|
| `src/lib/testfile.ts`, `table.ts`, `adf.ts` | `src/core/lib/` | `Step` gets `fields: Record<string, string>` instead of `action/data/result`; `### Expected` read as `Expected Result`; new `### Sources` section and `review*` frontmatter keys (SPEC §6) |
| `src/lib/jira.ts`, `sync.ts` | `src/core/lib/` | steps read and write custom fields; review label on push; everything else unchanged |
| `src/lib/store.ts` | `src/core/lib/project.ts` | one project folder instead of `<workspace>/<PROJECT>`; `project.json`, `xray.json` |
| `src/lib/claude.ts` | `src/core/claude/` | `stream-json` instead of `json`; `--mcp-config`; chat sessions |
| `src/lib/api.ts` (Tauri seam) | gone | core code calls `node:fs` / `fetch` / `child_process` directly; the UI gets `src/ui/api.ts`, a typed client of `/api/<group>/<verb>` |
| `src/lib/api.mock.ts` | `src/core/mock/` | backs `testimus serve --mock` and the e2e tests |
| `src/lib/activity.ts` | core jobs + `src/ui/` | progress comes from the job stream (SSE) |
| `src/components/**`, `src/styles/**` | `src/ui/components/**`, `src/ui/styles/**` | fields drawn from `xray.json` (order, folded, hidden); `Sources` strip; review badge |

## Rules

- Copy the tests with the module and make them pass before changing behavior; then change behavior
  with new tests. The round-trip property of `testfile` (byte-lossless) must survive the port.
- Keep Xray Editor's hard-won details (paging, 429 back-off, image remapping, `raw`/`extern` blocks,
  wiki tables as slices of the field string). If one looks unnecessary, read why in its SPEC before
  dropping it.
- Strip anything Tauri: no `@tauri-apps/*` import survives.
- Header of a ported file: none (no comments rule). Mention the origin in the change description
  instead.

## Proof

`npm test` green including the ported tests; for UI, the e2e that covered it in Xray Editor ported
and green against `serve --mock`.
