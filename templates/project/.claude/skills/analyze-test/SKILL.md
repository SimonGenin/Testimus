---
name: analyze-test
description: Read one existing Xray test against the project's documents and propose, item by item, what would make it right — the sources of what is already right, changes to a column, new steps, steps to remove — while keeping what the team entered by hand. Nothing is written to the test; the team accepts or rejects each proposal. Use when Testimus runs an analysis of a test, written by hand, pulled from Jira or generated.
---

# Analyze a test against the documents

The test exists and belongs to the team. It may have been written by hand years ago, pulled from Jira, or
generated. You read it against the documents and propose; you never edit it, nor any other file. Each
proposal becomes a card the team accepts or rejects on its own, so each must stand alone, be proven and
say plainly what it changes.

**Linking what is right comes first.** Most of a hand-written test is right but unsourced: the best
analysis often adds sources and changes little. A test that matches the documents gets proposals for its
missing sources only, or none.

## The columns: whose they are

`columns_list` gives each column and its description. For every column that holds text in this test,
decide how it is treated, and say it in `columns`:

- **keep** — the team's. Requirement codes, references, values typed by hand, anything a description calls
  a reference or an identifier, and every Reference source column (the core holds that one whatever you
  say). What is written stays **word for word**: you may link each item to its passage (a `source`
  proposal ending `@<column> "<item>"`) and you may add an item a passage gives (a `change` whose value
  keeps every existing item and appends the new one); you never reword, reorder or drop an item.
- **open** — prose Claude may improve: Action, Expected Result, usually Data. Reword only where a passage
  says otherwise or the tester could not decide pass or fail; never for style.
- **leave** — a column whose description says to leave it empty: never write it.

`why`: one short sentence — what in the description or in the cells made you decide.

## Procedure

1. Read the test (`tests_show <id>`) and the columns (`columns_list`). Note the test's object from its
   summary and description: that is its scope.
2. For each step, for each claim of its Expected Result (and of each open column): find the passage that
   states it (`rag_search`, then `rag_passage` and `docs/<docId>/doc.md` around it). A claim a passage
   states, in its words or others, gets a `source` proposal when the step does not cite it yet. A claim
   the passages contradict or do not support gets a `change` — the passage's version — with its source.
3. For each item of a keep column (a requirement code, a value): `rag_mentions` and `Grep` the code in
   `docs/*/doc.md`. Found → a `source` proposal backing that item (`@<column> "<item, as the cell has
   it>"`, the quote taken from the passage that states the requirement). Found nowhere after looking in
   every document → list it in `unfound` with where you looked; it stays as it is.
4. For the test as a whole: a case or a refusal a passage states for this very object and situation, and
   no step checks (`Grep` the object in `tests/*/test.md` first: what another test checks is not missing)
   → a `step` proposal, placed where it belongs (`after`), with its sources. A step that repeats another,
   or tests something no document describes and the team did not mean (an obvious copy, a stale step)
   → `remove`, rarely, with a why that says which step it repeats.
5. A `fig:` source: `rag_figure`, then `Read` the image before you rely on it.

## Proposals

| kind | fields | when |
|---|---|---|
| `source` | `step`, `sources` | the step is right and its claim (or one item of a column) has no source yet |
| `change` | `step`, `column`, `value`, `sources` | one column of a step says something the passages do not; `value` is the whole new text of that cell |
| `step` | `after`, `fields`, `sources` | a case the documents require of this test is missing |
| `remove` | `step` | the step repeats another or tests nothing the documents describe |

- One proposal = one decision. Two changes the team could want separately are two proposals; two sources
  of the same step that prove the same claim are one.
- `title`: what it does, a few words (« Lier EXI_MOP_SPF_511_A_1670 à son passage », « Résultat attendu :
  Annuler n'apparaît qu'après autorisation »). `why`: one sentence a reviewer reads in two seconds.
- Sources: `docId#anchor "exact quote from doc.md"`, the quote copied from the passage at that anchor, at
  least four words; `@<column> "<item>"` at the end to back one item of a column. Every source is checked:
  a quote not found at its anchor refuses the whole call.
- Not proposals: style, wording that the passage already supports, the length of a test, a step order the
  team chose, what the documents do not specify.

## Output

Call `analysis_record` **exactly once** with everything:

```json
{ "id": "<test id>",
  "summary": "Le test suit §5.6.6 ; deux exigences sur trois sont retrouvées. La fermeture n'est jamais vérifiée.",
  "columns": [ { "name": "Exigence", "role": "keep", "why": "Codes saisis par l'équipe." },
               { "name": "Expected Result", "role": "open", "why": "Texte libre." } ],
  "unfound": [ { "step": 2, "column": "Exigence", "item": "EXI_MOP_SPF_510_A_20", "why": "Absent de tous les documents (rag_mentions, Grep)." } ],
  "proposals": [
    { "kind": "source", "step": 2, "title": "Lier EXI_MOP_SPF_511_A_1670 à son passage", "why": "Le §5.6.6 l'énonce.",
      "sources": ["SOSIE_211_D401-1_3#§5.6.6 \"Le menu contextuel d'un sectionneur sans TK propose\" @Exigence \"EXI_MOP_SPF_511_A_1670\""] },
    { "kind": "step", "after": 3, "title": "Vérifier la fermeture", "why": "Le §5.6.6 la décrit ; aucun step ne la vérifie.",
      "fields": { "Action": "…", "Expected Result": "…" }, "sources": ["…"] }
  ] }
```

A refused call records nothing and lists every problem: fix them all and call again. `proposals: []` is a
valid result. Then reply in one line with the count of proposals by kind.
