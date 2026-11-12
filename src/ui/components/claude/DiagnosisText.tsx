import { MarkdownLine } from "./Markdown.tsx";

// ponytail: a diagnosis is written with `commands` in backquotes (src/core/claude/diagnose.ts), sometimes **bold** —
// read as a line of Markdown inside its sentence, never shown as raw marks
export function DiagnosisText({ text }: { text: string }) {
  return <MarkdownLine text={text} />;
}
