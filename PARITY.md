# PARITY.md — Xray Editor → Testimus, capability by capability

Goal (2026-11-02): every capability a user can see, do or edit in Xray Editor (`D:\Projects\XrayEditor`) exists in
Testimus — same capability, not necessarily the same look. Built from three read-only audits over all of Xray Editor's
`src/` and `src-tauri/` (editor/sidebar/shell; Claude/settings/core; a verification of every gap found), each row
checked against the Testimus code and its tests. Status after the fixes of 2026-11-02: **every row OK**. "Design" in
a note means Testimus reaches the same capability another way, on purpose (SPEC wins).

## Editor (Xray Editor `components/editor/TestEditor.tsx`, `app/App.tsx`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 1 | Auto-save 400 ms after the last edit; on window blur, editor blur, unmount | TestEditor.tsx (flush, timer) | OK |
| 2 | Reload test.md changed on disk, on window focus; a failed reload is a toast | TestEditor.tsx (mtime), toast « Reloaded from disk » | OK |
| 3 | Late callbacks ignored after a reload or a test switch | TestEditor.tsx `alive()` generation token | OK |
| 4 | Test bar: key, summary, busy text (Refreshing from Jira…, Claude is editing…) | TestHeader.tsx `activity`, `readOnly` | OK |
| 5 | Ask Claude on the test | TestHeader.tsx | OK |
| 6 | Push disabled while any Claude run, while the plan is open, or with no local change since the last sync (even if Jira changed) | TestEditor.tsx `canPush`, TestHeader.tsx `pushing` | OK |
| 7 | One push at a time, refused while Claude runs | TestEditor.tsx, PushDialog.tsx | OK |
| 8 | Push dialog: plan, warnings, per-op state, Nothing to push, retry from the failed op, Do not close | PushDialog.tsx | OK |
| 9 | ⋯ Clone | TestEditor.tsx menu, TestList.tsx | OK |
| 10 | ⋯ Download from Jira (keyed test) with confirm and loss box | TestEditor.tsx | OK |
| 11 | ⋯ Undo local changes with counts; guard re-checked on confirm; snapshot written; reload; Claude marks cleared | TestEditor.tsx `undoLocal`, `tests.restore`; e2e parity-editor | OK |
| 12 | ⋯ Open in Jira ↗ | `xray.browse` | OK |
| 13 | ⋯ Delete local copy, red, own separator, always confirmed (sidebar ✕: only when it matters) | Menu.tsx `danger`, DeleteTest.tsx | OK |
| 14 | Restore one step / bring a deleted step back, missing-screenshot warning | StepCard.tsx, WasView.tsx | OK |
| 15 | Editor read-only during any Claude run (this test, another, the whole project) | TestEditor.tsx `busy`, `PROJECT_RUN`; Push says « Claude is working — wait for it to finish » | OK |
| 16 | Summary single line | TestHeader.tsx | OK |
| 17 | Details / Hide details, remembered | TestHeader.tsx, `testimus.showDetails` | OK |
| 18 | Jira status chip, « cloned from » chip | TestHeader.tsx | OK |
| 19 | Folder chip → input with the Xray folders | TestHeader.tsx, `xray.folders` | OK |
| 20 | Labels / Covers chip inputs | TestHeader.tsx, ChipInput.tsx | OK |
| 21 | Preconditions: attach from the project's list, detach, read-only panel with definitions | TestHeader.tsx, `xray.preconditions`, `tests.edit` | OK |
| 22 | Preconditions asked when a test opens, folders when the picker opens; each failed load a toast, asked again next time | TestEditor.tsx, TestHeader.tsx `onFolders` | OK |
| 23 | Claude contexts per test: attach, detach, reset to project defaults, Manage contexts… | TestHeader.tsx, `contexts.ofTest/setTest` | OK |
| 24 | Description | TestHeader.tsx | OK |
| 25 | Steps header with count; Stacked / Action \| Expected layout, remembered | TestEditor.tsx | OK |
| 26 | Editor column resizable from both edges, double-click resets, remembered | TestEditor.tsx, DragEdge.tsx | OK |
| 27 | Drag a step to reorder; delete with Undo; Add step; empty state « Add first step » | TestEditor.tsx | OK |
| 28 | Steps changed by Claude marked; Revert | TestEditor.tsx, ClaudeDock.tsx | OK |
| 29 | « No test open » pane; a test that fails to open says so | TestsScreen.tsx, TestEditor.tsx | OK |
| 30 | Sync badge: checking… / changed in Jira / conflict (→ download), re-checked on every open | TestHeader.tsx, `xray.status` | OK |

