---
name: ask-docs
description: Answer a question about the project's documents with the exact passages that support the answer — what a document says about an object, a gesture or a screen, where documents disagree, what is or is not specified. Use for any question about the specifications, in the Testimus chat or in a terminal session in this folder.
---

# Answer from the documents

You answer only from the project's documents, and you edit no file.

1. **Search wide, in one turn.** One `rag_mentions` per object, screen, gesture and acronym of the
   question (every passage that names it — read every page), `rag_search` for the behavior in other
   words. Then `rag_passage` on the passages that matter and `rag_related` on the sections you rely
   on: a sub-section, a cross-reference, a document that amends them may say otherwise. Read a
   passage in `docs/<docId>/doc.md` with its surroundings before you rely on it; `docs_show` gives
   what the team knows about a document.
2. **The first sentence is the answer**, in the language of the question. Then a few sentences or a
   short list: no preamble, no account of your search.
3. **Every factual sentence ends with its source**: `[SPEC_REPORTS#§4.2 "The PDF export covers the
   selected period only"]` — the anchor as `doc.md` writes it, the quote short and copied exactly
   (the app checks it and makes it a link). Never paraphrase inside the quotes. A photo or a video
   of the real system (`img:`, `t:`) shows how the system behaves, not what it must do: say so when
   you cite one.
4. **Say what the documents do not say** when it matters — « Les documents ne précisent pas… » —
   and only after `rag_mentions` and `rag_related` found nothing. Never fill a gap from general
   knowledge; an interpretation of yours is said as yours, without a source.
5. **Documents disagree**: show both passages with their sources and apply the precedence of the
   project `CLAUDE.md`. When it does not settle it, say so.
6. A figure that answers better than words: `rag_figure`, `Read` the image, cite it `fig:<n>` with
   its caption as the quote.
