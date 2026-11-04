import * as stylex from "@stylexjs/stylex";
import type { Focus } from "../../lib/app.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "../ui/Icon.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { type } from "../ui/type.ts";

export type Tab = "docs" | "test" | "actions";
export type Sub = "doc" | "all" | "step" | "test" | "project";

const styles = stylex.create({
  scope: { display: "flex", flexDirection: "column", gap: space.s3, paddingInline: space.s5, paddingTop: space.s4 },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3, minWidth: 0 },
  line: { display: "flex", alignItems: "center", gap: space.s2, color: color.textSubtle },
  key: { color: color.textMuted },
});

// ponytail: what the dock talks about — the documents, this test (a step, the test, the whole project) or the actions
// Claude proposed; the choice is the dock's, every run says it again
export function DockScope({
  tab,
  sub,
  docId,
  focus,
  actions,
  running,
  onTab,
  onSub,
}: {
  tab: Tab;
  sub: Sub;
  docId: string | null;
  focus: Focus | null;
  actions: number;
  running: boolean;
  onTab: (t: Tab) => void;
  onSub: (s: Sub) => void;
}) {
  const busy = running ? "Claude is working — wait for it to finish" : false;
  return (
    <div {...stylex.props(styles.scope)}>
      <Tabs<Tab>
        label="Claude scope"
        size="sm"
        fill
        value={tab}
        onChange={onTab}
        tabs={[
          { value: "docs", label: "Documents", icon: "documents", disabled: tab !== "docs" && busy },
          {
            value: "test",
            label: focus ? "This test" : "On the project",
            icon: focus ? "tests" : "folder",
            disabled: tab !== "test" && busy,
          },
          {
            value: "actions",
            label: "Actions",
            icon: "list",
            count: actions || undefined,
            disabled: tab !== "actions" && busy,
          },
        ]}
      />
      {tab === "docs" && (
        <div {...stylex.props(styles.row)}>
          <Segmented<Sub>
            label="Which documents"
            size="sm"
            value={sub}
            onChange={(s) => !running && onSub(s)}
            options={[
              { value: "doc", label: "This document", disabled: running || !docId },
              { value: "all", label: "All documents", disabled: running },
            ]}
          />
          {docId && sub === "doc" && <span {...stylex.props(type.small, type.mono, styles.key)}>{docId}</span>}
        </div>
      )}
      {tab === "test" &&
        (focus ? (
          <div {...stylex.props(styles.row)}>
            <Segmented<Sub>
              label="What this run is about"
              size="sm"
              value={sub}
              onChange={(s) => !running && onSub(s)}
              options={[
                {
                  value: "step",
                  label: focus.step != null ? `Step ${focus.step}` : "Step",
                  disabled: running || focus.step == null,
                },
                { value: "test", label: "Whole test", disabled: running },
                { value: "project", label: "Whole project", disabled: running },
              ]}
            />
            <span {...stylex.props(type.small, type.mono, styles.key)}>{focus.key ?? "local test"}</span>
          </div>
        ) : (
          <span {...stylex.props(type.small, styles.line)}>
            <Icon name="target" size="sm" />
            Whole project · its tests, documents and contexts
          </span>
        ))}
      {tab === "actions" && (
        <span {...stylex.props(type.small, styles.line)}>
          <Icon name="info" size="sm" />
          Fixes a run proposed for later · every change can be reverted
        </span>
      )}
    </div>
  );
}
