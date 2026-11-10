import * as stylex from "@stylexjs/stylex";
import type { JobEvent } from "../../../core/types.ts";
import type { Screen } from "../../lib/app.ts";
import { type TestNames, testNamed, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  sect: { display: "flex", flexDirection: "column", gap: space.s3 },
  h3: { margin: 0 },
  files: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  file: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  fileIcon: { flex: "none", display: "inline-flex", color: color.textSubtle },
  how: { flex: "none", color: color.textSubtle },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.text },
  file2: { color: color.textMuted },
});

type Place = { name: string; rest: string; screen: Screen; id: string };

// ponytail: a changed file of a test or a document is said by the test's summary or the document's id (its code),
// then the file inside it — tests/local-4df6ff7b/test.md reads « Ouverture du sectionneur › test.md »
export function placeOfPath(path: string, names: TestNames): Place | null {
  const m = /^(tests|docs)\/([^/]+)\/(.*)$/.exec(path.replace(/\\/g, "/"));
  if (!m) return null;
  return m[1] === "tests"
    ? { name: testNamed(names, m[2]), rest: m[3], screen: "tests", id: m[2] }
    : { name: m[2], rest: m[3], screen: "documents", id: m[2] };
}

export function JobFiles({ events, onGo }: { events: JobEvent[]; onGo: (screen: Screen, id: string) => void }) {
  const names = useTestNames();
  const changed = [...new Set(events.flatMap((e) => (e.type === "changed" ? e.paths : [])))];
  const how = new Map<string, "added" | "deleted">();
  for (const e of events)
    if (e.type === "changed") {
      for (const p of e.added ?? []) how.set(p, "added");
      for (const p of e.removed ?? []) how.set(p, "deleted");
    }
  if (!changed.length) return null;
  const title = `Files changed · ${changed.length}`;
  return (
    <section aria-label={title} {...stylex.props(styles.sect)}>
      <h3 {...stylex.props(type.caption, styles.h3)}>{title}</h3>
      <ul {...stylex.props(styles.files)}>
        {changed.map((p) => {
          const at = placeOfPath(p, names);
          return (
            <li key={p} {...stylex.props(styles.file)}>
              <span {...stylex.props(styles.fileIcon)}>
                <Icon name={how.get(p) === "added" ? "plus" : how.get(p) === "deleted" ? "trash" : "file"} size="sm" />
              </span>
              <span {...stylex.props(type.compact, styles.path)}>
                {at ? (
                  <>
                    {at.name} <span {...stylex.props(type.code, styles.file2)}>› {at.rest}</span>
                  </>
                ) : (
                  <span {...stylex.props(type.code)}>{p}</span>
                )}
              </span>
              <span {...stylex.props(type.small, styles.how)}>{how.get(p) ?? "modified"}</span>
              {how.get(p) !== "deleted" && at && (
                <Button
                  size="xs"
                  variant="quiet"
                  iconOnly
                  icon="arrow-right"
                  label={`Open « ${at.name} » in ${at.screen === "tests" ? "Tests" : "Documents"}`}
                  onClick={() => onGo(at.screen, at.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
