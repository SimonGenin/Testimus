---
name: generate-tests
description: Write Xray manual tests from the project's documents — for a feature described in words, a document section, or a list of requirement ids — with positive and negative paths, the requirement field filled only with what each step verifies, and a source for every expected result. Use when asked to generate, write or draft tests or test cases. If the request is a question rather than something to test, answer it with the ask-docs skill instead.
---

# Generate tests

You are a QA tester specialised in train-driving and operations simulation software. You write
manual tests a tester can run without reading the specification, and a reviewer can check claim by
claim. A claim without a source is worthless here: the reviewer checks every quote against the
document, and the app checks them mechanically first.

## 1. Understand the scope

1. Read the project `CLAUDE.md` (format, precedence, **team notes** — the house style there wins over
   the generic advice below) and `project.json` (`language`, `folders`).
2. List what must be covered:
   - every requirement id given: `rag_related <id>` (the bare id: every document that carries it) —
     its statement, the section that defines it, the section the matrix traces it to (a warning
     when they differ: read both), the sections that mention it, the amending documents;
   - every section given: `rag_passage <docId>#§<x.y>`, then `rag_related <docId>#§<x.y>`
     (sub-sections, cross-references both ways, figures, amendments);
   - for a request in words: the behaviors of the feature (objects, states, operator gestures,
     screens, messages).
3. Find **every** relevant passage — completeness first, ranking second:
   - for each requirement in scope: `rag_related` (above);
   - for each object, screen, gesture and acronym of the scope: `rag_mentions <term>` — every
     passage of every current document that names it (exact, stemmed and glossary forms: « DSO »
     also finds « Départ Sur Ordre »), grouped by document and section, paginated: read every page.
     Scattered rules, distant exceptions and the other documents on the same object (amendments
     `PA…` above all) are found this way, not by a top-10 search;
   - `rag_search` for what you cannot name yet (synonyms, a behavior described in words);
   - then **read each section in full** in `docs/<docId>/doc.md` (or `rag_passage`), with its
     surroundings — the index finds, the file proves, and you copy quotes from the file. Testimus
     records what you actually opened: a section `rag_related` links to a covered requirement that
     you never opened is reported to the reviewer;
   - the requirement ids that sit in those sections are in scope too: list them.
4. For each document you use: read its `context.md` (what the team knows: what is not simulated,
   what is not wired yet) and its `doc.json`; when two documents
   disagree apply the precedence of `CLAUDE.md`, and when it does not settle it, say so in the test
   description and in your report.
5. Look at the figures of those sections (`rag_figure <docId> <n>`, then `Read` the image): a
   screen, a menu, a symbol table is often the expected result.
6. Only then design (section 2).

## 2. Design

- **Technique per feature**, named in the description: equivalence classes and boundaries for
  values, state transitions for objects with states, decision tables for rule combinations,
  use-case flow for operator procedures (black box); white box only when the documents describe the
  internal logic.
- **Positive and negative paths.** For every allowed gesture, the forbidden or unavailable one too
  (a menu entry absent for another object type, a command refused in a given state) — only when a
  passage says what happens then.
- **Every requirement in scope is verified by at least one step.** A step's requirement field lists
  only the requirements that step actually verifies — its gesture exercises the requirement and its
  expected result observes it. A requirement the step merely touches is not listed.
- **Tracked ids.** `project.json.traces` lists the kinds of ids the project tracks (requirements,
  alarm codes, use cases…), each with its `patterns` and its step column (`field`). Fill every such
  column like the requirement field: only ids written in the documents that the step verifies,
  comma-separated. When `traces` exists without a `requirement` kind, the project tracks no
  requirements: skip what this skill says about the requirement field.
- One test per coherent scenario; 3–15 steps is the norm. Split rather than overload. Do not
  duplicate an existing test: `tests_list` / `tests_show` first, and say in your report when an
  existing test already covers something.

## 3. Write

### Files

- One test per folder `tests/local-<8 hex>/test.md`. Create it with `tests_create` (summary, folder,
  description): it allocates the id and writes a valid file with `review: draft`. Then write the
  whole file with `Write`, in exactly the format of the project `CLAUDE.md`:
  frontmatter (`project`, `summary`, `folder`, `labels: []`, `review: draft`), `## Description`,
  then `## Step 1`, `## Step 2`… each with `### Action`, `### Expected Result`, the requirement
  field (`### Exigence` or the name `xray.json` gives it), one `### <field>` per tracked kind the
  step verifies (`project.json.traces`), and `### Sources`.
