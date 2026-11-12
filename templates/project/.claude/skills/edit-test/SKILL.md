---
name: edit-test
description: Change existing Xray tests as the user asks — rephrase, add, split or remove steps, add a negative path, fill a step column, fix a source, translate — keeping each step's `<!-- id -->`, pictures and sources valid. Use for a request on a test or a step from the Testimus Claude panel, or any request to modify an existing test that is neither a To fix note (fix-test) nor new tests (generate-tests).
---

# Edit a test

The request comes with its scope (`Scope:` and `Files:`): a step scope allows that step only, a test
scope that test, a tests scope those tests. Everything outside it stays byte for byte.

1. **Read** each test of the scope with `tests_show`, all in the same turn. A request that names no
   change you can make: change nothing and ask, in one sentence, what to do.
2. **Edit** with `tests_edit`, one operation per field or step: it keeps each step's `<!-- id -->`,
   the `### Attachments` lists and the `![](images/…)` lines. Rewrite a whole file with `Write` only
   when the request changes most of it, and keep those three as they are.
3. **Every expected result you add or change has its source**, by the rules of the project
   `CLAUDE.md`: the quote copied from `docs/<docId>/doc.md`, inside the cited passage. Find the
   passage with `rag_mentions` (the step's objects), `rag_related` (the sections it cites) and
   `rag_search`, then read it. A request that asks for a behavior no passage states: write nothing
   for it, and say so.
4. **Step columns** (`columns_list`): a column you write follows its description; one whose
   description is empty stays empty. In a Reference source column each item has its own line
   ending `@<column> "<item>"`: an item you add, change or remove takes its line with it.
5. **Pictures**: a step you add or change where the tester does or sees something on a screen gets a
   picture of that screen when one truly shows it — a document figure (`fig:`), then a photo
   (`img:`), then a video key frame (`frame:`, `media_keep` to keep the right instant) — with
   `tests_addImage { id, step, figure, field }`. Finding none is fine; an approximate one is worse.
6. Leave `review`, `review_note`, `reviewed_by`, `reviewed_at` and `generated_by` as they are, and
   never edit `check.json`: the edit makes the last check stale, and Testimus shows it.
7. **Done** when `check_run` with `semantic: false` on each changed test reports nothing you can fix
   (`quote-not-found`: copy the quote again; `quote-weak`: quote more words) and `tests_show` shows
   the change you meant.

Reply in 2 to 4 lines, in the project language: which tests and steps changed, what `check_run`
still reports, what you could not do.
