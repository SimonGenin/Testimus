---
name: generate-tests
description: Write Xray manual tests from the project's documents — for a feature described in words, a document or a document section — with positive and negative paths, every step column filled as its description says, and a source for every expected result. Use when asked to generate, write or draft tests or test cases. If the request is a question rather than something to test, answer it with the ask-docs skill instead.
---

# Generate tests

You are a QA tester of the product the documents describe. Its domain, vocabulary and users come
from the documents, the team's notes and the contexts of the run — never from your own idea of the
field. You write tests a tester can run without the specification and a reviewer can check claim by
claim: the app verifies every quote mechanically, then a second run reads each step against its
passage.

The request gives the scope, the step columns, the folder and the language, and may end with what
goes with the run: what to read first, what the team knows about the documents in scope, what is
left out. Read that first. The format of `test.md` and the rules of `### Sources` are in the project
`CLAUDE.md`; this skill is how to get there.

When the request says the scope is large and names the plan-tests skill, and testing it takes more
than 3 tests: follow plan-tests and write no test — Testimus runs this skill once per planned test.

## 1. Know the scope before you design

A test written from the first passages found misses the exception two chapters further, the
amendment that changed the rule, the refusal described in another document. Searching costs
seconds; a missed rule costs a wrong test. The reviewer sees every search you made and every passage
you opened.

1. **What must be tested.** A document: `docs_show <docId>` (its outline, its `context`). A section:
   `rag_passage`, then `rag_related`. A request in words: the behaviors of the feature — objects,
   states, gestures, roles, screens, messages.
2. **List the terms** of the scope — every object and object type, state, screen, window, menu,
   button, message, acronym — and send **one `rag_mentions` per term, all in the same turn**. Read
   every page of each. A term met while reading gets its own.
3. **Search the behavior in other words, and its negative side** (`rag_search`): forbidden,
   refused, greyed out, unavailable, error message, alarm, timeout — in the documents' language
   (« interdit », « refusé », « grisé », « non disponible »). The negative paths live there.
4. **`rag_related` on every section you will cite**, and follow what bears on the scope: a
   sub-section, a cross-reference, a document that amends this one.
5. **Read each section in full** in `docs/<docId>/doc.md` with its surroundings: the index finds,
   the file proves, and quotes are copied from the file.
6. **Open the pictures.** `rag_passage` lists the figures of a section; a figure with a picture
   (`rag_figure` says `picture: true`) that shows a screen, a menu, a symbol, a colour legend or a
   layout is read with `Read`. Note which step each one will illustrate.

Done when every term had its `rag_mentions`, every cited section its `rag_related`, and the negative
side of each gesture was searched. When two documents disagree, apply the precedence of `CLAUDE.md`.

## 2. Design

- **A technique per feature**, named in the description: equivalence classes and boundaries for
  values, state transitions for objects with states, decision tables for combined rules, a use-case
  flow for a procedure.
- **Positive and negative.** For each allowed gesture, the forbidden or unavailable one — when a
  passage says what happens then.
- **Observable.** An expected result is what the tester sees or hears on the product: a window, a
  menu entry, a colour, a symbol, a message, a state shown, a file produced.
- **A starting point.** The description says what the tester starts from (the profile, the object
  and its type, its state); a step that checks a behavior in a state first brings the object there.
- **One test per coherent scenario**, about 3 to 15 steps. A chapter is not a scenario, and neither
  is an object with several types: a type that has its own menu, its own states or its own
  procedure is a scenario of its own, which a tester runs apart. That is a preference, never a
  limit: the request decides, and a scenario that does not cut cleanly stays one longer test.
  Nothing is refused or left out because of its length.
- **No duplicate.** `tests_list` / `tests_show` first: a behavior an existing test verifies is not
  written again.

## 3. Write

- `tests_create` (summary, folder, description) allocates `tests/local-<8 hex>/` with a valid file,
  `review: draft`. Then `Write` the whole file. Only new tests: never change, rename or delete an
  existing one.
- **Action**: one gesture and the object it acts on — which screen, which object, which menu
  entry, which value. One gesture and its visible effect is one step; when several roles act, name
  the role first.
- **Expected Result**: every observable outcome of that gesture, in the words of the document.
  Never « it works », « correct », « as specified ».
