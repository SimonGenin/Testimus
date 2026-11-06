---
name: docx-ingest
description: Converting a client specification (.docx first, .pdf as fallback) into a Testimus document folder — doc.md with stable anchors (section numbers, figures), figures extracted in reading order, doc.json metadata — and checking the result. Use when building or debugging docs.add / docs.convert, or when a converted document looks wrong.
---

# Document ingestion

Target shape: ARCHITECTURE.md §5. The conversion is good when every section and figure of the original can be
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

## PDF

A .pdf added beside a .docx of the same name is converted from the .docx; the .pdf is kept as
`source.pdf` and lends the pictures the .docx lacks (`addDoc`).

**Tagged PDF first** (`convert-pdf-tags.ts`). Word's « Save as PDF » and Chrome's print write a
structure tree: H1…H6, P, L/LI/Lbl/LBody, Table/TR/TH/TD, Figure (with a BBox), Caption; headers and
footers are marked Artifact. The tagged reader follows it in reading order: real tables, real lists,
no page chrome to guess. It is used only when the tags hold ≥ 98 % of the text and at least one
heading; otherwise the layout reader below runs (Desiro ISR: 13 % of its text outside the tags;
ROI-AFTT: tags without headings).

- Heading numbers. Word draws the list number of a heading but often leaves it out of the text. The
  number is taken from the heading text, else the bookmarks (outline), else the tagged table of
  contents (its indentation gives the depth), else « x » when the next heading is « x.1 ». A number
  that is only drawn is **never counted up**: counting gave « 1.1.5.1 » for bullets of RS-CPN whose page
  shows « Art. A.3.1. ». Such headings keep a title anchor and a warning says to add the .docx.
- Figures: a Figure tag is cut from the page with its BBox — the raster when one picture fills the box,
  else a render of the region (`pdf.ts` `shoot`, @napi-rs/canvas, already shipped by pdfjs-dist). A
  picture tagged as plain content, or not tagged at all (Chrome), is kept where it sits. A complete
  caption paragraph whose previous paragraph holds drawn shapes (Word's drawing canvas, labels typed
  inside) gets the ink resting on it (`inkAbove`). Path bounds from the operator list are not
  reliable under scaled form XObjects — use them only to know *that* something is drawn.
- A table or paragraph cut by a page break is joined again; a caption beside a table captions it.

**Layout reader** (`convert-pdf.ts`, untagged PDFs): lines by position and font size; headings
from numbering; a caption without a picture above gets the drawn region between it and the text
above; a page with no text (a scan) is kept whole as a picture that Claude's figure descriptions read.

**Captions**: `Figure 5-21: …` is figure « 5-21 » (chapter numbering). « Figure 6-11 presents … »
and a line « Figure 5-21. » ending a sentence are not captions. « … Figure 18 – Boîte de dialogue » at
the end of a sentence is a reference when Figure 18 is captioned elsewhere, else a figure the original
lost.

**Warnings that are true, and nobody but the client can fix**: Traction 01.01 figures 28–42 are
flattened to text *in the client's own PDF and .docx* (page 56: « État contrôlé Aspect … Figure 30 – … »
with nothing drawn). The warning says so; a reconversion cannot help.

## Claude studies it first (`study`)

`docs.add` / `docs.convert` with `study` (the « Claude studies the original first » box under Convert):
Claude reads `docs.inspect` (the deterministic profile: tags and their share of the text, bookmarks,
tagged TOC, headings with or without a number in their text, pages without text, captions, tables;
for a .docx heading styles, shapes, charts, EMF/WMF, comments; `hints` say what each fact means) and
a few pages drawn by `docs.page` (`.testimus/pages/<id>/p<n>.png`, `pdf.ts` `renderPage`). It
answers a `conversion` block — `from` (docx/pdf), `reader` (tagged/layout), `numbers` (heading
numbers read on the pages), `notes` — kept in `doc.json.conversion` and honoured by every
reconversion (`convertedCopy`, `ConvertOpts.reader`/`numbers`). After the conversion a second run
compares `doc.md` with the pages (runtime skill `study-document`); a different `conversion` block
converts once more, anything else becomes a Claude action. Both runs are kind `study`: read-only plus
`actions.propose`. No PDF copy → both runs are skipped. The team sets the same options with
`docs.convert --conversion '{…}'` (`{}` clears them), and `docs.convert --docx` attaches the .docx of a
document added from its .pdf.

Measured 2026-11-03: SOSIE_441 without its .docx — 17 headings drawn without their numbers; Claude
(sonnet, low, ~40 s for both runs) read the 17 numbers on the pages and the anchors equal the .docx
conversion's, 17/17.

## Check a conversion

1. Count headings and figures in the original (docx XML or PDF text) vs `doc.md`; any difference is a
   finding.
2. Open three random figures and their surrounding text: right image, right place.
3. Pick five sections of the table of contents; `testimus rag passage <doc>#§<n>` must show their text.
4. Reconvert: anchors must not move.
5. Compare with the .docx when there is one: the heading anchors of the tagged PDF and of the .docx
   must be the same set (measured 2026-11-03 on J5: Traction 286/286, PCC NG 221/221, CAD 28/28,
   TOC 17/17, Machine Départ 77/77). A heading that skips a level counts like Word: under « 8 », a
   level-3 heading is « 8.1.1 » and the next level-2 one is « 8.2 » (the skipped 8.1 is used up).

Real PDFs to try a change on (read-only copies, never commit them): the J5 deliveries
(`…\14 - Livraisons documentaires\J5\D401-1 Specifications Fonctionnelles - J5`, .pdf and .docx side
by side) and the technical manuals in `C:\Users\s.genin\Downloads` (ATS, MWS, Desiro, SSR exports, the
NT_05_530 scan).
Run old and new side by side on all of them before calling a converter change done.

The RATP documents already converted for the Sosie code
(`D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\documentation\`, e.g.
`traction\documentation-traction.md` for `SOSIE_211_D401-1_3`) are a useful comparison.
