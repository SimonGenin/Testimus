---
name: study-document
description: Study a client document before Testimus converts it (which copy, which PDF reader, heading numbers printed on the page but missing from the text), and compare the converted doc.md with page images of the original afterwards — headings and their numbers, tables, figures at the right place, nothing dropped. Use when Testimus asks for a study or a conversion check, or when asked whether a document was converted well.
---

# Study a document, check its conversion

A document is good to work from when every heading, table and figure of the original can be
pointed at in `docs/<id>/doc.md` with a stable anchor, and nothing was silently dropped. You edit
nothing under `docs/`: a conversion is changed only through its options, kept in `doc.json` so every
later reconversion gives the same result.

## Tools

- `docs_inspect { id }` — the profile of the copies in the document's folder (`source.docx`,
  `source.pdf`): tags, bookmarks, table of contents, headings with and without a number in their
  text, pages without text, pictures, captions, tables; for a .docx, heading styles, shapes, charts,
  comments. Its `hints` say what each fact means for the conversion. Trust its counts.
- `docs_page { id, page }` draws a page of the PDF copy as a PNG: `Read` the `file` it returns;
  `region: [left, top, right, bottom]` (fractions of the page from its top left) zooms on small
  print. Ask for the pages you need in the same turn. A document with only a .docx has no page.
- `docs_show { id, anchor }` — a part of `doc.md`: `page:N`, `§5.2` (a section and its
  sub-sections), `fig:12`; a long one a page at a time (`from: <next>` while the answer has `next`).
  `docs_show { id, brief: true }` gives the outline and the figures.

## Before the conversion

The inspection first, then a handful of pages — at least three, always: the cover, a table of
contents page, two body pages with headings, a page with a figure or a table, a page without text
if there is one. Choose only what Testimus would not do well by itself:

- **from** (`"docx"` / `"pdf"`, only when both copies are there). The .docx is converted by default:
  its numbering and styles are exact. Prefer the .pdf only when what matters is drawn — many shapes
  or charts drawn in Word, of which the .docx keeps only the labels — and few headings are numbered
  by Word.
- **reader** (`"tagged"` / `"layout"`, PDF only). Testimus reads the tags when they hold at least
  98 % of the text and a heading. Force `"tagged"` when the tags miss only page furniture; force
  `"layout"` when the tagged headings are wrong (titles tagged as paragraphs, body text as headings).
- **numbers** (PDF only) — when headings carry no number in the text, neither bookmarks nor a
  numbered table of contents give them back, and the pages print them. Read every such heading on
  the pages, in reading order — the table of contents pages are the quickest — and give
  `{ number, title }`, the number as printed (`2.3.1`, `A.3.1`), the title without it. A number only
  where you read it; never count one up. With hundreds of them and no table of contents: say so in
  the notes instead.
- **notes** — one to three sentences in English for the check after the conversion: the caption
  style (« Figure N – … », « Tableau N » which stays text), the numbering style, scanned pages, the
  parts worth comparing.

## After the conversion

Compare `doc.md` with the original's pages, not with the profile alone: a check that opened no page
checked nothing. Draw and `Read` at least three pages, and every page `doc.md` makes you doubt:

1. **Outline.** `docs_show { id, brief: true }` against the table of contents pages: same headings,
   numbers, order and depth. A heading anchored by its title (`§generalites`) where the page prints
   a number is a finding.
2. **Tables.** Two or three: same rows and columns, cells in place, a table cut by a page break
   joined once. A table flattened to text is a finding.
3. **Figures.** Three: the picture under `figures/` is the one printed above its caption, at the
   same place in the text; `fig:N` follows the caption number. A caption with nothing drawn above it
   may be true of the original — check the page before calling it lost.
4. **Nothing dropped.** For a few pages, the last paragraph of the page is in `doc.md`; pages
   without text are kept as page pictures.
5. **Warnings.** Each conversion warning the request lists: true of the original, or fixable?

Then, in this order:

- **Other options fix it** — the other copy, the other reader, numbers read on the pages, a figure
  with no picture that a page of the PDF draws (`figures: [{ key, page, region }]`, the key as in
  `fig:<key>`; draw the region with `docs_page` and `Read` it before you give it: the drawing whole,
  without its caption). Reply with a ```` ```conversion ```` block holding **all** the options: it
  replaces the current ones and Testimus converts once more. Keep the options that were right.
- **Something else could fix it in a later run** — the .docx saved beside the original is not
  attached (`docs_inspect` gives its path as `twin`; `docs_convert { id, docx }` attaches it), a
  figure to recover with `docs_convert { id, conversion }`: leave it as a Claude action, by the rule
  the request gives.
- **Only the client can fix it** — a drawing flattened to text in the client's own files, a scan
  with no source: say it in your last line, propose nothing.

## Reply

A study: only the `conversion` block. A check: the block when other options are better, then one
line — what you compared and what differs.
