---
name: check-test
description: Check one Xray test against the project's documents, step by step, and report the real anomalies — expected results the cited passage does not support, smart columns not filled as their description says, wrong object tested, a case the documents require of this test left out, claims of "not implemented" without a source, contradictions between documents. Use when asked to check, verify or review a test, or when Testimus runs its semantic check.
---

# Check a test

You are the second pair of eyes. You do not rewrite the test and you do not edit any file — not the
test, not `check.json`. You report what is wrong, precisely enough that a reviewer decides in seconds.

**A test with no finding is a normal result, not a failed check.** Most generated tests were written
from the same passages you will read; many are right. Your job is to catch what would mislead a
tester, not to show that you looked: every finding costs the reviewer time, and a list padded with
remarks hides the one error that matters.

## The bar

Record a finding only when all three hold:

1. **Proven** — you read the passage (or the image) and can cite what proves it. A suspicion you could
   not settle by reading is not a finding.
2. **It matters to the test** — a tester following it would pass a wrong behavior, fail a right one,
   be unable to run or decide a step, or the test leaves out something the documents require of
   **this** test's object (its summary and description say what that is).
3. **The reviewer would act on it** — change the test, or take a question to the team.

Not findings — leave them out:

- wording, style, phrasing, step order, a step that could say more than the documents say;
- the length of a test: its number of steps is the request's and the team's choice, never a finding;
- a faithful paraphrase of the passage, or a reformulation in what the tester sees (« the button is
  greyed out » for « the command is unavailable ») — the passage supports it;
- a source that supports the claim but another passage would support it « better »;
- a behavior the documents do not specify: not specified is not missing (a step that **asserts** it
  is `unsupported`);
- cases outside the test's scope, or tested by another test;
- what the mechanical pass covers (sources, quotes, empty or duplicated steps, a cited figure not
  embedded, an expected result sourced from an annex only);
- suggestions, improvements, « could also check » — none of these is an anomaly.

One problem, one finding: the same gap across several steps is one finding about the test, not one
per step.

## Procedure

1. Read the test (`tests_show <id>`). The mechanical findings (sources that do not resolve, quotes not
   found, empty or duplicated steps) are already recorded — they are listed in your request or in
   `tests/<id>/check.json` with `"pass": "mechanical"`. Do not repeat them.
2. For each step, for each claim of its Expected Result:
   - open the cited passage (`rag_passage <docId#anchor>`) and read it in `docs/<docId>/doc.md` with its
     surroundings;
   - does it support the claim? It does when it states it, in its own words or in others. It does not
     when the step adds a value, a state, a timing, a condition or a consequence the passage does not
     state, or claims more than it (every type when the passage names one) — that is `unsupported`;
   - an annex source (an anchor that starts with `lot-`: `§lot-…`, `fig:lot-…`) is a photo of the
     real system, an observation: it supports **how** a step is done (where to click, the labels,
     the screens in turn), never what is **expected**. An Expected Result whose only sources are
     annexes is already reported by the mechanical pass (`observed-only`, unless the team marked the
     batch as a reference) — do not repeat it. A claim in the Action an annex photo contradicts (a
     label, a menu item, a screen that is not there) is `unsupported`; an expected result the body
     of a document contradicts is `contradicted` even when a photo shows it;
   - a `fig:<n>` source: `rag_figure <docId> <n>`, then **`Read` the image** at the path it gives
     (file names under `figures/` are not `fig-<n>.png`) before accepting the claim — the caption
     alone proves only that the figure exists. Never accept a `fig:` claim you have not looked at.
3. The smart columns (`columns_list`: each column and its description): each column of each step
   holds what its description asks for, and nothing a column's description leaves empty is written.
   A column read like any other text: a claim it makes needs the same support as the Expected
   Result. A source line ending `@<column> "<item>"` backs that item of the column: its passage must
   state the item (the requirement, the value) — one that does not is `unsupported`. A cell that does
   what its description asks, in other words than you would have used, is fine.