## Step card, fields, tables, columns (Xray Editor `StepCard.tsx`, `FieldBlocks.tsx`, `TableBlock.tsx`, `ColumnsMenu.tsx`, `lib/columns.ts`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 31 | Grip drags only from the handle | StepCard.tsx | OK |
| 32 | Step number; changed by Claude / modified / new badges; « not fully read — never pushed » | StepCard.tsx | OK |
| 33 | « Jira version » toggle → read-only snapshot + Restore this step | StepCard.tsx, WasView.tsx | OK |
| 34 | Per-step column fold toggle, « ● » when folded but filled | StepCard.tsx | OK |
| 35 | Ask Claude on a step | StepCard.tsx | OK |
| 36 | Up / down, insert after, delete; Ctrl+Enter inserts, Alt+↑/↓ moves | StepCard.tsx | OK |
| 37 | The step last worked on keeps its ring (also when marked or red, while focus is elsewhere; none while dragging; moves to the next step after a delete) | StepCard.tsx `focused`, tests.css | OK |
| 38 | Split layout column widths (Expected 1.25fr when Action is the only other field, project columns or not) | columns.ts `splitTracks` | OK |
| 39 | Paste an image onto a field / at the caret | StepCard.tsx, FieldBlocks.tsx | OK |
| 40 | Attachments not embedded: drag into a field, open, ✕ with Undo, file deleted when the toast expires | StepCard.tsx, `tests.removeImage` | OK |
| 41 | Remove a text / table / image block with Undo; move blocks within and across fields | StepCard.tsx, FieldBlocks.tsx | OK |
| 42 | Strips above/below every block: + text / + image / + table, drop targets; draft caret | FieldBlocks.tsx | OK |
| 43 | Image block opens the viewer; outside link; dead `blob:` link message; raw Xray markup in a details | FieldBlocks.tsx | OK |
| 44 | Table: ✕ per column/row, + row / + column, cells are full fields | TableBlock.tsx | OK |
| 45 | Project columns: single line, multi-line, read-only, « not in Xray » | ColumnField.tsx, columns.ts | OK |
| 46 | Columns popover: this test / whole project; open / when filled / collapsed; use project's; follow the project | ColumnsMenu.tsx, `tests.setColumns`, `xray.prefs` | OK |
| 47 | Column switched off in Xray: kept, « off in Xray », folded unless filled, can be set open | jira.ts `getStepFields`, columns.ts `off`, `prefs.open` | OK |
| 48 | Data folded unless filled by default | fields.ts `filled: ["Data"]` | OK |
| 49 | Image viewer: zoom at the cursor, + / −, pan, fit (0 / double-click), ← →, n of N, Esc | Lightbox.tsx | OK |

## Sidebar and shell (Xray Editor `Sidebar.tsx`, `TopBar.tsx`, `App.tsx`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 50 | Local / Jira tabs with counts | TestList.tsx | OK |
| 51 | Recent tests (7 days, time ago, this project) | RecentList.tsx, recent.ts | OK |
| 52 | New local test (in the selected Jira folder) | TestList.tsx | OK |
| 53 | Two boxes: « Search Jira » (any text jumps to the Jira tab and asks Jira) and « Filter tests » (local tests, Jira folders, listed Jira tests) | TestList.tsx, JiraTab.tsx | OK |
| 54 | Local row: state, key, summary, ✕ delete (asks only when changed or never pushed) | TestList.tsx | OK — badges instead of rails |
| 55 | Jira folder tree: open/close, root, direct/total counts | JiraTab.tsx | OK |
| 56 | List head « x of y » / « n found », placeholders, infinite scroll, « all N loaded » | JiraTab.tsx | OK |
| 57 | Jira row: key, status, step count / pulling…, local copy state, « Not pulled yet » | JiraTab.tsx | OK |
| 58 | Sidebar resize 240–480, double-click resets, remembered | TestsScreen.tsx | OK |
| 59 | Narrow window: the list becomes a drawer | TestsScreen.tsx; e2e narrow.spec | OK |
| 60 | A dropped file outside a field never navigates away | App.tsx | OK |
| 61 | Pull queue pane: progress, waiting for a slot, Cancel, N more, Retry / Back; a landed pull opens only if watched | PullPane.tsx, pulls.ts | OK |
| 62 | Pulls dropped when the project changes | TestsScreen.tsx | OK |
| 63 | Activity: spinner + count, popover with elapsed time and Cancel, on every screen | Activity.tsx in TestList, the narrow Tests bar and ScreenHeader | OK |
| 64 | « Rate limited — waiting Ns » for any request | jira.ts `rateLimit`, jobs.ts `notice`, Activity.tsx | OK |
| 65 | Always on top (pin) | OnTopToggle.tsx, AppearanceSection.tsx (desktop) | OK |
| 66 | Open a project; recent projects; first-run connection screen | ProjectButton.tsx, setup screens | OK — design: project folders |
| 67 | Toasts: max 3, countdown on the action, errors stay | toast.ts, Toasts.tsx | OK |
| 68 | Dialogs, menus, chip inputs, resize handles, auto-growing text areas | components/ui | OK |
| 69 | Window down to 520 × 600 beside Jira; every screen usable; the open Claude dock floats | window.ts `MIN_SIZE`, @media rules; e2e narrow.spec | OK |

