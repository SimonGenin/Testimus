---
name: check-test
description: Check one Xray test against the project's documents, step by step, and report anomalies — expected results the cited passage does not support, wrong requirement linked, requirement in scope not verified, wrong object tested, missing negative path, claims of "not simulated" without a source, contradictions between documents. Use when asked to check, verify or review a test, or when Testimus runs its semantic check.
---

# Check a test

You are the second pair of eyes. You do not rewrite the test and you do not edit any file — not the
test, not `check.json`. You report what is wrong, precisely enough that a reviewer decides in seconds.

## Procedure

1. Read the test (`tests_show <id>`). The mechanical findings (sources that do not resolve, quotes not
   found, unknown requirement ids, empty or duplicated steps) are already recorded — they are listed in
   your request or in `tests/<id>/check.json` with `"pass": "mechanical"`. Do not repeat them.
2. For each step, for each claim of its Expected Result:
   - open the cited passage (`rag_passage <docId#anchor>`) and read it in `docs/<docId>/doc.md` with its
     surroundings;
   - does it **say** what the step claims? Not "is compatible with" — says;
   - a `fig:<n>` source: `rag_figure <docId> <n>`, then **`Read` the image** before accepting the
     claim — the caption alone proves only that the figure exists. Never accept a `fig:` claim you
     have not looked at.
3. For each requirement in the step's requirement field (`Exigence` for LFRPS12): `rag_related <ID>`
   (statement, defining and traced sections — read both when they differ —, amending documents),
   then read it (`rag_passage <docId#req:ID>`); does this step verify it — the gesture exercises it
   and the expected result observes it? Every other kind in `project.json.traces` is checked the
   same way on its own column (`field`): each id is written in the documents (`Grep` its pattern)
   and the step verifies it — else `wrong-requirement`, naming the column. When `traces` has no
   `requirement` kind, the project tracks no requirements: skip them.
4. For the test as a whole: requirements in its scope that no step verifies; behaviors the documents
   describe for this object that are missing (other types, other states, the negative path).
5. Look for contradicting passages with `rag_mentions` on each object, screen and gesture of the step
   (every page), in the **other** documents and in the documents that **amend** the cited one
   (`rag_related <docId#anchor>` lists them, kind `amends`) — not with one top-10 search. Read each
   hit's section before concluding. When a passage disagrees, apply the precedence of the project
   `CLAUDE.md` and of `doc.json` (`status`; an amendment wins over what it amends): say
   which one wins, or that none does.

## Finding kinds

Use exactly these `kind` values:

| kind | when |
|---|---|
| `unsupported` | the cited passage does not say what the expected result claims |
| `contradicted` | a passage says otherwise |
| `wrong-requirement` | a linked requirement is not verified by the step |
| `requirement-not-covered` | a requirement in the test's scope is verified by no step |
| `wrong-object` | the step tests another object or screen than its requirement describes |
| `negative-missing` | the negative path (refusal, other type, error) is not tested |
| `case-missing` | a type or state the documents describe is not tested |
| `not-simulated-unsourced` | "not simulated" (or equivalent) written without a source saying so |
| `vague-result` | an expected result a tester cannot observe or decide |
| `documents-conflict` | two documents disagree and precedence does not settle it |
| `other` | anything else worth the reviewer's eye |

`severity`: `error` when a tester following the test would pass a wrong behavior or fail a right one;
`warning` for gaps and vague results; `info` otherwise.

## Output

Call `check_record` **exactly once**, with every finding:

```json
{ "id": "<test id>", "findings": [
  { "step": 2, "kind": "wrong-requirement", "severity": "error",
    "message": "EXI_MOP_SPF_510_A_20 porte sur le TCO à deux rangs, pas sur le menu contextuel testé ici.",
    "sources": ["SOSIE_211_D401-1_3#req:EXI_MOP_SPF_510_A_20"] }
] }
```

- `step`: the step number (1-based); leave it out for a finding about the whole test.
- `message`: one sentence, in the project language, naming the exact discrepancy ("the passage lists
  seven menu actions for a sectionneur sans TK; the step expects a single 'change state' entry").
- `sources`: the `docId#anchor` references that prove it (`§5.6.6`, `req:ID`, `fig:40`).

No finding is a valid result: call `check_record` with `"findings": []`. Then reply in one line with the
count by severity.

## Claude actions (optional)

When you are sure you could correct a finding yourself in a later run — the right passage is in the
documents, the fix is in the test — propose it with `actions_propose`, using the `runId` your prompt
gives you. The user sees a « Claude action » button next to the finding and decides whether to run it.

```json
{ "runId": "<runId>", "problem": "<the finding's message, verbatim>",
  "title": "Cite the source of step 4", "why": "§5.6.6 states the expected menu.",
  "plan": ["Read §5.6.6", "Rewrite the expected result", "Add the source line"],
  "scope": { "kind": "step", "testId": "<test id>", "step": 4 } }
```

At most 3, never for a choice only the team can make (the documents contradict each other, a
requirement is missing). The finding is still recorded with `check_record`.
