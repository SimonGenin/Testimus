import { Raw } from "../../../components/ui/Raw.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const OUTPUT = `$ claude -p --output-format stream-json
Read tests/LFRPS12-1420/test.md
Searched « sectionneur menu contextuel »
Edited step 2`;

export const section: KitSection = {
  name: "Raw",
  family: "Feedback",
  file: "Raw.tsx",
  summary:
    "Raw output as it came: Claude's raw output, a job's log, a failure's raw text, a command line. Mono on a sunken well, muted, line breaks kept; a log colours its warnings and errors and shows each line's time.",
  note: "The design's .raw: drawn nine times by the screens, with or without an edge, other paddings, colours and heights.",
  guidelines: [
    {
      head: "Options",
      text: "`text` (kept as it is) or `lines` (a log: level and time) · `maxLines` (it scrolls past that many lines) · `follow` (a live log: it keeps to the end unless scrolled up) · `empty` (shown when there is nothing).",
    },
    {
      head: "Rules",
      text: "Never the only place for what went wrong: a banner or the answer says it in plain words, the raw block is the detail under it, folded by default.",
    },
  ],
  states: () => (
    <States>
      <Cell label="text" wide column>
        <Raw text={OUTPUT} />
      </Cell>
      <Cell label="log lines · time · warn · error · maxLines" wide column>
        <Raw
          label="Live log"
          follow
          maxLines={4}
          lines={[
            { at: "10:42:01", text: "Converting SOSIE_211_D401-1_3.docx" },
            { at: "10:42:03", text: "Figure 12 has no caption", level: "warn" },
            { at: "10:42:04", text: "Indexed 212 sections" },
            { at: "10:42:05", text: "The reranker did not load", level: "error" },
            { at: "10:42:05", text: "Search on words only" },
          ]}
        />
      </Cell>
      <Cell label="empty" column>
        <Raw text="" empty="Nothing logged yet." />
      </Cell>
    </States>
  ),
};
