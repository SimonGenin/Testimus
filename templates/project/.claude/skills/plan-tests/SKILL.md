---
name: plan-tests
description: Plan the Xray manual tests a large scope needs — a whole document, a chapter — before any is written — which behaviors a tester can observe on the screen, how they group into scenarios (about 3 to 15 steps each, longer when the request asks), which sections each test reads. Use when a generation prompt says to use the plan-tests skill, or when asked to plan or split the tests of a document.
---

# Plan the tests of a large scope

You write no test. You produce the plan Testimus follows: it then runs generate-tests once per
planned test, and each run reads only that test's sections, right before writing it. A good plan is
what makes those tests short, observable and complete.

1. **Inventory.** For each document in scope: `docs_show <docId>` — its `toc`, its team `context`
   (what is not implemented or out of scope). Add the sections the request gives. Read the sections in
   `docs/<docId>/doc.md`, enough to know what each behavior makes the user do and see.
   Then search the index for what lies **outside** the scope's sections but changes its behaviors:
   `rag_mentions` for each main object and screen, `rag_related` on each section that holds a
   behavior. An exception, an amendment (a document whose `doc.json` `amends` this one) or a negative path found elsewhere goes in the
   `sections` of the test it belongs to — each test's run starts from those sections.
2. **Classify every behavior**, once each:
   - **observable**: a tester using the product sees or hears its effect (a window, a menu entry, a
     colour, a symbol, a message, a state shown, a file produced);
   - **not observable**: internal logic (a server function, a file read, a search order), a capacity
     no screen shows, a design or delivery obligation;
   - **not implemented** (or not simulated, out of scope): a passage or a context says so (cite it in the why).
3. **Group** the observable behaviors into scenarios: one object or screen, one technique (state
   transitions, decision table, boundaries, user procedure), aiming for 3 to 15 steps — a chapter is
   not a scenario. The request decides the length: a scenario it wants whole, or one that does not cut
   cleanly, stays one longer test — never left out because of its length. Each behavior lands in
   exactly one test. A behavior with a negative path the documents describe (an entry absent for
   another type, a command refused in a state) stays in the test of its positive path.
4. **Check the plan**: every behavior of the inventory is either in one test or in `skipped` — count
   both sides. `tests_list`: a scenario an existing test already tests is left out and named in
   `skipped` (« tested by <test> »).

Reply in a few lines, in the project language: how many tests, and what is left out and why. End
the reply with this block, valid JSON, nothing after it:

```test-plan
{"tests": [{"summary": "Report export — PDF of the selected period", "technique": "equivalence classes", "sections": ["SPEC_REPORTS#§4.2"]}], "skipped": [{"item": "Report cache refreshed by the server", "category": "Not observable on the screen", "why": "§4.5 describes a server function: nothing on the screen changes when the cache is refreshed", "sources": ["SPEC_REPORTS#§4.5 \"Le serveur rafraîchit le cache des rapports\""]}]}
```

- `summary`: the test's summary, in the project language, as it will appear in Xray.
- `technique`: the test technique, in a few words.
- `sections`: the `docId#§x.y` the test is written from — the sections that hold its behaviors, its
  figures and its exceptions.
- `skipped`: every behavior of the scope that no planned test verifies, with `category`, `why` and
  `sources`, the passages that ask for it (`docId#anchor "quote"`, as a step source). `category` is why
  in a few words of your own, in the project language, the same words for items of the same nature
  (no fixed list: « Not observable on the screen », « Already tested »…); `why` says in one or two
  concrete sentences what is missing or what covers it already, for this item.
