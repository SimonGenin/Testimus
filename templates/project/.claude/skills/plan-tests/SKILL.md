---
name: plan-tests
description: Plan the Xray manual tests a large scope needs — a whole document, a chapter — before any is written — which behaviors a tester can observe on the screen, how they group into scenarios (about 3 to 15 steps each, longer when the request asks), which sections each test reads. Use when a generation prompt says to use the plan-tests skill, or when asked to plan or split the tests of a document.
---

# Plan the tests of a large scope

You write no test. You produce the plan Testimus follows: it runs generate-tests once per planned
test, and each run reads only that test's sections, right before writing it. A good plan is what
makes those tests short, observable and complete — and what keeps a behavior from being written
twice, or by nobody.

1. **Inventory.** For each document in scope: `docs_show <docId>` — its outline, its `context` (what
   the team knows: what is not implemented, out of scope). Add the sections the request gives. Read
   them in `docs/<docId>/doc.md`, enough to know what each behavior makes the user do and see. Then
   look **outside** the scope's sections for what changes its behaviors: one `rag_mentions` per main
   object and screen, `rag_related` on each section that holds a behavior — all in the same turn.
   An exception, an amendment or a negative path found elsewhere goes in the `sections` of the test
   it belongs to: each test's run starts from those sections.
2. **Sort every behavior**, once each: observable (a tester sees or hears its effect: a window, a
   menu entry, a colour, a symbol, a message, a state shown, a file produced) — or left out, with
   its reason (below).
3. **Group** the observable behaviors into scenarios: one object or screen, one technique (state
   transitions, decision table, boundaries, a procedure), about 3 to 15 steps — a chapter is not a
   scenario. The request decides the length: a scenario it wants whole, or one that does not cut
   cleanly, stays one longer test. Each behavior lands in exactly one test; a negative path the
   documents describe stays with its positive path.
4. **Count both sides**: every behavior of the inventory is in one test or in `skipped`.
   `tests_list`: a scenario an existing test already verifies is left out as `already-tested`.
5. **Theme each test**: a few words the team files it under — taken from the request and the
   documents' chapters (`Traction`, `Itinéraires`), the same words for the tests that belong
   together, never a sentence. Testimus writes each test in that sub-folder, so the summary does not
   repeat it (`Coupure de la caténaire`, not `Traction — Coupure de la caténaire`).
6. **Ask, do not guess**: what the user must settle before anything is written — an ambiguity, two
   documents that disagree, a scope you are not sure of — is a question, with the passages that raise
   it and 2 or 3 answers to propose. Ask it here **instead of** leaving the behavior out later as
   `documents-disagree` or with an `unblock`: the user answers on Generate and every run of the
   writing holds to the answer. A behavior that cannot be written whatever the answer stays in
   `skipped`. No question is also an answer: ask only what changes the tests.

When the user has reviewed the plan, the request gives their answers and the plan as they left it
(renamed, merged, moved to another theme, unticked): keep their changes, drop the unticked tests,
never ask a settled question again, and answer the whole plan again.

Reply in a few lines, in the project language: how many tests, what is left out and why. End the
reply with this block, valid JSON, nothing after it:

```test-plan
{"tests": [{"summary": "PDF of the selected period", "theme": "Report export", "technique": "equivalence classes", "sections": ["SPEC_REPORTS#§4.2"]}], "skipped": [{"item": "Report cache refreshed by the server", "reason": "not-observable", "why": "§4.5 describes a server function: nothing on the screen changes when the cache is refreshed.", "sources": ["SPEC_REPORTS#§4.5 \"Le serveur rafraîchit le cache des rapports\""]}], "questions": [{"id": "q1", "text": "Which period applies when the user picks none?", "why": "§4.2 says the current month, §6.1 the last 30 days.", "sources": ["SPEC_REPORTS#§4.2 \"le mois en cours\"", "SPEC_REPORTS#§6.1 \"les 30 derniers jours\""], "answers": ["The current month (§4.2)", "The last 30 days (§6.1)"]}]}
```

- `summary`: the test's summary, in the project language, as it will appear in Xray, without its
  theme.
- `theme`: the few words it is filed under (step 5).
- `technique`: the test technique, in a few words.
- `sections`: the `docId#§x.y` the test is written from — its behaviors, its figures, its
  exceptions.
- `skipped`: every behavior of the scope no planned test verifies, said with its proof — the same
  fields as the report of generate-tests: `item`, `reason` (`no-source`, `not-observable`,
  `already-tested` with `test`, `out-of-scope`, `documents-disagree`, `missing-material`), `why`
  (one or two concrete sentences for this item), `sources` (the passage that asks for it,
  `docId#anchor "quote"`, verbatim), and for `no-source` and `missing-material` what you `searched`,
  what you `read` and what would `unblock` it.
- `questions`: what the user settles before the writing (step 6) — `id` (`q1`, `q2`…), `text`, `why`,
  `sources` (`docId#anchor "quote"`, verbatim), `answers` (2 or 3, the likeliest first); `[]` when
  there is nothing to ask.
