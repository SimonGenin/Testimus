---
name: define-columns
description: Propose the step columns of a Testimus project and the description of each — the smart columns Claude fills when it writes a test — from Xray's standard and custom step fields, the tests the team already has, the documents and the saved contexts. Use when a prompt says to use the define-columns skill, or when asked what a step column should hold, how to describe it, or which column to add.
---

# Define the smart columns

Every step of a test is made of columns, and each column's description is the instruction every
run follows to fill it. An empty description means Claude never writes the column. A good
description makes every generated test land in the right column, in the team's form, with no fix
afterwards.

You change nothing. You propose; the user applies each proposal from Settings › Smart columns.

The request gives the columns in display order — where each lives (Xray standard, Xray custom
field, local only), its description today and how the existing tests fill it — Testimus' defaults
for Xray's three standard columns, the documents, the glossary, and what goes with the run.

## 1. Reuse before you add

1. **Xray's standard columns** — Action, Data, Expected Result — exist in every Xray project and
   every tester knows them. Keep Testimus' defaults; adapt one only when the documents or the
   team's tests show another habit (the screen written in Data, one observation per line).
2. **Xray's custom step fields** the project already has are pushed with the test: describe one
   before you invent anything. A field nobody should fill from the documents (a tester's remark, a
   run result) keeps an empty description.
3. **A local column** only when nothing in Xray fits. It lives in `test.md` and is never pushed:
   say in `why` that the team can add the field in Xray to have it pushed.

Never a column for what `test.md` already holds as a section: Description, Preconditions, Sources,
Attachments. Renaming, removing, hiding or folding a column is done in Xray or in the settings.

## 2. Look before you write

1. **The tests.** `tests_list`, then 3 to 6 tests with `tests_show` in one turn — those with a Jira
   key first: the team wrote them. What goes in which column, the tone, the length, the lists, what
   is left empty. A habit seen in several tests beats your preference.
2. **The documents.** `docs_show` for each one that matters, then `rag_search` and `rag_passage`
   for what a tester has to name or check: screens, roles, objects, values entered, messages — as
   the documents name them.
3. **What goes with the run**: a rule of the team there wins.

## 3. Write each description

- An instruction, one or two sentences: what goes in the column, in which form, when to leave it
  empty. « The values entered or the object aimed at (a code, a record, a file), only when the
  action needs them. »
- In the vocabulary of the documents and the glossary, in the language the current descriptions use.
- About every step of every test — never the content of one test.
- No overlap: what one column holds, another does not repeat.

## 4. Reply

Only what you would change or add — at most 6, the most useful first — each with its whole new
description and a `why` naming what you read (a test key, a `docId#anchor`, a context). A request
you cannot ground in the documents or the tests gets no proposal: say so.

2 to 4 lines in English, then this block, valid JSON, nothing after it:

```columns
{"columns": [{"name": "Expected Result", "description": "Everything the user observes after the action, one observation per line, in the words of the document.", "why": "PROJ-142 and PROJ-139 list one observation per line."}]}
```

- `name`: the column exactly as listed, or the name of the new local column (one line, at most 60
  characters, no #).
- `description`: the whole new description; `""` to have Claude leave the column empty.
- `why`: one sentence.
