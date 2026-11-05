# CLAUDE.md — Testimus project

This folder is a Testimus project: the specification documents of a product, the Xray manual tests
written from them, and what the team knows about both. Testimus (the app) and you work on the same
files. The work goes:

1. **Documents** are added and converted to markdown with stable anchors, then indexed (locally).
2. **Generation** writes new tests from the documents, every claim with its source (`review: draft`).
3. **Check**: a mechanical pass (sources resolve, quotes are verbatim) then a semantic one (does the
   passage say what the step claims?). The check writes findings; it never changes the review state.
4. **Review**: a person validates the test (`validated`) or sends it back with a note (`to-fix`);
   a fix run corrects it from the note and the findings.
5. **Xray sync**: tests are pulled from and pushed to Jira; the review state travels as a label.

You may be the one doing step 2, 3 or 4 (Testimus starts you with `claude -p`), answering a question
about the documents, or a person working in a terminal in this folder. This file is read every time.
The rules below hold for any product, any domain and any language; what is particular to this
project is in **Team notes** at the end.

## What is here

- `docs/<docId>/` — one document: `doc.md` (the converted text), `figures/` (its pictures, in reading
  order) and `figures.json` (what each one shows and the text visible in it), `doc.json` (title,
  version, `kind`, `status` draft · submitted · validated, `amends`: the documents it amends, the
  `contexts` read with it; `converted`: what the last conversion found, its `warnings` included),
  `context.md` when the team wrote one — what it says about the document; read it before using the
  document (`docs_show` returns it as `context`).
- `tests/<id>/test.md` — one test (format below); `images/` its pictures; `check.json` its last
  check's findings; `local.json` the test's own settings (its contexts, how its columns fold), never
  part of the test. `<id>` is the Jira key once pushed (`PROJ-123`), `local-<hex>` before.
- `contexts/<id>/` — reference material the team attaches to runs: `context.md` (a frontmatter with its
  `name` and the `paths` outside the project it points at, then its notes), and `files/`. A shared library of contexts lives outside the project, for every project.
- `project.json` — Jira project, the language of the tests, Xray folders, review label prefix, the
  default Claude model and effort, the contexts every run reads.
- `columns.json` — the step columns in their order: Xray's step fields and the project's local
  columns, each with the description you follow to fill it and how it shows (see **Smart columns**).
- `xray.json` — Xray's step fields as Xray last gave them (read again from Xray, never edited).

Derived files, never edited by hand: `index/`, `.testimus/`, `tests/*/.remote.md`,
`tests/*/check.json`.

## What a run may do

Testimus starts you for one job, with only the tools that job needs. The prompt says the job, its
`Scope:` and `Files:`; stay inside them.

| Run | Skill | May change |
|---|---|---|
| Ask the documents (chat) | `ask-docs` | nothing |
| Generate tests | `plan-tests` for a large scope, then `generate-tests` | new tests |
| Check a test | `check-test` | nothing; findings go through `check_record` |
| Fix a test (To fix note) | `fix-test` | that test |
| A request on a step, a test or a set of tests | `edit-test` | the tests in scope |
| Study a document / check its conversion | `study-document` | nothing; may propose actions |
| Look at a document's warnings or a failed job | — | nothing; may propose actions |
| Propose the step columns | `define-columns` | nothing (the team saves the proposal) |
| A Claude action (see below) | — | what the action's plan says, through the app's commands |

Files outside `tests/` are never edited directly in a run: `docs/`, `index/`, `.testimus/`,
`contexts/`, `.claude/`, `project.json`, `xray.json`, `columns.json`, `.mcp.json` and this file are refused. What the
app lets a run change there (a document's status, a column's description, a context) goes through
its command, like a button would.

## Tools

The `testimus` MCP server gives you the app's commands as `<group>_<verb>` (`mcp__testimus__rag_search`
in permission lists; `testimus help` lists them all). Prefer them to guessing:

- **Find in the documents**: `rag_search` (passages for a question or a feature), `rag_mentions`
  (every passage naming a term, code or acronym — exhaustive, no model), `rag_related` (what a
  requirement or a section is linked to: where it is defined, traced, amended), `rag_passage` (the
  exact text and figures of `docId#anchor`), `rag_figure`, `docs_list`, `docs_show`, `docs_page`
  (a page of the original PDF as an image). Read `doc.md` directly to confirm: the index finds, the
  file proves. The index is local and may lag behind a newly added document: `rag_status` says which
  documents are indexed; fall back to `Grep` and `Read` on `docs/*/doc.md`.
- **Tests**: `tests_list`, `tests_show`, `search_all` (find existing tests before writing one that
  may already exist), `columns_list` (the smart columns and their descriptions), `check_show`,
  `review_queue`, `review_evidence` (what a generation read for a test, and what it should have).
- **Writing tests** (generation, fix, edit runs only): `tests_create`, `tests_edit`, `tests_save`,
  `tests_addImage`; `check_run` (from a Claude run it does the mechanical pass only — you are the
  semantic check).
- **Context**: `contexts_list`, `contexts_show`, `contexts_ofTest`; `actions_list`.
- **Xray** (read): `xray_search`, `xray_status`, `xray_folders`, `xray_preconditions`, `xray_plan`.

**Never call a tool that writes to Jira** (`xray_push`) unless the
user asked for it in this conversation. To push: call `xray_plan` first, show the user the plan, then
call `xray_push` with the `planHash` that `xray_plan` returned (a push without it, or after the test or
Jira changed, is refused — plan again). Pass `overwriteRemote: true` for a test changed in Jira only
when the user asked to replace that Jira change with the local version.

## Smart columns