## Claude (Xray Editor `components/claude/*`, `lib/claude.ts`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 70 | Dock scope: step N / this test / whole project | ClaudeDock.tsx | OK |
| 71 | Quick-ask chips fill the prompt | ClaudeDock.tsx | OK |
| 72 | Per-run context opt-out chips | ClaudeDock.tsx | OK |
| 73 | Prompt box: Ctrl+Enter sends, Enter is a new line; model (incl. custom) and effort per run | ClaudeDock.tsx, ModelPicker.tsx | OK |
| 74 | Running timer + Cancel killing the process tree | ClaudeDock.tsx, env.ts | OK |
| 75 | One run at a time | ClaudeDock.tsx | OK |
| 76 | Result: steps changed, summary, duration, cost, model/effort, session | ClaudeDock.tsx | OK |
| 77 | Show raw output after every run; Retry and Open Settings after a failure | ClaudeDock.tsx | OK |
| 78 | Revert Claude's changes, also after a failed run | ClaudeDock.tsx, `claude.revert` | OK |
| 79 | A cancelled run: changes folded back into the editor, Revert offered | api.ts `waitJob` (result kept), ClaudeDock.tsx | OK |
| 80 | After any run on the open test the editor reads the file back (also a header-only fix, or no change) | TestEditor.tsx, fix.ts `changedTests` | OK |
| 81 | Trouble diagnosis in plain words | diagnose.ts | OK |
| 82 | Not connected: badge, connect panel, Check again, Set the path myself, last run | ClaudeDock.tsx, ConnectClaude.tsx | OK |
| 83 | `claude -p` with acceptEdits, tools, `--add-dir` for context paths | run.ts | OK |
| 84 | Prompt: scope, step-only rule, contexts, « reply in 2-4 lines » | prompt.ts | OK |
| 85 | Contexts dialog: list, create, name, notes autosave, paths (Browse), files, delete | ContextsDialog.tsx, `contexts.*` | OK |
| 86 | Contexts shared by all projects | « New context » is shared (library in the data folder); « Shared with every project » unticked keeps one in the project; `contexts.copy` | OK |
| 87 | Per-test contexts, null = follow the project | `contexts.ofTest/setTest` | OK |
| 88 | Default quick ask « Rephrase in house style » | project.ts `STARTER_ASKS` | OK |

## Settings and connection (Xray Editor `components/settings/*`, `lib/jira.ts`, `lib/store.ts`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 89 | Credential files: path, found / invalid / missing (with the problem) | AccessSection.tsx, creds.ts | OK |
| 90 | Guided Atlassian form (site, email, token, Client ID, secret) | ConnectAtlassian.tsx | OK |
| 91 | Site cleanup (tenant, host, any page URL, http → https, path dropped, typed /wiki kept), « Will be saved as »; any site can be saved — UI and CLI | ConnectAtlassian.tsx (`otherHost`), system.ts `siteUrl` | OK — `/wiki` added for *.atlassian.net (SPEC §2) |
| 92 | Form prefilled with every saved value, secrets hidden until Show; sends only what changed | `system.secrets` (off MCP, denied to runs) | OK |
| 93 | Open API tokens / Open Jira apps links; « only a Jira admin » | ConnectAtlassian.tsx | OK |
| 94 | Save merges into the files, keeps unknown keys, written atomically; then a Jira + Xray check in words | creds.ts, system.ts | OK |
| 95 | « Saved in ~/.atlassian » reveals the folder | ConnectAtlassian.tsx (desktop) | OK |
| 96 | Workspace / project folder: browse, open in Explorer; reopen last at launch | ProjectButton.tsx, setup, project.ts | OK — design: several projects |
| 97 | Claude program path + Check + status line; install / sign-in panel | ClaudeSection.tsx, ConnectClaude.tsx | OK |
| 98 | Default model / effort, quick asks edited, default contexts | ClaudeSection.tsx | OK |
| 99 | Project notes = project CLAUDE.md, autosaved, written atomically | ProjectSection.tsx, `project.notes/setNotes` | OK |
| 100 | Theme system / light / dark | AppearanceSection.tsx | OK |
| 101 | Preferences survive a restart (theme, on-top, layout, widths, recent tests) | desktop reuses its last port; the page's `testimus.*` keys are mirrored into settings.json (`ui`) and put back on a new origin | OK |
| 102 | Version badge | SettingsScreen.tsx | OK |

