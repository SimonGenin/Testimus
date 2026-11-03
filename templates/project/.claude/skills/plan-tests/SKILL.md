---
name: plan-tests
description: Plan the Xray manual tests a large scope needs — a whole document, a chapter, dozens of requirements — before any is written — which requirements a tester can observe on the screen, how they group into scenarios of 3 to 15 steps, which sections each test reads. Use when a generation prompt says to use the plan-tests skill, or when asked to plan or split the tests of a document.
---

# Plan the tests of a large scope

You write no test. You produce the plan Testimus follows: it then runs generate-tests once per
planned test, and each run reads only that test's sections, right before writing it. A good plan is
what makes those tests short, observable and complete.

1. **Inventory.** For each document in scope: `docs_show <docId>` — its `requirements`, its `toc`,
   its team `context` (what is not simulated). Add the requirement ids the request gives. Read the
   sections that hold them in `docs/<docId>/doc.md`, enough to know what each one makes the operator
   do and see; `rag_related` on an id whose statement does not say it.
2. **Classify every requirement**, once each:
   - **observable**: a tester at the simulator sees or hears its effect (a window, a menu entry, a
     colour, a symbol, a message, a state shown);
   - **not observable**: internal logic (a server function, a file read, a search order), a capacity
     no screen shows, a design or delivery obligation;
   - **not simulated**: a passage or a context says so (cite it in the why).
3. **Group** the observable requirements into scenarios: one object or screen, one technique (state
   transitions, decision table, boundaries, operator procedure), 3 to 15 steps — a chapter is not a
   scenario. Each requirement lands in exactly one test. A behavior with a negative path the documents
   describe (an entry absent for another type, a command refused in a state) stays in the test of its
   positive path.
4. **Check the plan**: every requirement of the inventory is either in one test's `requirements` or
   in `uncovered` — count both sides. `tests_list`: a scenario an existing test already covers is
   left out and named in `uncovered` (« covered by <id> »).

Reply in a few lines, in the project language: how many tests, and what is left out and why. End
the reply with this block, valid JSON, nothing after it:

```test-plan
{"tests": [{"summary": "Sectionneur sans TK — menu contextuel et ouverture", "technique": "transitions d'état", "requirements": ["EXI_MOP_SPF_511_A_1650", "EXI_MOP_SPF_511_A_1670"], "sections": ["SOSIE_211_D401-1_3#§5.6.6"]}], "uncovered": [{"item": "EXI_MOP_SPF_511_A_1700", "why": "not observable by a manual tester: the server function has no effect on the screen"}]}
```

- `summary`: the test's summary, in the project language, as it will appear in Xray.
- `technique`: the test technique, in a few words.
- `requirements`: the ids this test verifies (requirements and the other tracked ids of
  `project.json.traces`).
- `sections`: the `docId#§x.y` (or `docId#req:ID`) the test is written from — the sections that hold
  its requirements, its figures and its exceptions.
- `uncovered`: every requirement of the scope that no planned test verifies, with `why` in one sentence.
