import { Markdown } from "../../components/claude/Markdown.tsx";
import { useApp } from "../../lib/app.ts";

// ponytail: how the documents fit together, in the reading face — Claude's Markdown as React elements (headings, lists,
// its words with their sources as chips); a heading's <!-- doc … --> mark is left out
export function OverviewText({ text }: { text: string }) {
  const app = useApp();
  return (
    <div data-testid="overview-text">
      <Markdown reading text={text} onOpenSource={app.openSource} />
    </div>
  );
}
