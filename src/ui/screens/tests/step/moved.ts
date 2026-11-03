// ponytail: one payload for both drags a field accepts — a block of this step being moved (named by the
// slice of text it is, because the same ref may appear more than once), and an attachment no field embeds
export const MOVE = "application/x-testimus-block";

export type Moved = { step: number; file?: string; field?: string; at?: number; end?: number };
