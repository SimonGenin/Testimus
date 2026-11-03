---
name: generate-tests
description: Write Xray manual tests from the project's documents — for a feature described in words, a document or a document section — with positive and negative paths, every smart column filled as its description says, and a source for every expected result. Use when asked to generate, write or draft tests or test cases. If the request is a question rather than something to test, answer it with the ask-docs skill instead.
---

# Generate tests

You are a QA tester specialised in train-driving and operations simulation software. You write
manual tests a tester can run without reading the specification, and a reviewer can check claim by
claim. A claim without a source is worthless here: the reviewer checks every quote against the
document, and the app checks them mechanically first.

A request that says the scope is large and to use the plan-tests skill: when testing it takes more
than 3 tests, follow plan-tests instead of this skill and write no test — Testimus then runs this
skill once per planned test.

## 1. Understand the scope

1. Read the project `CLAUDE.md` (format, precedence, **team notes** — the house style there wins over
   the generic advice below) and `project.json` (`language`, `folders`).
2. List what must be tested:
   - every document given: `docs_show <docId>` (its `toc`, its team `context`), then its sections;
   - every section given: `rag_passage <docId>#§<x.y>`, then `rag_related <docId>#§<x.y>`
     (sub-sections, cross-references both ways, figures, amendments);
   - for a request in words: the behaviors of the feature (objects, states, operator gestures,
     screens, messages).
3. Find **every** relevant passage — completeness first, ranking second:
   - for each object, screen, gesture and acronym of the scope: `rag_mentions <term>` — every
     passage of every current document that names it (exact, stemmed and glossary forms: « DSO »
     also finds « Départ Sur Ordre »), grouped by document and section, paginated: read every page.
     Scattered rules, distant exceptions and the other documents on the same object (amendments
     `PA…` above all) are found this way, not by a top-10 search;
   - `rag_search` for what you cannot name yet (synonyms, a behavior described in words);
   - then **read each section in full** in `docs/<docId>/doc.md` (or `rag_passage`), with its
     surroundings — the index finds, the file proves, and you copy quotes from the file. Testimus
     records what you actually opened and shows it to the reviewer.

   This step is done when every object and screen of the scope has had its own `rag_mentions` call —
   one call per term, not one per step.
4. For each document you use: read its team context (`docs_show` returns it as `context`: what is
   not simulated, what is not wired yet — most documents have none) and its `doc.json`; when two documents
   disagree apply the precedence of `CLAUDE.md`, and when it does not settle it, say so in the test
   description and in your report.
5. **Open the pictures.** `rag_passage` lists the figures of each section; for every figure with a
   picture (`rag_figure <docId> <n>` says `picture: true`) that shows a screen, a window, a menu, a
   button, a symbol, a colour legend or a layout, `Read` the image. The figure's description in the
   index is a summary written by another run: it tells you what to look for, it does not replace
   the picture — neither for you nor for the tester. Note which step of your tests each picture
   will illustrate (section 3, Figures). A figure without a picture (a table or a caption written as
   text) is read in `doc.md` and only cited.
6. Only then design (section 2).

## 2. Design

- **Technique per feature**, named in the description: equivalence classes and boundaries for
  values, state transitions for objects with states, decision tables for rule combinations,
  use-case flow for operator procedures (black box); white box only when the documents describe the
  internal logic.
- **Positive and negative paths.** For every allowed gesture, the forbidden or unavailable one too
  (a menu entry absent for another object type, a command refused in a given state) — only when a
  passage says what happens then.
- **Observable on the screen.** An expected result is what the tester sees or hears at the
  simulator: a window, a menu entry, a colour, a symbol, a message, a state shown. Internal logic (a
  server function, a file read, a search order), a capacity no screen shows or a design deliverable
  makes no step: report it in `skipped` with the why « not observable by a manual tester ».
- **A starting point.** The description states what the tester starts from (the profile, the
  object and its type, its state). A step that checks a behavior in a state first brings the object
  into that state, in its own Action or an earlier step.
- **Smart columns.** The request lists the smart columns and what the team wants in each (its
  description): fill each one following its description, which wins over the generic advice below.
  A column the request says to leave empty is never written.
