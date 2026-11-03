---
name: check-test
description: Check one Xray test against the project's documents, step by step, and report anomalies — expected results the cited passage does not support, smart columns not filled as their description says, wrong object tested, missing negative path, claims of "not implemented" without a source, contradictions between documents. Use when asked to check, verify or review a test, or when Testimus runs its semantic check.
---

# Check a test

You are the second pair of eyes. You do not rewrite the test and you do not edit any file — not the
test, not `check.json`. You report what is wrong, precisely enough that a reviewer decides in seconds.

## Procedure

1. Read the test (`tests_show <id>`). The mechanical findings (sources that do not resolve, quotes not
   found, empty or duplicated steps) are already recorded — they are listed in your request or in
   `tests/<id>/check.json` with `"pass": "mechanical"`. Do not repeat them.
2. For each step, for each claim of its Expected Result:
   - open the cited passage (`rag_passage <docId#anchor>`) and read it in `docs/<docId>/doc.md` with its
     surroundings;
   - does it **say** what the step claims? Not "is compatible with" — says;
   - a `fig:<n>` source: `rag_figure <docId> <n>`, then **`Read` the image** at the path it gives
     (file names under `figures/` are not `fig-<n>.png`) before accepting the claim — the caption
     alone proves only that the figure exists. Never accept a `fig:` claim you have not looked at.
3. The smart columns (`columns_list`: each column and its description): each column of each step
   holds what its description asks for, and nothing a column's description leaves empty is written.
   A column read like any other text: a claim it makes needs the same support as the Expected
   Result. A source line ending `@<column> "<item>"` backs that item of the column: its passage must
   state the item (the requirement, the value) — one that does not is `unsupported`.
4. For the test as a whole: behaviors the documents describe for this object that are missing
   (other types, other states, the negative path); and the pictures — a step about a screen, a menu,
   a symbol or a colour whose document section has a figure with a picture (`rag_passage` lists
   them) that the test does not embed (`figure-not-embedded`). No picture in the document is not a
   finding. A test is often one of a series: before you report a missing case or negative path,
   `Grep` its object in `tests/*/test.md` — what another test tests is not missing.
5. Look for contradicting passages with `rag_mentions` on each object and screen of the test, once
   per term (every page), in the **other** documents and in the documents that **amend** the cited one
   (`rag_related <docId#anchor>` lists them, kind `amends`) — not with one top-10 search. Read each
   hit's section before concluding. When a passage disagrees, apply the precedence of the project
   `CLAUDE.md` and of `doc.json` (`status`; an amendment wins over what it amends): say
   which one wins, or that none does.

## Finding kinds

Use exactly these `kind` values:

| kind | when |
|---|---|
| `unsupported` | the cited passage does not say what the expected result (or a smart column) claims |
| `contradicted` | a passage says otherwise |
| `wrong-object` | the step tests another object or screen than its sources describe |
| `negative-missing` | the negative path (refusal, other type, error) is not tested |
| `case-missing` | a type or state the documents describe is not tested |
| `not-simulated-unsourced` | "not implemented", "not simulated" (or equivalent) written without a source saying so |
| `vague-result` | an expected result a tester cannot observe or decide |
| `documents-conflict` | two documents disagree and precedence does not settle it |
| `figure-not-embedded` | a step acts on or looks at a screen, menu, symbol or colour that a document picture shows, and that picture is not embedded in the test (`sources`: the `fig:` anchor) |
| `other` | anything else worth the reviewer's eye — a smart column not filled as its description says |

`severity`: `error` when a tester following the test would pass a wrong behavior or fail a right one;
`warning` for gaps and vague results; `info` otherwise.

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
- `sources`: the `docId#anchor` references that prove it (`§4.2`, `req:<id>`, `fig:7`).

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
