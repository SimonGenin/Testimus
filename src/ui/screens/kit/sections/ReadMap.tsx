import { ReadMap } from "../../../components/ui/ReadMap.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const D401 = [
  { label: "§5", title: "§5 Traction", line: 3 },
  { label: "§5.6", title: "§5.6 Objets de traction", line: 9 },
  { label: "§5.6.6", title: "§5.6.6 Le sectionneur avec TK", line: 13 },
  { label: "§5.6.7", title: "§5.6.7 Les disjoncteurs", line: 27 },
];

// a guide whose headings carry no number: the chapters are named by their heading, several of them long and close
const GUIDE = [
  { label: "Table of contents", line: 1 },
  { label: "Queues", line: 9 },
  { label: "Selecting a queue", line: 12 },
  { label: "Sending a verification job", line: 14 },
  { label: "Managing queues and workers in production", line: 120 },
  { label: "Reference", line: 186 },
];

export const section: KitSection = {
  name: "ReadMap",
  family: "Claude",
  file: "ReadMap.tsx",
  summary:
    "Where Claude read in a document: its lines as a bar cut by chapter, what it read, the sections it opened from the index, and a legend.",
  note: "What Claude did draws one per document it read (design _docs.mjs docBar). The chapters are named in a grid that follows their length, so a long or a close name is cut, never laid over the next one.",
  guidelines: [
    {
      head: "Anatomy",
      text: "The bar is the document, one line per share of its width, cut at each chapter · the lines read in Claude's light tone, the last range of a live run in its full tone · each section opened from the index in the full tone over its whole extent (a figure: its line) · the chapters named under the bar, each in its own share; a chapter under 8 % of the document keeps its cut but not its name · the legend: what was read, then the sections opened, as Claude badges with their heading as a tooltip.",
    },
    {
      head: "Rules",
      text: "A chapter or a section is named by its number (« §5.6 ») when it has one, else by its heading. Never a pin above the bar: what was opened is drawn on the bar, where it is. A section the owner can open (onOpen: What Claude did opens its passage) has its badge as a button, drawn outline; one the document does not have stays a plain badge.",
    },
  ],
  states: () => (
    <States>
      <Cell label="read front to back · two sections opened, which open their passage" wide column>
        <ReadMap
          total={30}
          chapters={D401}
          read={[{ from: 1, to: 26 }]}
          opened={[
            { label: "§5.6", title: "§5.6 Objets de traction", from: 9, to: 12, onOpen: () => {} },
            { label: "§5.6.6", title: "§5.6.6 Le sectionneur avec TK", from: 13, to: 26, onOpen: () => {} },
          ]}
          summary="Lines 1–26 of 30, front to back; nothing read twice."
        />
      </Cell>
      <Cell label="live: the page being read" wide column>
        <ReadMap
          total={30}
          chapters={D401}
          read={[
            { from: 1, to: 8 },
            { from: 9, to: 15 },
          ]}
          live
          summary="Lines 1–15 of 30 so far, in 2 pages, front to back; nothing read twice."
        />
      </Cell>
      <Cell label="only a section opened from the index · long chapter names, close together" wide column>
        <ReadMap
          total={200}
          chapters={GUIDE}
          opened={[{ label: "Sending a verification job", title: "§sending-a-verification-job", from: 14, to: 119 }]}
        />
      </Cell>
      <Cell label="read in one go · no chapter" wide column>
        <ReadMap total={84} read={[{ from: 1, to: 84 }]} summary="Read in one go; nothing read twice." />
      </Cell>
      <Cell label="the document's length not known yet" wide column>
        <ReadMap total={0} />
      </Cell>
    </States>
  ),
};
