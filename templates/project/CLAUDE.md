# CLAUDE.md — Testimus project

This folder is a Testimus project: specification documents, the Xray manual tests written from them,
and what the team knows about both. Testimus (the app) and you work on the same files.

## What is here

- `docs/<docId>/` — one document: `doc.md` (converted text, anchors as `<!-- § 5.6.6 -->`,
  `<!-- req EXI_… -->`, `<!-- fig 40 -->`), `figures/`, `doc.json` (version, `status`,
  `amends`), `context.md` (what the team says about it — read it before using the document).
- `tests/<id>/test.md` — one Xray test (format below); `images/` its screenshots.
- `requirements/requirements.csv` — the requirement list, when the project has one.
- `contexts/` — reference notes attached to runs.
- `project.json` — Jira project, language, defaults, and `traces`: the kinds of ids the project tracks
  (requirements, alarm codes…), each with its patterns and its step column. `xray.json` — the Xray
  step fields.

Never edit: `index/`, `.testimus/`, `tests/*/.remote.md`, `tests/*/check.json`, `doc.json.source`.
When Testimus runs you (generate, fix, check, ask), you may only write under `tests/`: `docs/`, `index/`,
`.testimus/`, `contexts/`, `requirements/`, `.claude/`, `project.json`, `xray.json`, `.mcp.json` and
`CLAUDE.md` are refused, and each run allows only the tools its job needs.

## Tools

The `testimus` MCP server gives you every app command. Prefer them to guessing:
`rag_search` (find passages), `rag_passage` (the exact text and figures of `docId#anchor`),
`rag_figure`, `tests_list`, `tests_show`, `check_run`, `xray_search`, `xray_status`, `xray_plan`, `project_info`.
Called from a Claude session, `check_run` does the mechanical pass only — you are the semantic check.
Tool names are `<group>_<verb>` of the `testimus help` commands (`mcp__testimus__rag_search` in
permission lists).
Read `doc.md` directly to confirm a passage — the index finds, the file proves.
**Never call a tool that writes to Jira** (`xray_push`, `xray_importCsv` direct mode) unless the
user asked for it in this conversation. To push: call `xray_plan` first, show the user the plan, then
call `xray_push` with the `planHash` that `xray_plan` returned (a push without it, or after the test or
Jira changed, is refused — plan again). Pass `overwriteRemote: true` for a test changed in Jira only
when the user asked to replace that Jira change with the local version.

A problem you see and could fix in a later run (a lost figure, a finding you can correct, a missing id
pattern) can be left as a **Claude action**: `actions_propose` with a title (a verb first), the
problem, why you can fix it, a short plan and its scope. The user sees a button next to the problem and
runs it when they choose. `actions_list` shows the open ones.

## test.md

```markdown
---
summary: Sectionneur sans TK — menu contextuel et propriétés
folder: /Traction/Sectionneurs
labels: []
review: draft
---

## Description

One or two sentences: what this test verifies and the technique used.

## Step 1

### Action

What the tester does.

### Expected Result

What the tester observes.

![](images/img-3f9a2c1d.png)

### Exigence

EXI_MOP_SPF_511_A_1670

### Sources

- SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"
- SOSIE_211_D401-1_3#fig:40 "Figure 40 – Représentation graphique sectionneur"

### Attachments

- images/img-3f9a2c1d.png (SOSIE_211_D401-1_3#fig:40)
```

- Field headings are the step columns: the names in `xray.json` `fields` (`Action`, `Data`,
  `Expected Result`, custom fields) and the project's local columns (`xray.json` `columns` entries
  Xray does not have — kept in test.md, never pushed). Each column's `description` there says what
  goes in it; a column with an empty description stays empty. Leave a field out when it is empty.
- `### Sources`: one line per claim, `<docId>#<anchor> "<short quote copied exactly from doc.md>"`.
  A quote that is not verbatim in `doc.md` is an error.
- No reference inside Action or Expected Result text: references go in the requirement field, the
  tracked columns (`project.json.traces`) and `### Sources`.
- Pictures: a document figure goes into a step with `tests_addImage` (`figure: "<docId>#fig:<n>"`) —
  in the Action when it shows where to act, in the Expected Result when it shows what to see. It
  writes the `![](images/…)` line and the `### Attachments` entry, which names the figure it came from.
- Keep `<!-- id -->` on step headings and `### Attachments` lists as they are; renumber `## Step N`
  in order. A line of text starting with `#` or equal to `---` is escaped with `\`.
- Write the tests in the language of `project.json` (`language`).

## Documents disagree

Use `doc.json`: an amendment (`amends`) wins over what it amends. When that does not settle it,
say so in the test description and flag it — never pick silently.

## Team notes

(The team's own rules for this project go below.)
