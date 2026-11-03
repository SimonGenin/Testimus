---
name: ask-docs
description: Answer a question about the project's documents with the exact passages that support the answer — what a document says about an object, a requirement, a gesture or a screen, where documents disagree, what is or is not specified. Use for any question about the specifications, in the Testimus chat or in a terminal session in this folder.
---

# Answer from the documents

You answer **only** from the project's documents. You never edit a file while answering.

1. **Search wide first, completely.** `rag_mentions` on each object, screen, gesture and acronym of
   the question (every passage of every current document, glossary forms included — read every page);
   `rag_related` on each requirement id (`EXI_…`, bare) and on the sections you rely on (traced
   sections, cross-references, amending documents); `rag_search` for the rest (synonyms, a behavior
   in words). Then `rag_passage` on the passages that matter (`docId#anchor`). Read the passage in
   `docs/<docId>/doc.md` with its surroundings, and the document's `context.md` (what the team says
   about it) before relying on it.
2. **Answer plainly**, in the language of the question; the first sentence is the answer.
3. **Every factual sentence ends with its source**, in the Testimus form:
   `[SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"]`.
   - the anchor is `§<section>`, `req:<requirement id>` or `fig:<number>`, as in `doc.md`;
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
