import type { Source } from "../../../core/types.ts";
import { Markdown } from "./Markdown.tsx";

export { parseAnswer, sourcesOf } from "../../lib/markdown.ts";

// ponytail: Claude's answer — its Markdown drawn as React elements (Markdown.tsx), each docId#anchor "quote" a source
// chip in the line, unless the answer lists it under the text (`listed`)
export function AnswerText({
  text,
  running,
  listed = [],
  reading = false,
  onOpenSource,
}: {
  text: string;
  running?: boolean;
  listed?: Source[];
  /** in the reading face (a page Claude wrote to be read, as How the documents fit together), not the interface's */
  reading?: boolean;
  onOpenSource: (s: Source) => void;
}) {
  return <Markdown text={text} running={running} listed={listed} reading={reading} onOpenSource={onOpenSource} />;
}
