import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, color, container, size, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { type } from "../ui/type.ts";
import { ContextActions } from "./ContextActions.tsx";
import { ContextEdit } from "./ContextEdit.tsx";
import { GivenBar } from "./GivenBar.tsx";
import { GivenList } from "./GivenList.tsx";
import { GivenPiece } from "./GivenPiece.tsx";
import {
  type Asked,
  CONTEXT,
  changed,
  contextId,
  groupsOf,
  type Piece,
  type RunPick,
  toggle,
  totalOf,
} from "./pieces.ts";

const styles = stylex.create({
  body: {
    boxSizing: "border-box",
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    height: "64vh",
    minHeight: size.modalSm,
  },
  wait: { display: "flex", flexDirection: "column", gap: space.s4, paddingInline: space.s7, paddingBottom: space.s5 },
  total: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s5,
    rowGap: space.s2,
    paddingInline: space.s7,
    paddingBottom: space.s4,
  },
  start: { margin: 0, whiteSpace: "nowrap" },
  searched: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.textSubtle },
  split: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 9fr) minmax(0, 11fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    overflowY: { default: "hidden", [container.paneCompact]: "auto" },
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  list: {
    minHeight: 0,
    overflowY: { default: "auto", [container.paneCompact]: "visible" },
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: { default: border.width, [container.paneCompact]: 0 },
    borderInlineEndColor: color.border,
  },
  reader: {
    minHeight: 0,
    overflowY: { default: "auto", [container.paneCompact]: "visible" },
    paddingBlock: space.s6,
    paddingInline: space.s7,
    borderTopStyle: "solid",
    borderTopWidth: { default: 0, [container.paneCompact]: border.width },
    borderTopColor: color.border,
  },
});

export type Standing = {
  /** the list as it must be now: the owner writes it (a document's, a test's, the project's defaults) */
  onChange: (ids: string[]) => void | Promise<void>;
  /** who the ticked contexts go with, after « in » and « for »: « every run on this document » */
  says: string;
  /** the list cannot be changed for now: the reason (Claude is working on the test) */
  locked?: string;
};

const NOT_HERE = "For each run, where you write to Claude";

