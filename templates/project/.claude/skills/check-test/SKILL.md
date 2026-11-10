---
name: check-test
description: Check Xray tests against the project's documents, step by step — say for each step whether the passages it cites state its expected result, and report the real anomalies: results the passage does not support or contradicts, a step column not filled as its description says, the wrong object tested, a case the documents require of this test left out, "not implemented" without a source, documents that disagree. Use when asked to check, verify or review a test, or when Testimus runs its semantic check.
---

# Check tests

You are the second pair of eyes. You never rewrite a test and you edit no file. For each test you
give two things: **a verdict for every step**, with the passages you read to reach it, and **the
findings** — what is wrong, precisely enough that a reviewer decides in seconds.

The verdicts are the proof that the check happened: a test without a finding still shows that each
step was read against a passage. So a verdict names only what you opened in this run — Testimus
compares it with your tool calls.

**A test with no finding is a normal result.** Most tests were written from the passages you will
read; many are right. You are here to catch what would mislead a tester, not to show that you
looked: each finding costs the reviewer time, and a list padded with remarks hides the one error
that matters.

## How to read a test

Several tests in one request are checked one after the other, each on its own evidence. Send the
calls that do not depend on each other in the same turn: `tests_show` for every test at once, then
every passage they cite at once — tests of one request often share their passages, read each once.

1. `tests_show <id>`. The mechanical findings (a source that does not resolve, a quote not found, an
   empty or repeated step) are in the request: do not repeat them.
2. **For each step, each claim of its Expected Result**: open the cited passage (`rag_passage
   <docId#anchor>`), read it with its surroundings in `docs/<docId>/doc.md` when the claim is not
   plainly there. The passage supports the claim when it states it, in its words or in others. It
   does not when the step adds a value, a state, a timing, a condition or a consequence the passage
   does not state, or claims more than it (every type when the passage names one).
3. **A `fig:` source**: `rag_figure <docId> <n>`, then `Read` the image at the path it gives. The
   caption proves only that the figure exists; never accept a claim on a picture you did not look at.
4. **An observed document** (`img:`, `t:`, `v:`, `frame:` — photos and videos of the real system) supports
   how a step is done, never what is expected. A claim in the Action that the picture or the
   transcript contradicts is a finding; an expected result a written document contradicts is
   `contradicted` even when a picture shows it.
5. **The step columns** (`columns_list`): each column of each step holds what its description asks
   for, and nothing in a column whose description leaves it empty. A source ending
   `@<column> "<item>"` backs that item: its passage must state it.
6. **The test as a whole.** A missing case or refusal is a finding only when a passage states it for
   the very object and situation the test is about, and the test's own scope — its summary and
   description — includes it. A test is a scenario, often one of a series: `Grep` the object in
   `tests/*/test.md` before you call a case missing — what another test verifies is not missing.
7. **Pictures.** `rag_passage` lists the figures of a section. A step that acts on or looks at a
   screen, a menu, a symbol or a colour which a document picture shows, where the tester needs that
   picture to find where to act or to decide, and which the test does not embed, is
   `figure-not-embedded`. No picture in the document, or a picture of something the step does not
   look at, is not a finding.
8. **Contradictions.** `rag_mentions` on each object and screen of the test, once per term, and
   `rag_related` on the sections it cites (the documents that amend them come first). A
   contradiction is a passage that says otherwise about the same object in the same situation — not
   one that is more general, adds a detail, or describes another mode, type or state. When a passage
   disagrees, apply the precedence of the project `CLAUDE.md` and say which one wins, or that none
   does. Searching widely is how you are sure; it is no reason to report more.

## The verdict of a step

- `supported` — the passages you opened state its expected result.
- `unsupported` — they do not, or they say otherwise. The step then has a finding that says what.
- `unverified` — you could not judge it: the step cites nothing you can open, the picture is
  missing. Say why in `why`.

`read`: the `docId#anchor` you opened to judge that step — the passages it cites, and any other
that settled it.

## The bar for a finding

Record one only when all three hold:

1. **Proven** — you read the passage or looked at the picture, and you cite what proves it. A
   suspicion you could not settle by reading is not a finding.
2. **It matters to the test** — a tester following it would pass a wrong behavior, fail a right
   one, be unable to run or decide a step; or the test leaves out something the documents require
   of this test's own object.
3. **The reviewer would act on it** — change the test, or take a question to the team.

Not findings: wording, style, step order; the length of a test; a faithful paraphrase of the
passage, or the same thing said as the tester sees it (« the button is greyed out » for « the
command is unavailable »); a source that supports the claim when another would support it
« better »; a behavior the documents do not specify (not specified is not missing — a step that
asserts it is `unsupported`); a case outside the test's scope or verified by another test; what the
mechanical pass reports; a suggestion, a « could also check ».

One problem, one finding: the same gap across several steps is one finding about the test.

| kind | when |
|---|---|
| `unsupported` | the cited passage does not say what the expected result, or a column, claims |
| `contradicted` | a passage says otherwise about the same object in the same situation |
| `wrong-object` | the step tests another object or screen than its sources describe |
| `negative-missing` | a refusal or an error a passage states for the test's object is not tested, here or elsewhere |
| `case-missing` | a type or a state a passage lists with the tested one is not tested, here or elsewhere, and belongs to the test's scope |
| `not-simulated-unsourced` | « not implemented », « not simulated » or the like written without a source saying so |
| `vague-result` | a tester cannot decide pass or fail from the expected result |
| `documents-conflict` | two documents disagree and precedence does not settle it |
| `figure-not-embedded` | a step acts on or looks at a screen, a menu, a symbol or a colour that a document picture shows, the tester needs it, and it is not in the test |
| `other` | a column not filled as its description says, or a defect that would mislead a tester and fits no other kind |

`severity`: `error` when a tester following the test would pass a wrong behavior or fail a right
one; `warning` for a gap or a vague result the reviewer decides on. A remark not worth a warning is
not recorded.

**`fix`** — when the documents settle the finding, say what the step should hold instead, in one
sentence, from which passage: « Lister les trois commandes que donne le §4.2 : Propriétés, Prise en
charge, Acquitter ». Testimus turns the fixes of a test into one action the user can run. Leave it
out when only the team can decide: a conflict between documents, a behavior nobody specified.

## Record

`check_record`, exactly once per test:

```json
{ "id": "<test id>",
  "steps": [
    { "step": 1, "verdict": "supported", "read": ["SPEC_REPORTS#§4.2"] },
    { "step": 2, "verdict": "unsupported", "read": ["SPEC_REPORTS#§4.2", "SPEC_REPORTS#fig:7"] },
    { "step": 3, "verdict": "unverified", "read": [], "why": "The step cites no passage." } ],
  "findings": [
    { "step": 2, "kind": "unsupported", "severity": "error",
      "message": "Le §4.2 liste trois formats d'export ; le step n'attend que le PDF.",
      "sources": ["SPEC_REPORTS#§4.2"],
      "fix": "Attendre les trois formats que liste le §4.2 : PDF, CSV et XLSX." } ] }
```

- `steps`: one entry per step of the test, in order.
- `findings`: `step` is left out for a finding about the whole test; `message` is one sentence in
  the project language naming the exact discrepancy; `sources` are the `docId#anchor` that prove it.
  `[]` when there is none.

A refused call says what is missing: correct it and call again. Then reply with one line per test:
its findings counted by severity. What else the request asks comes after the tests, in the block it
gives.
