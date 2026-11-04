import * as stylex from "@stylexjs/stylex";
import { Marked } from "../../../components/ui/Marked.tsx";
import { color, fontFamily, fontSize, lineHeight } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  row: { fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  snippet: {
    fontFamily: fontFamily.reading,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    color: color.textMuted,
  },
  passage: {
    fontFamily: fontFamily.reading,
    fontSize: fontSize.body,
    lineHeight: lineHeight.reading,
    color: color.text,
  },
});

const TITLE = "Sectionneur — ouverture refusée";
const SNIPPET = "…le poste refuse l'ouverture du sectionneur tant que la ligne est sous tension…";
const PASSAGE =
  "Lorsque l'opérateur demande l'ouverture, le système vérifie l'état de la ligne. Si la ligne est sous tension, la commande est refusée et le motif est affiché dans la barre d'état.";
const QUOTE = "la commande est refusée et le motif est affiché";
const LONG = `${PASSAGE} ${PASSAGE} ${PASSAGE}`;
const at = (text: string, words: string, from = 0): [number, number] => {
  const i = text.indexOf(words, from);
  return [i, i + words.length];
};

export const section: KitSection = {
  name: "Marked",
  family: "Collections",
  file: "Marked.tsx",
  summary:
    "A text with some of its words highlighted: what a search matched (the palette, the test list) or what a source quotes inside its passage (with a soft halo). The text is shown as it is; the marks are offsets into it.",
  states: () => (
    <States>
      <Cell label="search: a title" column>
        <span {...stylex.props(styles.row)}>
          <Marked text={TITLE} marks={[[0, 11]]} />
        </span>
      </Cell>
      <Cell label="search: several matches in a snippet" column>
        <span {...stylex.props(styles.snippet)}>
          <Marked text={SNIPPET} marks={["ouverture", "sectionneur", "tension"].map((w) => at(SNIPPET, w))} />
        </span>
      </Cell>
      <Cell label="no match" column>
        <span {...stylex.props(styles.row)}>
          <Marked text={TITLE} marks={[]} />
        </span>
      </Cell>
      <Cell label="quote: the words a source cites" wide column>
        <p {...stylex.props(styles.passage)}>
          <Marked text={PASSAGE} marks={[at(PASSAGE, QUOTE)]} look="quote" />
        </p>
      </Cell>
      <Cell label="very long text, the quote far in" wide column>
        <p {...stylex.props(styles.passage)}>
          <Marked text={LONG} marks={[at(LONG, QUOTE, PASSAGE.length * 2)]} look="quote" />
        </p>
      </Cell>
    </States>
  ),
};