4. For the test as a whole, a missing case or negative path is a finding only when a passage
   **states** it for the very object and situation the test is about — a refusal, an error message,
   a type listed beside the one tested — and the test's scope includes it. A test is a scenario, often
   one of a series, not the whole specification of its object: before you report a missing case,
   `Grep` its object in `tests/*/test.md` — what another test tests is not missing. Pictures: a step
   that acts on or checks a screen, a menu, a symbol or a colour that a document picture shows
   (`rag_passage` lists the section's figures), where the tester needs that picture to find where to
   act or to decide, and the test does not embed it (`figure-not-embedded`). No picture in the
   document, or a picture of something the step does not look at, is not a finding.
5. Look for contradicting passages with `rag_mentions` on each object and screen of the test, once
   per term (every page), in the **other** documents and in the documents that **amend** the cited one
   (`rag_related <docId#anchor>` lists them, kind `amends`) — not with one top-10 search. Read each
   hit's section before concluding. A contradiction is a passage that says otherwise about the same
   object in the same situation; a passage that is more general, adds a detail, or describes another
   mode, type or state is not one. When a passage disagrees, apply the precedence of the project
   `CLAUDE.md` and of `doc.json` (`status`; an amendment wins over what it amends): say which one
   wins, or that none does. Searching widely is how you are sure; it is no reason to report more.

## Finding kinds

Use exactly these `kind` values:

| kind | when |
|---|---|
| `unsupported` | the cited passage does not say what the expected result (or a smart column) claims |
| `contradicted` | a passage says otherwise about the same object in the same situation |
| `wrong-object` | the step tests another object or screen than its sources describe |
| `negative-missing` | a refusal or error a passage states for the test's object is not tested, here or elsewhere |
| `case-missing` | a type or state a passage lists with the tested one is not tested, here or elsewhere, and belongs to the test's scope |
| `not-simulated-unsourced` | "not implemented", "not simulated" (or equivalent) written without a source saying so |
| `vague-result` | a tester cannot decide pass or fail from the expected result — not one that could merely be worded more precisely |
| `documents-conflict` | two documents disagree and precedence does not settle it |
| `figure-not-embedded` | a step acts on or looks at a screen, menu, symbol or colour that a document picture shows, the tester needs it, and it is not embedded in the test (`sources`: the `fig:` anchor) |
| `other` | a smart column not filled as its description says, or a defect that would mislead a tester and fits no other kind |

`severity`: `error` when a tester following the test would pass a wrong behavior or fail a right one;
`warning` for a gap or a vague result the reviewer should decide on. Do not use `info`: a remark not
worth a warning is not worth recording.

## Output

Call `check_record` **exactly once**, with every finding:

```json
{ "id": "<test id>", "findings": [
  { "step": 2, "kind": "unsupported", "severity": "error",
    "message": "Le §4.2 liste trois formats d'export ; le step n'attend que le PDF.",
    "sources": ["SPEC_REPORTS#§4.2"] }
] }
```

- `step`: the step number (1-based); leave it out for a finding about the whole test.
- `message`: one sentence, in the project language, naming the exact discrepancy ("the passage lists
  three export formats; the step expects PDF only").
- `sources`: the `docId#anchor` references that prove it (`§4.2`, `fig:7`, `page:3`).

No finding is a valid result: call `check_record` with `"findings": []`. Then reply in one line with the
count by severity.

## Claude actions (optional)

When you are sure you could correct a finding yourself in a later run — the right passage is in the
documents, the fix is in the test — propose it with `actions_propose`, using the `runId` your prompt
gives you. The user sees it as a card in the Actions tab of Ask Claude and decides whether to run it.

```json
{ "runId": "<runId>", "problem": "<the finding's message, verbatim>",
  "title": "Cite the source of step 4", "why": "§4.2 states the expected result.",
  "plan": ["Read §4.2", "Rewrite the expected result", "Add the source line"],
  "scope": { "kind": "step", "testId": "<test id>", "step": 4 }, "model": "sonnet", "effort": "medium" }
```

At most 3, never for a choice only the team can make (the documents contradict each other, a
behavior is not specified). The finding is still recorded with `check_record`.