// ponytail: what a Claude run is given, before it is sent — claude.preview read with what the block asks and what was
// ticked, so what is listed is what the run sends: the pieces on the left (what can be changed first), the one picked
// read on the right as Claude gets it, the tokens it starts with on top. A tick holds for this run only (`pick`), or,
// for a standing list (a document's, a test's, the defaults), the saved contexts ticked are that list and the rest is
// only shown. The saved contexts are managed here and nowhere else: made, made from the block's text, copied, edited,
// shared, deleted
export function ContextDialog({
  asked,
  text,
  note,
  conversation,
  pick = {},
  onPick,
  standing,
  onSaved,
  onClose,
}: {
  asked: Asked;
  /** what is written in the block: « Save the text as a context… » saves it */
  text?: string;
  /** the user's own words in the list: what is written in the block, and the Claude panel's exchanges */
  note?: string;
  conversation?: string;
  /** what was ticked for this run only */
  pick?: RunPick;
  onPick?: (pick: RunPick) => void;
  /** a standing list instead of one run: ticking a saved context changes the list */
  standing?: Standing;
  /** the block's text became a saved context (ticked here): the owner empties the block */
  onSaved?: () => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const base = useRead("claude.preview", asked);
  const words = {
    ...(note?.trim() ? { note: note.trim().slice(0, 20000) } : {}),
    ...(conversation?.trim() ? { conversation: conversation.trim().slice(-60000) } : {}),
  };
  const shown = useRead("claude.preview", { ...asked, ...pick, ...words }, { keepPrevious: true });
  const pieces = shown.data?.pieces ?? [];
  const groups = groupsOf(pieces);
  const order = groups.flatMap((g) => g.pieces);
  const piece = order.find((p) => p.id === picked) ?? order[0];
  const canTick = (p: Piece) => !p.locked && (!standing || p.kind === "context");

  const tick = (id: string, on: boolean) => {
    if (!standing) return onPick?.(toggle(pick, base.data?.pieces ?? [], id, on));
    const mine = id.slice(CONTEXT.length);
    const others = pieces
      .filter((p) => p.kind === "context" && p.on)
      .map(contextId)
      .filter((x) => x !== mine);
    void Promise.resolve(standing.onChange(on ? [...others, mine] : others))
      .then(() => invalidate(client, [["claude.preview"]]))
      .catch((e) => errorToast(e, "Could not change the contexts"));
  };
  const made = (id: string) => {
    tick(`${CONTEXT}${id}`, true);
    setPicked(`${CONTEXT}${id}`);
  };

  const library = (
    <ContextActions
      text={text}
      disabled={!!standing?.locked}
      onCreated={(id, how) => {
        made(id);
        if (how === "new") setEditing(id);
      }}
      onSaved={
        onSaved
          ? (id) => {
              made(id);
              onSaved();
            }
          : undefined
      }
    />
  );
  const total = totalOf(pieces);

  return (
    <Modal
      title="Context"
      icon="context"
      size="lg"
      flush
      subtitle={
        standing
          ? `What Claude is given in ${standing.says}. The saved contexts ticked here go with all of them.`
          : "Everything Claude is given with this request. Untick what this run can go without."
      }
      onClose={onClose}
      footNote={
        standing
          ? `The ticked contexts are kept for ${standing.says}. The rest is chosen for each run.`
          : "Your choice holds for this run only. The defaults are set in Settings › Context."
      }
      actions={
        <>
          {!standing && changed(pick) && (
            <Button variant="quiet" icon="undo" label="Back to the defaults" onClick={() => onPick?.({})} />
          )}
          <Button variant="primary" label="Done" onClick={onClose} />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        {shown.data ? (
          <>
            <div {...stylex.props(type.compact, styles.total)}>
              <p role="status" {...stylex.props(styles.start)}>
                Claude starts with <span {...stylex.props(type.strong, type.tabular)}>{total.start}</span>
              </p>
              <GivenBar pieces={pieces} picked={piece?.id} />
              {total.searched && (
                <span {...stylex.props(styles.searched)}>
                  <Icon name="search" size="sm" />
                  and {total.searched}
                </span>
              )}
            </div>
            <div {...stylex.props(styles.split)}>
              {/* biome-ignore lint/a11y/useSemanticElements: the column of lists the dialog reads from, not a form's fieldset */}
              <div role="group" aria-label="What Claude is given" {...stylex.props(styles.list)}>
                <GivenList
                  groups={groups}
                  picked={piece?.id ?? null}
                  onPick={setPicked}
                  canTick={canTick}
                  onTick={tick}
                  disabled={standing?.locked ?? false}
                  library={library}
                  fixed={standing ? "Chosen for each run" : undefined}
                />
              </div>
              <div {...stylex.props(styles.reader)}>
                {piece && (
                  <GivenPiece
                    piece={piece}
                    fixed={standing && !piece.locked && !canTick(piece) ? NOT_HERE : undefined}
                    actions={
                      piece.kind === "context" ? (
                        <Button size="sm" label="Edit" onClick={() => setEditing(contextId(piece))} />
                      ) : undefined
                    }
                  />
                )}
              </div>
            </div>
          </>
        ) : shown.error ? (
          <div {...stylex.props(styles.wait)}>
            <Banner tone="danger" title="Could not work out what Claude is given">
              {message(shown.error)}
            </Banner>
          </div>
        ) : (
          <div {...stylex.props(styles.wait)}>
            <Skeleton lines={6} />
            <Loading read="claude.preview" />
          </div>
        )}
      </div>
      {editing && <ContextEdit id={editing} onClose={() => setEditing(null)} />}
    </Modal>
  );
}
