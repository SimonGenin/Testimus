---
name: docx-ingest
description: Converting a client specification (.docx first, .pdf as fallback) into a Testimus document folder — doc.md with stable anchors (section numbers, requirement ids, figures), figures extracted in reading order, doc.json metadata — and checking the result. Use when building or debugging docs.add / docs.convert, or when a converted document looks wrong.
---

# Document ingestion

Target shape: SPEC §4. The conversion is good when every section, requirement id and figure of the
original can be pointed at by a stable anchor and nothing was silently dropped.

## Never touch the original

Copy the file first (SharePoint-synced files can refuse to be opened as zip in place). The copy goes
to `docs/<docId>/source.<ext>`; `doc.json.source` keeps the original path and its sha256.

## docx (preferred)

- In-app: `mammoth` (docx → HTML with images), then HTML → Markdown with our own anchor pass.
- Reference pipeline already used on this PC, to compare against when the in-app result is in doubt:
  1. `npx -y @firecrawl/anydoc <copy.docx> -o <raw.md>` — text and tables only;
  2. `python -X utf8 D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\scripts\inline-figures.py
     <copy.docx> <raw.md> <out.md> <figures-dir>` — puts the images back in place.
- Known losses (write them into `doc.json.warnings`): Word comments; shapes drawn in Word (labels
  only); `.emf` / `.wmf` need conversion to PNG (PowerShell `System.Drawing.Imaging.Metafile` works on
  this machine); a relation written `Target` before `Id`, and VML images, are traps
  `inline-figures.py` already handles — mirror its handling.

## Anchors

- Heading: the section number as written (`5.6.6`) → `<!-- § 5.6.6 -->`. A heading with no number
  gets its slugified title. Never a position counter: anchors must survive a reconversion.
- Requirement ids: any `EXI_[A-Z0-9_]+` (and the project's other id patterns from `project.json`)
  → `<!-- req <id> -->` at the paragraph that defines it.
- Figures: `<!-- fig <n> -->` with the number from the caption (`Figure 40 – …`), else `f<order>`.
- PDF only: `<!-- page <n> -->` at each page break.

## PDF fallback

`pdfjs-dist` for text; figures by rendering the page region of each `Figure N` caption. BHP's
`D:\SVN\B040L00192_Australia_BHP_TCC_Sources\.xray\scripts\pdf_catalog.py` does exactly that in
Python (caption detection, regions, red-frame detection) — read it before writing ours.

## Requirement statements and matrices (SPEC-RAG §3)

Nothing extra is written into `doc.md`: `src/core/rag/statements.ts` derives them from it.

- **Statement** of an id: the block after its `<!-- req ID -->`; when that block is the id alone (RATP
  `**EXI_…**`), the following blocks up to the next marker, heading or figure; when nothing follows, its
  matrix row. Never the id alone, never a whole table.
- **Matrix**: a table whose id column holds ids (REQ_PATTERN + `project.json.requirementPatterns`) on at
  least half its rows **and** that has a section column (header `Section` / `Chapitre` / `§` /
  `Paragraphe`, else a column of section numbers). `project.json.requirementMatrix` names the columns
  when the headers say something else. Each row is a `matrix-row` chunk `docId#req:ID@matrix` whose path
  is the traced section.
- An id with a space (`EXI STB F-23`, Instructeur, Modèle train, `SOSIE_c`) cannot be an anchor today
  (`<!-- req … -->` takes one token): such a matrix is detected only with the pattern in
  `requirementPatterns`, and its ids are not anchored. ⚠️ open.
- Seen on J5 (2026-11-02): RATP SPF matrices `Code Exigence(s) | Objet | Section` in Traction, Signalisation,
  Itinéraires, PR2I, Machine Départ, CAD, PTL, PTS, Rupteurs (and `411` with every section « À compléter »);
  PCC NG has `ID Exigence | Source` tables — no section column, so not a matrix; PA documents have none
  (their `Page-§` / `Impact §` cells give section-level `amends` edges instead).

## Check a conversion

1. Count headings, requirement ids and figures in the original (docx XML or PDF text) vs `doc.md`;
   any difference is a finding.
2. Open three random figures and their surrounding text: right image, right place.
3. Pick five requirement ids from the requirements matrix that target this document; each must
   resolve to an anchor, and `testimus rag passage <doc>#req:<id>` must show a `focus` that is the rule,
   not the id.
4. `testimus docs show <doc>`: `info` lists requirements the matrix traces to another section than the
   one defining them — read them, they are often a disagreement inside the document.
5. Reconvert: anchors, matrix rows and statements must not move.

The RATP documents already converted for the Sosie code
(`D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\documentation\`, e.g.
`traction\documentation-traction.md` for `SOSIE_211_D401-1_3`) are a useful comparison.
