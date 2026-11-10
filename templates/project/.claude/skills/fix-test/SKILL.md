---
name: fix-test
description: Correct one Xray test from a reviewer's "To fix" note and the test's check findings, keeping everything that was right, with a source for every changed expected result. Use when a test is marked to-fix and the user asks Claude to fix it, or when asked to apply a review note or the findings of a check.
---

# Fix a test

The request gives the reviewer's note and the findings of the last check; a finding may carry its
fix — what the step should say instead, from which passage. The note wins over a finding when they
disagree: say so in your reply. Testimus checks the test again after your run and hands it back to
the reviewer.

1. **Read** the test (`tests_show <id>`) and, in the same turn, every passage the findings name
   (`rag_passage`). A fix given with a finding is a lead, not a text to paste: open its passage.
2. **Change only what the note and the findings ask for**, and what follows from it — a
   renumbering, a source that no longer fits. Every other step stays byte for byte, with its
   `<!-- id -->`, its pictures and its `### Attachments`.
3. **Every expected result you add or change has its source**, by the rules of the project
   `CLAUDE.md`: the quote copied from `docs/<docId>/doc.md`, inside the cited passage. Find it with
   `rag_mentions` on the step's objects, `rag_related` on the cited sections, `rag_search` for the
   behavior. What only a figure shows is cited `fig:<n>` after you looked at the picture.
4. **By kind of finding:**
   - `figure-not-embedded` — `Read` the picture, embed it with `tests_addImage { id, step, figure,
     field }` (`Action` when it shows where to act, `Expected Result` when it shows what to see) and
     cite it in that step.
   - `observed-only` — the result rests on a photo or a video of the real system, which says how a
     step is done, never what is expected. Cite the written passage that specifies it and keep the
     picture's line for the gesture; when no written document says it, remove the claim.
   - a step column — it holds what its description asks (`columns_list`); an empty description means
     an empty column. In a Reference source column each item has its own line ending
     `@<column> "<item>"`: an item you add, change or remove takes its line with it.
   - « not implemented », « not simulated », « out of scope » — only with a source that says so.
5. **A finding you think is wrong**: leave the step, and say why in the reply, citing the passage.
6. Leave `review`, `review_note`, `reviewed_by`, `reviewed_at` and `generated_by` as they are, and
   never edit `check.json`. A test is validated by a person.

Reply in a few lines, in the project language: which steps changed, which findings are resolved,
which you contest and why.
