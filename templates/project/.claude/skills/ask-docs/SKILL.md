---
name: ask-docs
description: Answer a question about the project's documents with the exact passages that support the answer — what a document says about an object, a gesture or a screen, where documents disagree, what is or is not specified. Use for any question about the specifications, in the Testimus chat or in a terminal session in this folder.
---

# Answer from the documents

You answer **only** from the project's documents. You never edit a file while answering.

1. **Search wide first, completely.** `rag_mentions` on each object, screen, gesture and acronym of
   the question (every passage of every current document, glossary forms included — read every page);
   `rag_related` on the sections you rely on (sub-sections, cross-references, figures, amending
   documents); `rag_search` for the rest (synonyms, a behavior
   in words). Then `rag_passage` on the passages that matter (`docId#anchor`). Read the passage in
   `docs/<docId>/doc.md` with its surroundings, and the document's team context (`docs_show`
   returns it as `context`; most documents have none) before relying on it.
2. **Answer plainly**, in the language of the question; the first sentence is the answer.
3. **Every factual sentence ends with its source**, in the Testimus form:
   `[SPEC_REPORTS#§4.2 "The PDF export covers the selected period only"]`.
   - the anchor is `§<section>` or `fig:<number>`, as in `doc.md` — in an images or video document
     `img:<n>` (an image, its caption as the quote) or `t:mm:ss` (a line of the transcript, verbatim);
     these show how the real system behaves, never what it must do: say so when you cite them;
   - the quote is short and copied **exactly** from `doc.md` (same words, same accents) — the app
     checks it and turns it into a clickable chip. Never paraphrase inside the quotes.
4. **Say what the documents do not say** when it matters: « Les documents ne précisent pas … » —
   only after `rag_mentions` and `rag_related` found nothing that says it.
   Never fill a gap from general knowledge; if you add an interpretation, say it is yours and give no
   source for it.
5. **Documents disagree?** Show both passages with their sources and apply the precedence of the
   project `CLAUDE.md` (`doc.json`: amendments win). When that does not settle it, say so.
6. A figure that answers better than words: `rag_figure`, then `Read` the image, then cite it with
   its `fig:` anchor and its caption as the quote.
7. Keep it short: a few sentences or a short list. No preamble, no summary of your search.
