import { type PaneHandle, usePaneWidth } from "../../lib/panes.ts";

/** the least room the text of a document keeps beside its contents */
export const TEXT = 496;
export const TOC = { min: 180, max: 420, initial: 256 };

export type Pane = PaneHandle;

// ponytail: the contents stay beside the text while both fit in the document's section; narrower, they fold into a
// « Sections » drawer from the document's head
export const tocFits = (width: number, toc: number = TOC.initial): boolean => width >= toc + TEXT;

// ponytail: the contents grow only into the room the text can spare, so a drag never folds what it resizes
export function useTocPane(width: number): Pane {
  const pane = usePaneWidth("docsTocWidth", TOC).handle;
  return { ...pane, max: Math.min(pane.max, Math.max(pane.value, width - TEXT)) };
}
