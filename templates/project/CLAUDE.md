# CLAUDE.md — Testimus project

This folder is a Testimus project: the specification documents of a product, the Xray manual tests
written from them, and what the team knows about both. Testimus (the app) and you work on the same
files.

You are here for one job at a time. Testimus starts you with a prompt that names the job, what it
is about and what goes with it (what to read first, what the team knows about the documents, what
is left out of the run), and gives you only the tools that job needs. Each job has a skill in
`.claude/skills/`: the prompt names it, and the skill says how the job is done. A person may also
work with you in a terminal in this folder, with the same rules.

Everything above **Team notes** is Testimus' and follows the app. What is particular to this
project is in Team notes, at the end: it wins over the generic rules.

## What is here

- `docs/<docId>/` — one document: `doc.md` (its text, with anchors), `figures/` and `figures.json`
  (its pictures and what each one shows), `doc.json` (title, version, `status` draft · submitted ·
  validated, `amends`: the documents it amends), `context.md` when the team wrote one — what it
  knows about the document (`docs_show` returns it as `context`). Photos and videos of the real
  system are documents too (anchors `img:<n>`, `t:mm:ss`, `frame:mm:ss`): they are **observed** —
  how the system behaves and how a step is done, never what is required — unless the team marked
  the document as the reference (`doc.json` `reference: true`).
- `docs/OVERVIEW.md` — how the documents fit together. Background to find your way, never a
  source: cite the documents themselves.
- `tests/<id>/test.md` — one test (format below); `images/` its pictures; `check.json` its last
  check; `local.json` its own settings, never part of the test. `<id>` is the Jira key once pushed
  (`PROJ-123`), `local-<hex>` before.
- `contexts/<id>/` — reference material the team attaches to runs (`context.md`, `files/`).
- `test-runs/<run>/` — what the testers found when they ran the tests (`runs_list`, `runs_show`,
  `runs_history`). A result is a tester's finding: never write one.
- `project.json` (Jira project, language of the tests, Xray folders), `columns.json` (the step
  columns and what goes in each), `xray.json` (Xray's step fields).

Only `tests/` is edited by hand, and only by a run whose job is to write tests. Everything else —
`docs/`, `index/`, `.testimus/`, `contexts/`, `test-runs/`, `.claude/`, the `.json` files, this
file — is refused to Edit and Write: what the app lets a run change there goes through its command,
like a button would.

## Finding and proving

- **The index finds, the file proves.** `rag_search` gives passages for a question or a behavior;
  `rag_mentions` every passage that names a term, a code or an acronym — exhaustive, no ranking;
  `rag_related` what a section is linked to: its sub-sections, the references both ways, its
  figures, the documents that amend it; `rag_passage` the text and figures of `docId#anchor`. A
  quote is copied from `docs/<docId>/doc.md` itself.
- **Independent calls go in the same turn.** Three terms to look up are three `rag_mentions` calls
  sent together, not one after the other: every turn costs the whole conversation again.
- **A fact only a picture shows** is read on the picture: `rag_figure`, then `Read` the image. A
  figure's description in the index is a summary: it tells you what to look for.
- **Only the documents are sources.** Never fill a gap from what you know of the field, nor from
  memory of a passage you did not open in this run. What no passage states is said as a gap.
- The index is local and may lag behind a newly added document (`rag_status`); fall back to `Grep`
  and `Read` on `docs/*/doc.md`.

## test.md

The example is neutral; real tests are written in the language of `project.json` (`language`), in
the words of the documents.

```markdown
---
summary: Report export — PDF of the selected period
folder: /Reports/Export
labels: []
review: draft
---

## Description

What this test verifies, the technique used (equivalence classes, boundary values, state
transitions, a nominal path and its error paths…) and what the tester starts from.

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

- Frontmatter: `summary`, `folder` (an Xray folder: `xray_folders`), `labels` (the team's own);
  once in Jira also `key`, `project`, `status`, `assignee` (copies of Jira's). `covers` and
  `preconditions` list Jira keys that exist.
- `review`, `review_note`, `reviewed_by`, `reviewed_at`, `generated_by` belong to the app and the
  reviewers: never change them. A test is validated by a person, never by a run.
- `### <Column>` headings are the step columns, in the order of `columns.json`; a column with
  nothing to say is left out of the step. `Requirement` above is an example of a custom column.
- No reference inside a column's text (no « see §4.2 »): references go in `### Sources`, and in a
  column whose description asks for them.
- Keep `<!-- id -->` on step headings and the `### Attachments` lists as they are; renumber
  `## Step N` in order. A line of text starting with `#` or equal to `---` is escaped with `\`.

### Sources

One line per claim: `- <docId>#<anchor> "<short quote copied exactly from doc.md>"`.

- Anchors, as `doc.md` writes them: `§<number>` a section (the title's slug for an unnumbered
  one), `req:<id>` a requirement, `fig:<n>` a figure (the quote is its caption), `page:<n>` a page
  of a PDF, `img:<n>` · `t:mm:ss` · `frame:mm:ss` an image, a transcript line, a frame of an
  observed document.
- The quote is verbatim — same words, accents, apostrophes and punctuation, no ellipsis — and it
  is **inside the cited passage** (the section with its sub-sections, the requirement's statement,
  the figure's caption). Long enough to point at one place: at least four words. The mechanical
  check rejects anything else.
- A line that backs one item of a column ends with that column and the item as the cell writes it:
  `@<Column> "<item>"`.
- **Every expected result has a source. No source, no expected result**: say the gap instead of
  inventing behavior. « Not implemented », « not simulated », « out of scope » are written only
  when a passage or a document's `context.md` says so.
- A source in an observed document backs how a step is done, never an expected result on its own.

### Pictures

A document figure goes into a step with `tests_addImage` (`figure: "<docId>#fig:<n>"`) — in the
Action when it shows where to act, in the Expected Result when it shows what to see. It writes the
`![](images/…)` line and the `### Attachments` entry; never copy an image or write them by hand.

## Step columns

Every step is made of columns, and each column is filled by doing what its description says
(`columns_list`, or the list in the prompt, which wins). No column is special and none is known by
its name: `Action`, `Data`, `Expected Result`, a custom Xray field, a column kept in `test.md` only.

- A column with an empty description stays empty: never write it.
- A column marked **Reference source** needs one `### Sources` line per item it holds, ending
  `@<Column> "<item>"`, so the tester clicks the item and sees its passage.

## When documents disagree

An amendment (`doc.json` `amends`) wins over what it amends, a `validated` document over a draft.
When that does not settle it, say so — in the test's description, in the finding, in the answer —
and never pick silently.

## Jira

No run writes to Jira. A person working in a terminal may ask for a push: `xray_plan` first, show
the plan, then `xray_push` with the `planHash` it returned. Moving, assigning and commenting an
issue are the person's own.

## Team notes