- **Each column** the request lists is filled as its description says, which wins over the advice
  here; a column it says to leave empty is never written.
- **Sources** — the rule that matters most. One line per claim of the expected result, the quote
  copied character for character from `doc.md`, 5 to 20 words that carry the claim, under the most
  precise anchor: the section whose own text says it. What only a figure shows is cited
  `<docId>#fig:<n>` with its caption, after you looked at the picture. An item written in a
  Reference source column has its own line ending `@<column> "<item>"`.
- **Observed documents** (photos, videos: `img:`, `t:`, `frame:`) say how a step is done — where to
  click, the exact labels, the screens in turn — never what is expected. Use them for the Action;
  an expected result needs a written document.
- **No source: search, then decide.** `rag_mentions` the object, `rag_search` the behavior, open
  what they find. Still nothing: write no step for it and report it (section 5). Never from memory
  or from general knowledge.

### Pictures — as important as the sources

The tester works in front of the product, not the specification: a picture is how they know where
to click and what they should see. Every document picture that shows what a step is about goes in
that step, once per test, at the first step that needs it:

- `tests_addImage { id, step, figure: "<docId>#fig:<n>", field }` after the file is written — `field`
  `Action` when it shows where to act, `Expected Result` when it shows what to see. Cite the figure in
  that step's sources too.
- If you rewrite the file afterwards, keep the `![](images/…)` lines and `### Attachments` as they are.
- No picture is fine: a rule in text, a value, a message. Never one that does not show what the step
  is about. A figure written as text (`picture: false`) is cited, not embedded.

## 4. Before you finish

1. `check_run` with `semantic: false` on the tests you wrote, and fix all it reports: `quote-not-found`
   — copy the quote again from `doc.md`; `quote-weak` — quote more words; `figure-not-embedded` — embed
   it; `observed-only` — cite the written passage that specifies the result, or remove the result and
   report the gap. Again, until nothing you can fix is left.
2. Re-read each test with `tests_show` as the tester: could you run it without the specification?
   Every result observable, every state prepared before the step that checks it, every column as its
   description says, every picture the document has for a screen the step looks at?

## 5. The report

Reply in a few lines, in the project language: the tests written and what you left without a test.
Then end the reply with the block the request gives, valid JSON, nothing after it:

```gen-report
{"tests": ["local-1a2b3c4d"], "skipped": [{"item": "Content of the export settings window", "reason": "no-source", "why": "§4.3 names the window, and no passage says what it shows.", "sources": ["SPEC_REPORTS#§4.3 \"Les paramètres d’export sont définis dans la fenêtre dédiée\""], "searched": ["paramètres d'export", "fenêtre dédiée"], "read": ["SPEC_REPORTS#§4.3", "SPEC_REPORTS#§4.4"], "unblock": "A passage or a note of the team that lists what the window holds."}]}
```

`skipped` is every behavior of the request you wrote no step for — `[]` when there is none. Leaving
a behavior out takes coverage away, so it is said like a step: with its proof. A behavior another
test of the same plan takes is not left out: do not report it.

- `item`: the behavior, in a few words, once. Codes and document names go in the quote, not here.
- `reason`, one of:
  - `no-source` — the documents ask for it and no passage states what the tester must see, after
    you searched;
  - `not-observable` — internal logic, a design deliverable, a capacity no screen shows;
  - `already-tested` — an existing test of the project verifies it (`test`: its id);
  - `out-of-scope` — the scope touches it and the request did not ask for it;
  - `documents-disagree` — two passages say otherwise and precedence does not settle it (cite both);
  - `missing-material` — what would state it is not in the project: a figure lost in conversion, a
    document only referred to, a definition left to a later phase.
- `why`: one or two concrete sentences for this item — what is missing, what the documents say
  instead. Not the reason again.
- `sources`: the passage that asks for it, `docId#anchor "quote"`, verbatim, so the reviewer opens it.
- `searched`, `read`: what you searched and which `docId#anchor` you opened before giving up.
  Testimus compares them with your tool calls.
- `unblock`: what would let the test be written, and who can bring it — a document to add, a figure
  to recover, a decision of the team.

Testimus checks what it can without a model, then a second look judges each reason while the new
tests are checked. A reason that does not hold is shown to the reviewer.
