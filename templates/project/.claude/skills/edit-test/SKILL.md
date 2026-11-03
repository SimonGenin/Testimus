---
name: edit-test
description: Change existing Xray tests as the user asks — rephrase, add, split or remove steps, add a negative path, fill a smart column, fix a source, translate — keeping each step's `<!-- id -->`, pictures and sources valid. Use for a request on a test or a step from the Testimus Claude panel, or any request to modify an existing test that is neither a To fix note (fix-test) nor new tests (generate-tests).
---

# Edit a test

The request comes with its scope (`Scope:` and `Files:` lines): a step scope allows that step only,
a test scope that test, a tests scope those tests. Everything outside it stays byte for byte.

1. **Read** each test of the scope with `tests_show`. A request that names no change you can make
   on it: change nothing and ask, in one sentence, what to do.
2. **Edit** with `tests_edit` (one operation per field or step); it keeps the `<!-- id -->` of each
   step, the `### Attachments` lists and the `![](images/…)` lines. Rewrite a whole file with
   `Write` only when the request changes most of it, and keep those three as they are.
3. **Sources.** Every expected result you add or change gets its source line, with the rules of
   generate-tests: `- <docId>#<anchor> "<words copied from docs/<docId>/doc.md>"`, the quote inside
   the cited passage itself. Find the passage with `rag_mentions` (the step's objects),
   `rag_related` (the sections it cites) and `rag_search`, then read it in `doc.md`. A request that asks for
   a behavior no passage states: write nothing for it and say so.
4. **Smart columns** (`columns_list`): a column you write follows its description; a column whose
   description is empty stays empty.
5. Leave the frontmatter's `review`, `review_note`, `reviewed_by`, `reviewed_at` and `generated_by`
   as they are, and never edit `check.json`: the edit makes the last check stale and Testimus shows it.
6. **Done** when, after your last write, `check_run` with `semantic: false` on each changed test
   reports nothing you can fix (`quote-not-found`: copy the quote again; `quote-weak`: quote more
   words), and `tests_show` shows the change you meant.

Reply in 2–4 lines, in the project language: what changed (which tests and steps), what `check_run`
still reports, and what you could not do.