Every step is made of columns, and every column is a **smart column**: its description in
`columns.json` (`columns_list` shows them) says what goes in it, and that description is the whole
rule. No column is special and none is known by its name: `Action`, `Data`, `Expected Result`,
custom Xray step fields (a requirement code, a priority, test data…) and **local columns** (kept in
`test.md`, never pushed to Xray) are all filled the same way — by doing what the description asks.

- A column with an empty description stays empty: never write it.
- A column marked **Reference source** needs one `### Sources` line per item it holds (below), so the
  tester can click the item and see its passage.
- Leave a field out of a step when it has nothing to say.
- When a run's prompt lists the column descriptions, they are the current ones: the prompt wins.

## test.md

The example is neutral; real tests are written in the language of `project.json` (`language`), in the
words of the documents.

```markdown
---
summary: Report export — PDF of the selected period
folder: /Reports/Export
labels: []
review: draft
---

## Description

What this test verifies and the technique used (equivalence classes, boundary values, state
transitions, a nominal path and its error paths…).

## Step 1

### Action

Open the monthly report, choose a period and click Export, then PDF.

### Expected Result

A PDF file is downloaded; its first page shows the chosen period.

![](images/img-3f9a2c1d.png)

### Requirement

REQ-EXP-012

### Sources

- SPEC_REPORTS#§4.2 "The PDF export covers the selected period only"
- SPEC_REPORTS#req:REQ-EXP-012 "The user can export any report as PDF" @Requirement "REQ-EXP-012"
- SPEC_REPORTS#fig:7 "Figure 7 – Export dialog"

### Attachments

- images/img-3f9a2c1d.png (SPEC_REPORTS#fig:7)
```

- Frontmatter: `summary`, `folder` (an Xray repository folder: `xray_folders`), `labels` (the team's
  own; the review label is never written here — the app adds it on push from `review`); once in
  Jira also `key`, `project`, `status`. `covers` and `preconditions` list Jira issue keys — only keys
  that exist (`xray_preconditions` lists the project's preconditions).
- `review`, `review_note`, `reviewed_by`, `reviewed_at`, `generated_by` belong to the app and the
  reviewers: never change them. A test is validated by a person, never by a run.
- Field headings (`### <Column>`) are the smart columns, in the order of `columns.json`. In the example
  `Requirement` is a custom column with Reference source on; a project without it has no such
  heading.
- No reference inside a column's text (no « see §4.2 » in Action or Expected Result): references go
  in `### Sources`, and in a column whose description asks for them (a requirement code column).
- Keep `<!-- id -->` on step headings and `### Attachments` lists as they are; renumber `## Step N`
  in order. A line of text starting with `#` or equal to `---` is escaped with `\`.

### Sources

One line per claim: `- <docId>#<anchor> "<short quote copied exactly from doc.md>"`.

- Anchors: `§<number>` for a section (`§4.2`, or the title's slug for an unnumbered one), `req:<id>`
  for a requirement id the project tracks, `fig:<n>` for a figure (the quote is its caption),
  `page:<n>` for a page of a PDF document.
- The quote must be verbatim in `doc.md` **inside the cited passage** (the section with its
  subsections, the requirement's statement, the figure's caption). Long enough to be unique there —
  at least four words. The mechanical check rejects anything else.
- A line that backs one item of a column ends with that column and the item as the cell writes it:
  `@<Column> "<item>"`.
- Every expected result has a source. No source, no expected result: report the gap instead of
  inventing behavior. A behavior the product does not implement (« not simulated », « out of scope »)
  is written only when a document says so.
- What only a figure shows is cited as `fig:<n>` after reading the image (`rag_figure` or `Read`).

### Pictures

A document figure goes into a step with `tests_addImage` (`figure: "<docId>#fig:<n>"`) — in the
Action when it shows where to act, in the Expected Result when it shows what to see. It writes the
`![](images/…)` line and the `### Attachments` entry naming the figure it came from.

## Contexts

A run may come with contexts: the prompt names each one (its `context.md`, its files, outside paths).
Read them before you start; they are reference material, never edited. Which ones apply is chosen by
the team: the project's defaults, a test's or a document's own list, and per run. A document's
`context.md` is what the team knows about that document.

## Claude actions

A problem you notice and could fix in a later run (a figure lost in conversion, a finding you can
correct, a weak source) can be left as a **Claude action**: `actions_propose` with a title (a verb
first), the problem, why you can fix it, a short plan, its scope, and the model and effort the fix
needs. The user sees it in the Actions tab of Ask Claude and runs it when they choose (`actions_list`
shows the open ones; a problem the user dismissed stays dismissed). Propose only what you could
really fix; one action per problem.

## Models and effort

Each run uses the model and effort the user chose for it (the project default, a preset, or a choice
for that run). When you propose an action, ask for the least it needs: **haiku** for a mechanical
change, **sonnet** for ordinary test edits, **opus** for reading documents and judging; effort
**low** for one obvious change, **medium** for a few, **high** for a real search, **xhigh** for a long
or delicate one.

The search models (embedding, reranker) are local: documents never leave the machine except inside
your runs.

## Documents disagree

Use `doc.json`: an amendment (`amends`) wins over what it amends, and a `validated` document over a
draft. When that does not settle it, say so in the test description and flag it in your report —
never pick silently.

## Team notes

<!--
What is particular to this project — Claude reads it in every run. For example:
- The product and its users: what the software does, who uses it, on which screens.
- Vocabulary: the names the screens use, acronyms, words not to confuse.
- Documents: which ones are the reference, which are drafts or minutes, known errors in them.
- Test style: one gesture per step or a short flow, how much detail an Expected Result needs,
  data to use, what a tester can and cannot observe.
- Scope: features not to test, environments, what is not implemented yet.
- Columns: anything the column descriptions cannot say on their own.
-->
