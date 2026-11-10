import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { held, type Piece, tokens } from "./given.ts";

const styles = stylex.create({
  name: { display: "flex", alignItems: "flex-start", gap: space.s3, minWidth: 0 },
  icon: { flex: "none", display: "inline-flex", marginBlockStart: space.s1, color: color.textMuted },
  words: { display: "flex", flexDirection: "column", minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: color.textMuted },
  share: { color: color.textSubtle },
});

const KIND: Record<Piece["kind"], { icon: IconName; word: string }> = {
  instruction: { icon: "send", word: "Instruction" },
  skill: { icon: "layers", word: "Skill" },
  rules: { icon: "file", word: "Project file" },
  tools: { icon: "terminal", word: "Tools" },
  overview: { icon: "tree", word: "Written by Claude" },
  context: { icon: "context", word: "Saved context" },
  document: { icon: "documents", word: "Document" },
  docnote: { icon: "quote", word: "Team note on a document" },
  note: { icon: "keyboard", word: "Your note" },
  conversation: { icon: "history", word: "Conversation" },
};

const HOW: Record<Piece["how"], { word: string; tip: string }> = {
  inline: { word: "Said in full", tip: "Its text is in the prompt." },
  pointer: { word: "Pointed at", tip: "The prompt tells Claude where to read it." },
  auto: { word: "Loaded by Claude Code", tip: "Claude Code loads it by itself as the run starts." },
  search: { word: "Searched", tip: "Claude finds passages in it with the search tools: it is never sent whole." },
};

// ponytail: the pieces of one request, in the order they are said — what each is, why it is there (who attaches it),
// how it reaches Claude and what it weighs, with its share of what Claude holds as it starts so the heavy ones show.
// A row opens its piece (the card beside shows its text). Kept on its own: a graph may draw the same pieces later
export function PieceList({
  label,
  pieces,
  total,
  selected,
  onSelect,
  loading = false,
}: {
  /** what these pieces are (« What Claude is asked »): the table's accessible name */
  label: string;
  pieces: Piece[];
  /** the characters Claude holds as the run starts, over the whole request: a piece's share is of it */
  total: number;
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}) {
  return (
    <Table
      label={label}
      dense
      rows={pieces}
      getKey={(p) => p.id}
      selected={selected}
      onRowSelect={onSelect}
      loading={loading}
      empty="Nothing."
      columns={[
        {
          key: "piece",
          label: "Piece",
          width: "34%",
          render: (p) => (
            <span {...stylex.props(styles.name)}>
              <span {...stylex.props(styles.icon)}>
                <Icon name={KIND[p.kind].icon} />
              </span>
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(type.medium, !p.on && styles.muted)}>{p.name}</span>
                <span {...stylex.props(type.small, styles.muted)}>{KIND[p.kind].word}</span>
              </span>
            </span>
          ),
        },
        {
          key: "why",
          label: "Why it is there",
          render: (p) => <span {...stylex.props(type.small, styles.muted)}>{p.why}</span>,
        },
        {
          key: "how",
          label: "How",
          render: (p) =>
            p.on ? (
              <Badge size="sm" label={HOW[p.how].word} tooltip={HOW[p.how].tip} />
            ) : (
              <Badge size="sm" icon="eye-off" label="Not sent" tooltip="Saved, and not attached to this run." />
            ),
        },
        {
          key: "weight",
          label: "Weight",
          numeric: true,
          render: (p) =>
            p.chars > 0 && (
              <>
                {tokens(p.chars)}
                {held(p) && total > 0 && (
                  <span {...stylex.props(styles.share)}> · {Math.round((p.chars / total) * 100)} %</span>
                )}
              </>
            ),
        },
      ]}
    />
  );
}