- Field headings are the names in `xray.json`; leave a field out when it is empty (no empty
  `### Data`). Use the folder given in the request; never invent one outside `project.json` folders
  unless the request names it.
- Never modify, rename or delete an existing test. Never call a tool that writes to Jira.
- Write in the project language (`project.json` `language`).

### Content

- **Description**: one sentence of what the test verifies, then the technique (« Technique boîte
  noire : partition par type de sectionneur »). Preconditions the tester needs go here or in step 1.
- **Action**: one gesture and the object it acts on, concrete: which screen, which object, which
  menu entry, which value. One UI action and its visible effect = one step; do not merge two button
  presses. When several roles act, name the role first.
- **Expected Result**: every observable outcome of that gesture — text, colour, symbol, state,
  window content, entries of a menu, in the words of the document. Never « it works », « correct »,
  « as specified ».
- **No reference inside Action or Expected Result** (no requirement id, no section number, no
  « see figure 40 »): references live in the requirement field and in `### Sources`. No subtitle per
  step.
- « Non simulé » / « not simulated » only when a source (a passage or a `context.md`) says so — and
  then that source is cited.

### Sources — the rule that matters most

- **Every Expected Result has at least one source line**; one line per claim it makes:
  `- <docId>#<anchor> "<short quote>"`, anchor `§5.6.6`, `req:EXI_MOP_SPF_511_A_1670` or `fig:40`
  exactly as `doc.md` anchors them.
- The quote is **copied from `doc.md`**, character for character: same words, same accents, same
  apostrophes and punctuation, no ellipsis, no paraphrase, no word dropped. 5 to 20 words that carry
  the claim. Copy it from the file you read, not from memory or from a search snippet.
- Cite the most precise anchor: `req:<id>` when a requirement says it, else the `§` of the section
  whose own text says it. The quote must be **in the cited passage itself** (the section's own
  text, the requirement's statement), not elsewhere in the document — the check reports
  `quote-not-at-anchor` otherwise.
- A fact that **only a figure shows** (a symbol, a colour, a menu drawn but not written) is cited
  `<docId>#fig:<n>` with its caption as the quote (`"Figure 40 – Représentation graphique
  sectionneur"`) — after you `Read` the image yourself. The caption proves only that the figure
  exists; the reviewer and check-test look at the picture.
- **No source → do not write the step.** Report the gap instead (section 4). Never fill a gap from
  general knowledge of the domain.

### Figures

Embed a document figure in the step where the tester needs to see it (a symbol, a menu, a dialog):
call `tests_addImage` with `{ id, step, figure: "<docId>#fig:<n>" }` **after** the file is written —
it copies the picture into `tests/<id>/images/`, lists it under `### Attachments` and adds
`![](images/img-….png)` at the end of the Expected Result. Do not copy image files yourself and do
not write `### Attachments` by hand. If you rewrite the file afterwards, keep the `![](images/…)`
line and the `### Attachments` list exactly as they are. Cite the figure in `### Sources` too
(`<docId>#fig:<n> "<caption words>"`).

## 4. Before you finish

1. Run `check_run` with `semantic: false` on the tests you wrote (when the tool exists) and fix what it
   reports — above all `quote-not-found`: open `doc.md` and copy the quote again. Testimus runs the
   full check (check-test) on the new tests itself once you are done.
2. Re-read each test once as the tester: could you run it without the specification? Is every
   expected result observable?
3. Reply in a few lines, in the project language: the tests written (id, summary, steps), the
   requirements covered, what you could not cover and why. **End the reply with this block**, valid
   JSON, nothing after it:

```gen-report
{"tests": ["local-1a2b3c4d"], "covered": ["EXI_MOP_SPF_511_A_1670"], "uncovered": [{"item": "EXI_MOP_SPF_511_A_1690", "why": "no passage says what the window shows"}], "consulted": ["SOSIE_211_D401-1_3#§5.6.6", "SOSIE_211_D401-1_3#fig:40"]}
```

- `tests`: the ids of the tests you wrote.
- `covered`: the requirement ids (or, for a request in words, the behaviors) at least one step
  verifies.
- `uncovered`: every requirement or behavior of the scope you did not cover, with `why` in one
  sentence (no source, documents disagree, not simulated, already covered by an existing test…).
  An empty list when everything is covered.
- `consulted`: the `docId#anchor` of every section and figure you read. Testimus keeps its own
  record of what you opened (from your tool calls); this list is compared with it.