## Jira / Xray core (Xray Editor `lib/jira.ts`, `lib/sync.ts`, `src-tauri`)

| # | Capability | Testimus | Status |
|---|---|---|---|
| 103 | Rate limit: 6 in flight, wait out 429 (≤ 120 s), 3 retries, final message | jira.ts | OK |
| 104 | Jira 401/403/404 messages; Xray re-login on 401 | jira.ts | OK |
| 105 | Folder tree with totals; search by key, digits, linked issues; preconditions | `xray.folders/search/preconditions` | OK |
| 106 | Pull 3 at a time, reuse known images, undo on cancel/failure, `.remote.md` | sync.ts, `xray.pull` | OK |
| 107 | Check against Jira on every open | `xray.status` | OK |
| 108 | Step columns re-read on project open and before every push, cached fallback | App.tsx, sync.ts `freshXray` | OK |
| 109 | Push plan: create, links (never removed), update, move, preconditions, in place vs rebuild, images, raw-markup refusal, warnings (unknown column only when it holds something) | jira.ts `planPush` | OK |
| 110 | Warning: a required Xray column empty in a step | jira.ts `planPush` | OK |
| 111 | Non-text columns kept as JSON and sent back parsed | jira.ts `customText/customValue` | OK |
| 112 | Execute op by op, key saved at once, folder renamed, re-pull, resume from the failed op | sync.ts, `xray.push --from` | OK |
| 113 | Every file written atomically (tmp + rename, tmp removed on failure), file and folder copies included | lib/atomic.ts `writeAtomic`, `copyDirAtomic`; a unit test fails on any file write, copy or append (sync or async) in src/core outside atomic.ts, the job logs, the mock and the model files | OK |
| 114 | CSV | Xray Editor has none; Testimus adds `xray.importCsv` | n/a |

## Proof

Every row is driven by at least one automated test that acts (click, key, command) and asserts the outcome — a
read-only mapping of the 114 rows to the tests found 92 covered and 22 partly or not covered; those 22 got their test
(2026-11-02): #1, #6, #11, #15, #17, #25 in `tests/unit/cov-uitests-editor.test.tsx` (and `cov-uitests-header`), #37
in `tests/e2e/editor.spec.ts`, #45 in `cov-uitests-columns`, #48 and #88 in `project.test.ts`, #51 and #63 in
`ui-sidebar.test.tsx`, #74 in `cov-faces-env` (Windows), #78 in `cov-uishell-dock`, #80 in `cov-core-claude-runs`,
#94, #99, #113 in `cov-core-atomic.test.ts`, #101 in `desktop/cov-desktop-main` and `serve-desktop`, #103 and #104 in
`cov-core-jira`, #106 in `sync.test.ts`, #108 in `cov-core-sync`. Two of them found real gaps, fixed: Push stayed
enabled while the push plan was open (#6), and the focused step's highlight was hidden by the modified / Claude marks
(#37). A second independent pass, Xray Editor's code against Testimus's tests row by row, found 18 rows whose test did not fully
assert the behaviour, 6 of them real differences (#37, #38, #73, #77, #80, #113) plus #22, #86 and #101: all aligned on
Xray Editor and tested. A fourth, targeted pass confirmed those rows and led to the last alignments (#2 toast on a failed reload, #91 CLI cleanup,
#15 tooltip). A third pass (all 114 rows) found 105 proven and 8 to fix (#6, #13, #15, #22, #37, #53, #91, #113, and the #109 warning):
aligned and tested. The last alignments: #53 now has Xray Editor's two boxes, and folder copies are atomic (#113). On 2026-11-02, after the last
change, `npm test` and `npx playwright test` (browser and desktop, the Electron shell rebuilt) pass in full (also with six of the specs'
preferred ports held by other processes); SPEC.md §12–§13 describe each row.
