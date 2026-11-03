---
name: docx-ingest
description: Converting a client specification (.docx first, .pdf as fallback) into a Testimus document folder — doc.md with stable anchors (section numbers, figures), figures extracted in reading order, doc.json metadata — and checking the result. Use when building or debugging docs.add / docs.convert, or when a converted document looks wrong.
---

# Document ingestion

Target shape: SPEC §4. The conversion is good when every section and figure of the original can be
pointed at by a stable anchor and nothing was silently dropped.

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
- A paragraph in a heading style is a heading, whatever it says: a code alone in a heading style
  (`EXI_…`) becomes a section anchored by its slug.

## Anchors

- Heading: the section number as written (`5.6.6`) → `<!-- § 5.6.6 -->`. A heading with no number
  gets its slugified title. Never a position counter: anchors must survive a reconversion.
- Figures: `<!-- fig <n> -->` with the number from the caption (`Figure 40 – …`), else `f<order>`.
- PDF only: `<!-- page <n> -->` at each page break.
- Codes written in the text (`EXI_…`, `S.1.1.2`) stay plain text: search finds them exactly, they are
  never anchors. An older `doc.md` may still hold `<!-- req … -->` comments; they are ignored like any
  other comment.

## PDF fallback

`pdfjs-dist` for text; figures by rendering the page region of each `Figure N` caption. BHP's
`D:\SVN\B040L00192_Australia_BHP_TCC_Sources\.xray\scripts\pdf_catalog.py` does exactly that in
Python (caption detection, regions, red-frame detection) — read it before writing ours. A numbered
article under the current heading (`S.1.1.2 …`) starts its own paragraph.

## Check a conversion

1. Count headings and figures in the original (docx XML or PDF text) vs `doc.md`; any difference is a
   finding.
2. Open three random figures and their surrounding text: right image, right place.
3. Pick five sections of the table of contents; `testimus rag passage <doc>#§<n>` must show their text.
4. Reconvert: anchors must not move.

The RATP documents already converted for the Sosie code
(`D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\documentation\`, e.g.
`traction\documentation-traction.md` for `SOSIE_211_D401-1_3`) are a useful comparison.