- **Additional context.** The request may end with saved contexts to read and a note from the user
  for this run: read them before you design; they say what the documents do not (what is simulated,
  the house vocabulary, the operator's post).
- One test per coherent scenario; 3–15 steps is the norm. A chapter is not a scenario: a test that
  grows past 15 steps is split. Do not duplicate an existing test: `tests_list` / `tests_show`
  first, and say in your report when an existing test already tests something.

## 3. Write

### Files

- One test per folder `tests/local-<8 hex>/test.md`. Create it with `tests_create` (summary, folder,
  description): it allocates the folder and writes a valid file with `review: draft`. Then write the
  whole file with `Write`, in exactly the format of the project `CLAUDE.md`:
  frontmatter (`project`, `summary`, `folder`, `labels: []`, `review: draft`), `## Description`,
  then `## Step 1`, `## Step 2`… each with one `### <column>` per smart column of the request that
  the step fills, and `### Sources`.
- Column headings are exactly the names the request gives (Xray's step fields and the project's
  local columns); leave a column out when it is empty (no empty `### Data`). Use the folder given in
  the request; never invent one outside `project.json` folders unless the request names it.
- Never modify, rename or delete an existing test. Never call a tool that writes to Jira.
- Write in the project language (`project.json` `language`).

### Content

- **Description**: one sentence of what the test verifies, then the technique (« Technique boîte
  noire : partition par type de sectionneur »), then the starting point (section 2).
- **Action**: one gesture and the object it acts on, concrete: which screen, which object, which
  menu entry, which value. One UI action and its visible effect = one step; do not merge two button
  presses. When several roles act, name the role first.
- **Expected Result**: every observable outcome of that gesture — text, colour, symbol, state,
  window content, entries of a menu, in the words of the document. Never « it works », « correct »,
  « as specified ».
- **No reference inside Action or Expected Result** (no section number, no « see figure 40 »):
  references live in `### Sources`. No subtitle per step.
- « Non simulé » / « not simulated » only when a source (a passage or a `context.md`) says so — and
  then that source is cited.

### Sources — the rule that matters most

- **Every Expected Result has at least one source line**; one line per claim it makes:
  `- <docId>#<anchor> "<short quote>"`, anchor `§5.6.6` or `fig:40` exactly as `doc.md` anchors
  them.
- The quote is **copied from `doc.md`**, character for character: same words, same accents, same
  apostrophes and punctuation, no ellipsis, no paraphrase, no word dropped. 5 to 20 words that carry
  the claim. Copy it from the file you read, not from memory or from a search snippet.
- Cite the most precise anchor: the `§` of the section whose own text says it. The quote must be
  **in the cited passage itself**, not elsewhere in the document — the check reports
  `quote-not-at-anchor` otherwise.
- A fact that **only a figure shows** (a symbol, a colour, a menu drawn but not written) is cited
  `<docId>#fig:<n>` with its caption as the quote (`"Figure 40 – Représentation graphique
  sectionneur"`) — after you `Read` the image yourself. The caption proves only that the figure
  exists; the reviewer and check-test look at the picture.
- **No source → do not write the step.** Report the gap instead (section 4). Never fill a gap from
  general knowledge of the domain.

### Figures — as important as the sources

The tester runs the test in front of the simulator, not the specification. A picture is how they
know **where to click** and **what they should see**; a step about a screen without its picture
sends them back to the document. So every document picture that shows what a step is about goes in
that step:

- **Where to act** — the window, menu, zone or button the Action uses: embed it in the `Action`.
- **What to see** — the symbol, colour, state, window content or layout the Expected Result
  describes: embed it in the `Expected Result` (the default).
- Embed with `tests_addImage` `{ id, step, figure: "<docId>#fig:<n>", field }` **after** the file is
  written. It copies the picture into `tests/<id>/images/`, lists it under `### Attachments` with the
  figure it came from (`- images/img-….png (<docId>#fig:<n>)`) and adds `![](images/img-….png)` at
  the end of the field; the app shows it as a link to the figure. Never copy image files yourself,
  never write `### Attachments` by hand. If you rewrite the file afterwards, keep the `![](images/…)`
  lines and the `### Attachments` list exactly as they are.
- Cite the figure in `### Sources` of that step too (`<docId>#fig:<n> "<caption words>"`).
- Once per test is enough: embed a figure at the first step that needs it, not in every step.
- **No picture, no image — that is fine.** Many steps have none: a rule written in text, a value, a
  message. Never embed a picture that does not show what the step is about, never one from another
  object or screen, and never invent one. A figure written as text (a table, `picture: false`) is
  cited, not embedded — `tests_addImage` refuses it.

## 4. Before you finish

1. Run `check_run` with `semantic: false` on the tests you wrote (when the tool exists) and fix every
   finding it reports, warnings included: `quote-not-found` — open `doc.md` and copy the quote again;
   `quote-weak` — quote more words, until the quote points at one place; `figure-not-embedded` —
   embed the figure it names. Run it again until it reports nothing you can fix. Testimus runs the
   full check (check-test) on the new tests itself once you are done.
2. Re-read each test with `tests_show` after your last write, as the tester: could you run it
   without the specification? Every expected result observable on the screen, every state a step
   checks prepared before it, every smart column filled as its description says? **Pictures:** for
   each step that acts on or looks at a screen, a menu, a symbol or a colour, is the document's
   picture of it embedded — when the document has one? Fix what fails, embed the missing pictures,
   or move it to `skipped`; a large run is no reason to skip them.
3. Reply in a few lines, in the project language: the tests written (folder, summary, steps), what
   you could not test and why. **End the reply with this block**, valid JSON, nothing after it:

```gen-report
{"tests": ["local-1a2b3c4d"], "skipped": [{"item": "Fenêtre Propriétés d'un sectionneur avec TK", "why": "no passage says what the window shows"}], "consulted": ["SOSIE_211_D401-1_3#§5.6.6", "SOSIE_211_D401-1_3#fig:40"]}
```

- `tests`: the folders (`local-…`) of the tests you wrote.
- `skipped`: every behavior of the request you wrote no step for, with `why` in one sentence (no
  source, documents disagree, not simulated, already tested by an existing test…). An empty list
  when nothing was left out.
- `consulted`: the `docId#anchor` of every section and figure you read. Testimus keeps its own
  record of what you opened (from your tool calls); this list is compared with it.

## 5. Claude actions (optional)

A skipped item is sometimes something you could fix in a later run with the app's tools: the
conversion lost a figure or a table the section relies on (a PDF rendering would bring it back).
Propose it with `actions_propose`, using the `runId` your prompt gives you; the user sees a « Claude
action » button and decides.

```json
{ "runId": "<runId>", "where": "doc:<docId>", "problem": "<what is missing, in one sentence>",
  "title": "Recover figure 40 from the PDF", "why": "§5.6.6 relies on it to state the menu.",
  "plan": ["Find the PDF of the document", "Convert again with it", "Test §5.6.6"],
  "scope": { "kind": "doc", "docId": "<docId>" } }
```

At most 3, only when you are confident, never for a choice only the team can make.
