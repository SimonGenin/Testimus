import * as stylex from "@stylexjs/stylex";
import { TYPE_STYLES, type TypeStyle, type } from "../../../components/ui/type.ts";
import { color } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({ meta: { color: color.textSubtle } });

const SAMPLE: Record<TypeStyle, [use: string, words: string]> = {
  caption: ["12/16 medium, muted", "Step · Action · Expected result"],
  small: ["12/18", "Edited 2 min ago · 3 sources"],
  compact: ["13/20", "Ouvrir le menu contextuel"],
  label: ["13/20 medium (a field's label)", "Expected result"],
  body: ["14/22", "Le poste affiche le motif de l'alarme."],
  titleSm: ["14/20 semibold", "Claude dock"],
  title: ["16/24 semibold, −0.011em", "Sectionneur — ouverture"],
  titleLg: ["22/30 semibold, −0.017em", "Documents"],
  display: ["32/40 semibold, −0.022em", "Testimus"],
  reading: ["16/26 serif", "Selon le type de sectionneur, le menu contextuel diffère."],
  readingHeading: ["18/26 serif semibold", "5.6.6 Menu contextuel"],
  code: ["12/18 mono", "SOSIE_211_D401-1_3 §5.6.6"],
  micro: ["10/12 (the rail's key)", "LFRPS12"],
};

export const section: KitSection = {
  name: "Type",
  family: "Foundations",
  file: "type.ts",
  summary:
    "The design's text styles, from caption to display, with the titles' tightening: a screen composes one of them first — stylex.props(type.title, styles.head) — and never sets a font size, weight, line height or letter spacing itself.",
  note: "Not a component: named StyleX styles (`type.caption` … `type.code`, plus `type.label` for a field's label and the weights `medium`, `strong`, `regular`, `tabular`, `ui`). They replace the .t-* classes of the design kit, so a change of the type scale is made in tokens.css and lands everywhere.",
  guidelines: [
    {
      head: "Use",
      items: [
        "`caption` column heads, list and menu group labels, the step number (muted).",
        "`small` meta lines, badges, hints, timestamps · `compact` rows, menus, chips, tabs, buttons · `label` a field's name.",
        "`body` fields, step text, dialogs, dock messages.",
        "`titleSm` card titles, section heads, a pane's title · `title` the test summary, dialog titles · `titleLg` screen titles · `display` first launch, splash.",
        "`reading` and `readingHeading` document text and source passages (the serif) · `code` keys, anchors, ids, paths, raw output.",
      ],
    },
    {
      head: "Rules",
      text: "Sentence case everywhere, no uppercase labels, no italics in the interface. Titles tighten slightly (`--letter-spacing-*`). Numbers that line up use `type.tabular`. A weight after a style (`type.strong`) is the only way to make a word stand out.",
    },
  ],
  states: () => (
    <States>
      {TYPE_STYLES.map((name) => (
        <Cell key={name} label={`type.${name} · ${SAMPLE[name][0]}`} wide column>
          <span {...stylex.props(type[name])}>{SAMPLE[name][1]}</span>
        </Cell>
      ))}
      <Cell label="a weight and tabular figures after a style" column>
        <span {...stylex.props(type.small, type.strong)}>12 tests · 3 to fix</span>
        <span {...stylex.props(type.small, type.tabular, styles.meta)}>12.3 s · 24k tokens in · 1.2k out</span>
      </Cell>
    </States>
  ),
};
