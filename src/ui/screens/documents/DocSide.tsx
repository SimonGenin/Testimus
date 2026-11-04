import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { DocJson } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { baseName } from "../../lib/desktop.ts";
import { plural } from "../../lib/format.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { indexWord } from "./badges.tsx";
import { DocContext } from "./DocContext.tsx";

const styles = stylex.create({
  side: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: 1, overflowY: "auto" },
  sec: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  row: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  caption: { flex: 1, margin: 0, color: color.textMuted },
  note: { margin: 0, color: color.textMuted },
  warns: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  warn: { display: "flex", gap: space.s2, alignItems: "flex-start", color: color.text },
  ok: { display: "flex", alignItems: "center", gap: space.s2 },
  warnIcon: { display: "inline-flex", color: color.warning, marginTop: space.s1 },
});

const STATUSES: DocJson["status"][] = ["draft", "submitted", "validated"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section {...stylex.props(styles.sec)}>
      <div {...stylex.props(styles.row)}>
        <h3 {...stylex.props(type.caption, styles.caption)}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ponytail: what the team decides about the document (status, the Claude context) beside what the conversion found
export function DocSide({
  shown,
  running,
  onStatus,
}: {
  shown: CommandOutput<"docs.show">;
  running: boolean;
  onStatus: (s: DocJson["status"]) => void;
}) {
  const d = shown.doc;
  const ref = useRead("docs.list", {}).data?.find?.((x) => x.id === d.id);
  const warnings = running ? [] : (d.converted?.warnings ?? []);
  const from = d.source.file?.endsWith(".pdf") ? "PDF" : "Word";
  const ix = indexWord(ref ?? { indexed: "missing", converted: d.converted });
  return (
    <aside aria-label="Document settings" {...stylex.props(styles.side)}>
      <Section title="Status">
        <Segmented
          label="Status"
          size="sm"
          value={d.status}
          options={STATUSES.map((s) => ({ value: s, label: cap(s), disabled: running }))}
          onChange={(s) => s !== d.status && onStatus(s)}
        />
        <p {...stylex.props(type.small, styles.note)}>What the team decided — not what the file says.</p>
      </Section>
      <Section title="Search">
        <div {...stylex.props(styles.row)}>
          <Badge {...ix} />
        </div>
      </Section>
      <Section title="Claude context">
        <DocContext id={d.id} shown={shown} disabled={running} />
      </Section>
      {d.converted?.at && (
        <Section
          title="Conversion"
          aside={
            warnings.length > 0 ? (
              <Badge size="sm" tone="warning" label={plural(warnings.length, "warning")} />
            ) : undefined
          }
        >
          <p {...stylex.props(type.small, styles.note)}>
            From {from} · {baseName(d.source.name || d.source.file)}
          </p>
          {warnings.length === 0 && !running && (
            <p {...stylex.props(type.small, styles.note, styles.ok)}>
              <Icon name="check" size="sm" />
              Nothing lost.
            </p>
          )}
          {warnings.length > 0 && (
            <ul aria-label="Conversion warnings" {...stylex.props(styles.warns)}>
              {warnings.map((w) => (
                <li key={w} {...stylex.props(type.small, styles.warn)}>
                  <span {...stylex.props(styles.warnIcon)}>
                    <Icon name="alert-triangle" size="sm" />
                  </span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </aside>
  );
}
