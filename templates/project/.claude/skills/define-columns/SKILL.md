---
name: define-columns
description: Propose the step columns of a Testimus project and the description of each — the smart columns Claude fills when it writes a test — from Xray's standard and custom step fields, the tests the team already has, the documents and the saved contexts. Use when a prompt says to use the define-columns skill, or when asked what a step column should hold, how to describe it, or which column to add.
---

# Define the smart columns

Every step of a test is made of columns. Each one is a **smart column**: its description is the
instruction that generate-tests, fix-test and edit-test follow to fill it in every step. An empty
description means Claude never writes the column (the team fills it, or nobody does). A good
description makes every generated test land in the right column, in the team's form, without a
fix afterwards.

You change nothing. You propose; the user applies each proposal from the Smart columns settings.

## What you are given

The prompt lists, for the project:

- the smart columns in display order — where each lives (Xray standard, Xray custom field, local
  only), its description today, and how the existing tests fill it, with a few examples;
- Testimus' default descriptions for Xray's three standard columns;
- the documents, the glossary, the saved contexts and the user's request.

## 1. Reuse before you add

In this order:

1. **Xray's standard columns** — Action, Data, Expected Result — exist in every Xray project and
   every tester knows them. Keep Testimus' defaults; change one only when the documents or the
   team's tests show a different habit (a project that writes the screen in Data, one observation
   per line in Expected Result…), and then adapt the default rather than rewrite it.
2. **Xray's custom step fields** the project already has: the team created them in Xray and they are
   pushed with the test. Describe one before you invent anything. A custom field nobody should fill
   from the documents (a tester's remark, a run result) keeps an empty description.
3. **A local column** only when nothing in Xray fits. It lives in test.md and is never pushed: say in
   `why` that the team can add the field in Xray to have it pushed.

Never propose a column for what test.md already holds as a section: Description, Preconditions,
Sources, Attachments. Renaming, removing, hiding or folding a column is done in Xray or in the
settings, not by you.

## 2. Look before you write

1. **The tests.** `tests_list`, then read 3 to 6 `tests/<id>/test.md` — the ones with a Jira key
   first: the team wrote those. Note what goes in which column, the tone (imperative, nominal), the
   length, the lists, what is left empty. A habit seen in several tests beats your preference.
2. **The documents.** `docs_show` for each document that matters (its team `context` says what is
   not implemented), then `rag_search` and `rag_passage` for what a tester has to name or check: the
   screens and windows, the user roles, the objects, the values entered, the messages.
   Read `docs/<id>/doc.md` to see how the documents name them.
3. **The contexts.** Read the notes and files the prompt points at: a team rule there wins.

## 3. Write each description

- An instruction, one or two sentences: what goes in the column, in which form, and when to leave it
  empty. « The values entered or the object aimed at (a code, a record, a file), only when the action
  needs them. »
- In the vocabulary of the documents and the glossary; in the language the current descriptions use.
- About every step of every test — never the content of one test.
- No overlap: what one column holds, another does not repeat (Data holds the values, not the gesture).

## 4. Reply

Propose only what you would change or add — at most 6, the most useful first — each with its whole
new description and a `why` that names what you read (a test key, a `docId#anchor`, a context). A
request you cannot ground in the documents or the tests gets no proposal: say so.

Reply in 2 to 4 lines in English, then end with this block, valid JSON, nothing after it:

```columns
{"columns": [{"name": "Expected Result", "description": "Everything the user observes after the action, one observation per line, in the words of the document.", "why": "PROJ-142 and PROJ-139 list one observation per line."}]}
```

- `name`: the column exactly as listed, or the name of the new local column (one line, at most 60
  characters, no #).
- `description`: the whole new description; `""` to have Claude leave the column empty.
- `why`: one sentence.
