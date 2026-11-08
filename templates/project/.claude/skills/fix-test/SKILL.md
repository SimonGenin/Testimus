---
name: fix-test
description: Correct one Xray test from a reviewer's "To fix" note and the test's check findings, keeping everything that was right, with a source for every changed expected result. Use when a test is marked to-fix and the user asks Claude to fix it, or when asked to apply a review note or the findings of a check.
---

# Fix a test

## Inputs

- The test (`tests_show <id>` or `tests/<id>/test.md`), its `review_note`, and its findings
  (`tests/<id>/check.json`, or the list in your request).
- The reviewer's note wins over a finding when they disagree; say so in your reply.

## Rules

- Change only what the note and the findings ask for, plus what they imply (renumbering, a source that
  no longer fits). Keep each step's `<!-- id -->`, attachments and untouched steps byte for byte.
- Every expected result you add or change gets a `### Sources` line with an exact quote, same rules as
  generate-tests: `- <docId>#<anchor> "<words copied from docs/<docId>/doc.md>"`, anchor `§x.y`
  or `fig:N`; the quote must be in the cited passage itself.
  Find them with `rag_mentions` (on the step's objects, across all documents), `rag_related` (on the
  cited sections: sub-sections, cross-references, amending documents) and `rag_search`, then
  read them with `rag_passage` and in `doc.md`. A `fig:` source is cited with its caption, after you
  `Read` the image.
- A `figure-not-embedded` finding names a document picture the tester needs: `Read` it, then embed
  it with `tests_addImage` `{ id, step, figure: "<docId>#fig:<n>", field }` — `Action` when it shows
  where to act, `Expected Result` when it shows what to see — and cite it in that step's
  `### Sources`. Never copy image files or write `### Attachments` by hand.
- An `observed-only` finding: the expected result rests only on an images or video document
  (`img:`, `t:`, `frame:` — pictures and videos of the real system), which says how to do a step,
  never what is expected. Find the passage of a written document that specifies the result and cite
  it; keep the picture's line when it shows how to do the step. When no written document says it,
  remove that claim from the expected result and say so in the reply — never keep a result only a
  picture or a video shows.
- A smart column (`columns_list`) holds what its description asks for; one whose description is
  empty stays empty. In a column with `referenceSource`, every item has its own source line ending
  `@<column> "<item>"` (generate-tests); an item you add, change or remove takes its line with it.
- Write "not implemented" (or "not simulated", "out of scope") only when a source says so.
- A finding you think is wrong: leave the step, explain why in the reply, citing the passage.
- Do not touch `review`, `review_note`, `reviewed_by`, `reviewed_at` or `generated_by` in the
  frontmatter, and do not edit `check.json`: Testimus re-checks the test after your run and sets it
  back to `draft` itself, for the reviewer. Never `validated` — that is the reviewer's decision.

## Reply

A few lines, in the project language: what changed (which steps), which findings are resolved, which
you contest and why.
