---
name: study-document
description: Study a client document before Testimus converts it (which copy, which PDF reader, heading numbers printed on the page but missing from the text; for a table — .csv, .tsv — what it is, what each column holds and how its rows become sections), and compare the converted doc.md with page images of the original afterwards — headings and their numbers, tables, figures at the right place, nothing dropped. Use when Testimus asks for a study, a table reading or a conversion check, or when asked whether a document was converted well.
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

## A table

A `.csv` or `.tsv` becomes one section per row, under its title: the row's heading is its key
and its title, its text one line per column (`- **Column** : value`). The columns head the
document, each with the meaning you give it — shown beside the name and searched, never quotable.
A test cites a row as `§<key>` and quotes a value as the row writes it. The request gives what
Testimus read: each column's fill, its distinct values and a few of them, and its own guess.
`Read` the original for more rows when the samples leave a column unclear — its first lines, a
few in the middle — never the whole of a long file.

- **about** — what the table is, in one or two sentences: alarms of a sub-system, a list of
  requirements, the signals of an interface, a matrix of states…
- **columns** — every column, by its name exactly as in the profile: `meaning` says what it holds
  and how to read its values — a code and what it stands for, a unit, the meaning of
  abbreviations and of each value of a short list (« 1 = minor, 3 = critical » when the values
  show it), the column it refers to. What the header and the values show, never a guess about the
  product: « unclear » is an answer. `skip: true` only for a column empty on every row, internal
  to the tool that exported it (a database id, a last-modified stamp) or a copy of another.
- **key** — the column whose value names a row: an id, a code, a reference, filled on every row
  and its own on each (`unique` in the profile). It anchors the row (`§ALM-012`), so every test
  citing it follows it through a new export: never a row number or a column whose values repeat.
  None fits → leave it out: rows are then named by their title.
- **title** — a short column that says what the row is (a label, a name), when there is one.
- **group** — a column whose few values cut the rows into parts (a chapter, a sub-system, a
  category), when reading by part helps; a group for each row is no group.
- **delimiter**, **headerRow** — only when Testimus' guess is wrong (one column holding whole
  lines, a header that is a title line).

**An Excel workbook** (`.xlsx`, `.xlsm`) is read sheet by sheet: the profile gives each sheet by
its name — dates already written as `2025-03-12`, percentages as `12.5%`, a merged cell's value in
each of its cells, a formula's last value — and the sheets Testimus left aside (hidden, empty).
`Read` cannot open a workbook: work from the profile. Answer `{ "sheets": [...] }`, each sheet
by its name with the fields above (no delimiter); `skip: true` for a sheet that is not data a
tester looks up — a cover, a revision history, a blank form, a list of values only the other
sheets use. A workbook left with one sheet reads as a table alone; with several, each is a
section (`§<sheet>`) with its own `§<sheet>-columns`.

## Reply

A table: only the `table` block. A study: only the `conversion` block. A check: the block when
other options are better, then one line — what you compared and what differs.
