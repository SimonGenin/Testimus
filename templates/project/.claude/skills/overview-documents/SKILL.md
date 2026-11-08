---
name: overview-documents
description: Write or update docs/OVERVIEW.md, the page that says how a project's documents fit together — what each document is, what it covers, how the documents refer to, amend or contradict one another. Use when Testimus asks for it after an import or a conversion, or when asked to rewrite it.
---

# How the documents fit together

`docs/OVERVIEW.md` is read before the other runs start (generation, check, chat…): it tells them which document to
open for what, which one wins, and where the documents disagree. It is background, never a source — tests cite
the documents themselves.

It is the only file under `docs/` you may write. Testimus owns its frontmatter (the lines between `---` at the top:
when it was updated, after what, what each document was when it was read): never change those lines.

## Its shape

Write in the project's language. One `##` section per document, its heading ending with the document's id in a
comment, so Testimus knows whose section it is:

```markdown
## Traction — spécification fonctionnelle <!-- doc SOSIE_211_D401-1_3 -->

Ce que le document décrit (2 à 5 phrases) : son objet, les écrans ou fonctions qu'il couvre, sa version et son
statut, s'il amende un autre document. Ce qu'on y cherche : « la manœuvre des sectionneurs est au §5.6 ».
```

Then the sections across the documents, after those of the documents, titled in the project's language:

- **the corpus** — what the set is, in a few sentences: how many documents, of which kinds (specifications, minutes,
  photos and videos of the real system), which part of the system each family covers;
- **the links** — which document refers to which (« SOSIE_212 §4.2 renvoie à Traction §5.6 »), which ones describe the
  same function from two sides;
- **the amendments** — what amends what, and which version wins;
- **what contradicts** — where two documents disagree, or where photos and videos of the real system differ from a
  specification; say both sides with their anchors. Photos and videos are observed: they say what the system does,
  not what it must do.

Name a place with `docId#anchor` (`SOSIE_211_D401-1_3#§5.6.6`, `RECETTE_TCO_12-10#img:3`), with a short exact quote
when a sentence states what a document says. Keep each document's section short: the overview is read by every run.

## Updating it after an import

Testimus lists what changed since the last update: documents added, converted again, removed, with a card and an
outline of each changed one. Read the file, then change it **in place with Edit**:

1. add the section of each document added, after the other documents' sections;
2. bring up to date the section of each document converted again (read it again with `docs_show`, `rag_search` when
   its outline is not enough);
3. delete the section of each document removed;
4. change the sections across the documents only where these changes touch them — a new link, an amendment, a
   contradiction found or gone.

Everything else stays **word for word**: the sections of the documents that did not change, and what the team wrote
by hand — a sentence, a section of their own. Merge into it, never drop it. Testimus compares the sections after
the run and reports any change to a section whose document did not change.

## Writing it from scratch

When asked to write it whole, use Write on `docs/OVERVIEW.md`: every document's section, then the sections across
them. Look at each document's outline, open what you need (`docs_show { id, brief: true }`, `rag_related`,
`rag_mentions` for the codes several documents share) to find the links, the amendments and the contradictions.

## Tools

- `docs_list`, `docs_show { id, brief: true }` (outline and figures), `docs_show { id, anchor }` (a part);
- `rag_search`, `rag_mentions <term>` (every passage holding a term: find where documents share a code),
  `rag_related <ref>` (references both ways, amendments);
- `media_show { doc }` for a document of photos or videos.
