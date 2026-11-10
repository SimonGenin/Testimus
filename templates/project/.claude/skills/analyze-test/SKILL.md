---
name: analyze-test
description: Read one existing Xray test against the project's documents and propose, item by item, what would make it right — the sources of what is already right, changes to a column, new steps, steps to remove — while keeping what the team entered by hand. Nothing is written to the test; the team accepts or rejects each proposal. Use when Testimus runs an analysis of a test, written by hand, pulled from Jira or generated.
---

# Analyze a test against the documents

The test exists and belongs to the team: written by hand years ago, pulled from Jira, or generated.
You read it against the documents and propose; you never edit it, nor any other file. Each proposal
becomes a card the team accepts or rejects on its own, so each one stands alone, is proven, and says
plainly what it changes.

**Linking what is right comes first.** Most of a hand-written test is right and unsourced: the best
analysis often adds sources and changes little. A test that matches the documents gets proposals
for its missing sources only, or none.

## Whose each column is

The request lists the step columns and which ones Testimus holds whatever you decide. For every
column that holds text in this test, say how you treat it, in `columns`:

- **keep** — the team's: requirement codes, references, values typed by hand, anything a
  description calls a reference or an identifier, and every Reference source column. What is
  written stays word for word. You may link an item to its passage (a `source` proposal ending
  `@<column> "<item>"`) and add an item a passage gives (a `change` whose value keeps every existing
  item and appends the new one); you never reword, reorder or drop one.
- **open** — prose you may improve: Action, Expected Result, usually Data. Reword only where a
  passage says otherwise or the tester could not decide pass or fail; never for style.
- **leave** — a column whose description says to leave it empty: never write it.

`why`: one short sentence — what in the description or in the cells made you decide.

## How to read it

1. `tests_show <id>`. Its summary and description say what the test is about: that is its scope.
2. **Each step, each claim** of its Expected Result and of each open column: find the passage that
   states it — `rag_search`, then `rag_passage` and `docs/<docId>/doc.md` around it; send the
   searches of several steps in the same turn. A claim a passage states, in its words or others,
   gets a `source` proposal when the step does not cite it yet. A claim the passages contradict or
   do not support gets a `change` — the passage's version — with its source.
3. **Each item of a keep column** (a requirement code, a value): `rag_mentions` and `Grep` the code
   in `docs/*/doc.md`. Found: a `source` proposal backing that item, the quote taken from the
   passage that states the requirement. Found nowhere after looking in every document: list it in
   `unfound` with where you looked — it stays as it is.
4. **The test as a whole**: a case or a refusal a passage states for this very object and
   situation, which no step checks (`Grep` the object in `tests/*/test.md` first — what another
   test checks is not missing), is a `step` proposal placed where it belongs (`after`), with its
   sources. A step that repeats another, or tests what no document describes and the team did not
   mean, is a `remove` — rarely, with a why that says which step it repeats.
5. A `fig:` source: `rag_figure`, then `Read` the image before you rely on it.

## Proposals

| kind | fields | when |
|---|---|---|
| `source` | `step`, `sources` | the step is right and its claim, or one item of a column, has no source yet |
| `change` | `step`, `column`, `value`, `sources` | one column of a step says what the passages do not; `value` is the whole new text of that cell |
| `step` | `after`, `fields`, `sources` | a case the documents require of this test is missing |
| `remove` | `step` | the step repeats another or tests nothing the documents describe |

- One proposal is one decision. Two changes the team could want separately are two proposals; two
  sources of one step that prove the same claim are one.
- `title`: what it does, in a few words (« Lier EXI_MOP_SPF_511_A_1670 à son passage »). `why`: one
  sentence a reviewer reads in two seconds.
- Sources follow the rules of the project `CLAUDE.md`: `docId#anchor "exact quote"`, the quote
  inside the passage at that anchor, at least four words; `@<column> "<item>"` at the end to back
  one item. Every source is checked: one quote not found at its anchor refuses the whole call.
- Not proposals: style, wording the passage already supports, the length of a test, an order the
  team chose, what the documents do not specify.

## Record

`summary`: 2 to 4 sentences. Every section, requirement or figure it names is cited like a
source, `docId#anchor "exact quote"` with straight quotes: the team clicks it to read the passage.
A bare `§3.3.2.1` is refused, and so is a quote not found at its anchor.

`analysis_record`, exactly once:

```json
{ "id": "<test id>",
  "summary": "Le test suit SOSIE_211_D401-1_3#§5.6.6 \"Le menu contextuel d'un sectionneur sans TK propose\" ; deux exigences sur trois sont retrouvées. La fermeture n'est jamais vérifiée.",
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

A refused call records nothing and lists every problem: fix them all and call again.
`proposals: []` is a valid result. Then reply in one line: the proposals counted by kind.
