import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { clock } from "../../lib/media.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  line: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: space.s3,
    alignItems: "start",
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.r2,
  },
  now: { backgroundColor: color.accentSubtle },
  body: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  text: { margin: 0, color: color.text, overflowWrap: "anywhere" },
  doubted: { color: color.textMuted },
  beside: { color: color.textMuted },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  grow: { flex: 1 },
  human: { color: color.success },
  proposal: { display: "flex", flexDirection: "column", gap: space.s2 },
  why: { margin: 0, color: color.textMuted },
});

export type SaidLine = CommandOutput<"media.transcript">["lines"][number];
export type Proposal = CommandOutput<"media.proposals">["proposals"][number];

const CLUE: Record<Proposal["clue"], string> = {
  glossary: "from the glossary",
  screen: "from the screen at that moment",
  document: "from a document",
};

export type TranscriptLineProps = {
  line: SaidLine;
  /** the line being said now */
  now: boolean;
  proposal?: Proposal;
  onSeek: (at: number) => void;
  /** play the line in a loop, to hear it before deciding */
  onListen: (line: SaidLine) => void;
  /** save what was really said; no text confirms the line as heard */
  onFix: (line: SaidLine, text?: string) => Promise<unknown>;
  onUnfix: (line: SaidLine) => Promise<unknown>;
  onDecide: (proposal: Proposal, accept: boolean) => Promise<unknown>;
};

// ponytail: one line of what is said — its moment (a click goes there), its words in the source's own face, a
// translation beside a line said in another language. A line the engine doubted says so and is confirmed or corrected
// after listening; a line a person wrote is theirs (no transcription replaces it) and can be given back. Claude's
// proposal for the line shows its clue and waits: it is never applied by itself
export function TranscriptLine({
  line,
  now,
  proposal,
  onSeek,
  onListen,
  onFix,
  onUnfix,
  onDecide,
}: TranscriptLineProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work().finally(() => setBusy(false));
  };
  const save = () => {
    const text = (draft ?? "").trim();
    if (!text) return;
    act(() => onFix(line, text).then(() => setDraft(null)));
  };
  const unsure = !!line.unsure && line.by !== "human";
  return (
    <li aria-current={now ? "true" : undefined} {...stylex.props(styles.line, now && styles.now)}>
      <Button size="xs" variant="quiet" label={clock(line.at)} onClick={() => onSeek(line.at)} />
      <div {...stylex.props(styles.body)}>
        {draft === null ? (
          <p lang={line.lang} {...stylex.props(type.reading, styles.text, unsure && styles.doubted)}>
            {line.text}
          </p>
        ) : (
          <>
            <Text
              ariaLabel={`What is said at ${clock(line.at)}`}
              multiline
              autoFocus
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") setDraft(null);
              }}
            />
            <div {...stylex.props(styles.row)}>
              <Button size="xs" label="Listen" icon="play" onClick={() => onListen(line)} />
              <span {...stylex.props(styles.grow)} />
              <Button size="xs" variant="quiet" label="Cancel" onClick={() => setDraft(null)} />
              <Button size="xs" variant="primary" label="Save" shortcut="Enter" loading={busy} onClick={save} />
            </div>
          </>
        )}
        {line.translation && (
          <span {...stylex.props(type.small, styles.beside)}>
            {(line.lang ?? "").toUpperCase()} · {line.translation}
          </span>
        )}
        {draft === null && (unsure || line.by === "human") && (
          <div {...stylex.props(styles.row)}>
            {unsure && (
              <Badge
                tone="warning"
                icon="alert-circle"
                label="Unsure"
                size="sm"
                tooltip="The engine doubted its words: listen before trusting this line"
              />
            )}
            {line.by === "human" && <span {...stylex.props(type.small, styles.human)}>Checked by a person</span>}
            <Button size="xs" variant="quiet" icon="play" label="Listen" onClick={() => onListen(line)} />
            {unsure && <Button size="xs" label="Confirm" disabled={busy} onClick={() => act(() => onFix(line))} />}
            <Button size="xs" label="Correct" onClick={() => setDraft(line.text)} />
            {line.by === "human" && (
              <Button
                size="xs"
                variant="quiet"
                label="Give back"
                disabled={busy}
                onClick={() => act(() => onUnfix(line))}
              />
            )}
          </div>
        )}
        {draft === null && !unsure && line.by !== "human" && now && (
          <div {...stylex.props(styles.row)}>
            <Button size="xs" variant="quiet" label="Correct" onClick={() => setDraft(line.text)} />
          </div>
        )}
        {proposal && draft === null && (
          <Card edge="claude" density="compact" title={`Claude proposes · ${CLUE[proposal.clue]}`}>
            <div {...stylex.props(styles.proposal)}>
              <p {...stylex.props(type.reading, styles.text)}>{proposal.text}</p>
              {proposal.why && <p {...stylex.props(type.small, styles.why)}>{proposal.why}</p>}
              <div {...stylex.props(styles.row)}>
                <Button size="xs" icon="play" label="Listen" onClick={() => onListen(line)} />
                <span {...stylex.props(styles.grow)} />
                <Button size="xs" label="Refuse" disabled={busy} onClick={() => act(() => onDecide(proposal, false))} />
                <Button
                  size="xs"
                  variant="claude"
                  label="Accept"
                  disabled={busy}
                  onClick={() => act(() => onDecide(proposal, true))}
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    </li>
  );
}
