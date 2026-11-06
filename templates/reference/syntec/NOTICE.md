# Reference document

Testimus measures its search packs on this folder: the same test on every PC, no project needed (ARCHITECTURE.md §6 « Reference document »).

- `docs/syntec/doc.md`: the articles of the Convention collective nationale des bureaux d'études techniques, des
  cabinets d'ingénieurs-conseils et des sociétés de conseil (Syntec, IDCC 1486), as published by the Syntec
  federation (https://www.syntec.fr/convention-collective/).
- `eval/behaviors.jsonl`: the 100 questions of SyntecRetrieval, each with the article that answers it.

Both come from the MTEB-French dataset `lyon-nlp/mteb-fr-retrieval-syntec-s2p` (Apache-2.0), introduced in
« MTEB-French: Resources for French Sentence Embedding Evaluation and Analysis » (Ciancone, Kerboua, Schaeffer,
Siblini, 2024 — https://arxiv.org/abs/2405.20468). Testimus only reformats them: one heading per article with its
dataset id as anchor, one behavior line per question.
