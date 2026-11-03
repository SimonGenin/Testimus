---
name: study-document
description: Study a client document before Testimus converts it (which copy, which PDF reader, heading numbers printed on the page but missing from the text), and compare the converted doc.md with page images of the original afterwards — headings and their numbers, tables, figures at the right place, nothing dropped. Use when Testimus asks for a study or a conversion check, or when asked whether a document was converted well.
---

# Study a document, check its conversion

A document is good to work from when every heading, table and figure of the original can be pointed at in
`docs/<id>/doc.md` with a stable anchor, and nothing was silently dropped. You cannot edit anything under
`docs/`: the conversion is changed only through its options, and the options are kept in `doc.json` so
every later reconversion gives the same result.

## Tools

- `docs_inspect { id }` — the profile of the copies in the document's folder (`source.docx`,
  `source.pdf`): tags, bookmarks, table of contents, headings with and without a number in their text,
  pages without text, pictures, captions, tables; for a .docx, heading styles, shapes, charts, EMF/WMF,
  comments. Its `hints` say what each fact means for the conversion. Trust its counts.
- `docs_page { id, page }` draws a page of the PDF copy as a PNG; `Read` the `file` it returns.
  `region: [left, top, right, bottom]` (fractions of the page from its top left) zooms on a part when
  small print matters. A document with only a .docx has no page to draw.
- `docs_show { id, anchor }` — a part of `doc.md`: `page:N` (PDF conversions), `§5.2` (a section and its
  subsections), `fig:12`; `docs_show { id, brief: true }` gives the outline and the figures.

## Before the conversion

Look at the inspection first, then at a handful of pages — at least three, always: the cover, a table of contents page, two body
pages with headings, a page with a figure or a table, a page without text if there is one. Choose only
what Testimus would not do well by itself:

- **from** (`"docx"` / `"pdf"`, only when both copies are there). The .docx is converted by default: its
  numbering and styles are exact. Prefer the .pdf only when what matters is drawn: many shapes or charts
  drawn in Word (the .docx keeps only their labels) and few headings numbered by Word.
- **reader** (`"tagged"` / `"layout"`, PDF only). Testimus reads the tags when they hold ≥ 98 % of the
  text and a heading. Force `"tagged"` when the tags miss only page furniture (the pages show nothing the
  tags lack); force `"layout"` when the tagged headings are wrong (titles tagged as paragraphs, body text
  tagged as headings).
- **numbers** (PDF only) — when the inspection says headings carry no number in the text and neither
  bookmarks nor a numbered table of contents give them back, but the pages print them (Word draws list
  numbers without writing them, e.g. a PDF printed from Word without its .docx). Read every such heading on the pages,
  in reading order — the table of contents pages are the quickest — and give `{ number, title }` with
  the number as printed (`2.3.1`, `A.3.1`) and the title without its number, as printed. Give a number
  only where you read it; never count one up. Skip it when there are hundreds and no table of contents
  shows them: say so in the notes instead.
- **notes** — one to three sentences in English for the check after the conversion: caption style
  (« Figure N – … », « Figure 5-21: … », « Tableau N » which stays text), numbering style, scanned
  pages, parts worth comparing.

## After the conversion

Compare `doc.md` with the original's pages, not with the profile alone — a check that opened no page
checked nothing. Draw and `Read` at least three pages, and every page `doc.md` makes you doubt
(an odd heading order, a figure without caption, a short section):

1. **Outline.** `docs_show { id, brief: true }` against the table of contents pages: same headings, same
   numbers, same order and depth. A heading anchored by its title (`§generalites`) where the page prints
   a number is a finding.
2. **Tables.** Two or three tables: same rows and columns, cells in the right place, a table cut by a
   page break joined once. A table flattened to text is a finding (the layout reader does that).
3. **Figures.** Three figures: the picture under `figures/` is the one printed above its caption, at the
   same place in the text; `fig:N` follows the caption number. A caption with nothing drawn above it
   may be true of the original (a drawing pasted as text) — check the page before calling it lost.
4. **Nothing dropped.** For a few pages, the last paragraph of the page appears in `doc.md`; pages
   without text are kept as page pictures (nothing on them can be quoted).
5. **Warnings.** Each conversion warning listed in the request: true of the original, or fixable?

Then act, in this order:

- **Other options fix it** (the other copy, the other reader, numbers read on the pages): reply with a
  ```` ```conversion ```` block holding all the options — it replaces the current ones and Testimus
  converts once more. Keep the options that were right.
- **Something else could fix it** in a later run — the .docx saved beside the original is not attached
  (`docs_inspect` gives its path as `twin`; `docs_convert { id, docx }` attaches it), a figure the
  conversion lost but the .pdf shows: propose it with `actions_propose` (the request gives the runId).
- **Nobody but the client can fix it** — a drawing flattened to text in the client's own files, a scan
  with no source: say it in your last line, propose nothing.

## Reply

Only the `conversion` block when asked for a study. After a check: the block if other options are
better, then one line — what you compared and what differs.
