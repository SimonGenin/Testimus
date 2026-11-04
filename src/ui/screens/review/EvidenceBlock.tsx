import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";

export type Evidence = {
  testId: string;
  jobId: string | null;
  consulted: string[];
  read: { ref: string; title: string; cited: boolean }[];
  searched: { tool: string; query: string }[];
};

const styles = stylex.create({
  wrap: {
    boxSizing: "border-box",
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
    paddingTop: space.s3,
  },
  sum: { color: color.textMuted },
  group: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    color: color.textMuted,
  },
  note: { margin: 0, color: color.textMuted },
});

// ponytail: what the generation that wrote the test actually opened (its evidence ledger), each one a way into the panel
export function EvidenceBlock({
  testId,
  selected,
  onPick,
}: {
  testId: string;
  selected: string;
  onPick: (ref: string) => void;
}) {
  const r = useRead("review.evidence", { testId }, { enabled: !!testId });
  const ev = r.data as Evidence | undefined;
  const missing = r.isError;
  const summary = missing || ev?.jobId === null ? "Not recorded" : ev ? `${ev.read.length} read` : null;
  return (
    <div {...stylex.props(styles.wrap)}>
      <Disclosure
        summary="Sources read"
        meta={
          summary === null ? <Skeleton width="30%" /> : <span {...stylex.props(type.small, styles.sum)}>{summary}</span>
        }
      >
        {missing ? (
          <p {...stylex.props(type.small, styles.note)}>
            The generation's reading is not recorded for this test (written by hand, imported, or before Testimus kept
            it).
          </p>
        ) : !ev ? (
          <Skeleton kind="block" />
        ) : (
          <>
            <span {...stylex.props(type.caption, styles.group)}>Read by the generation ({ev.read.length})</span>
            {ev.jobId === null ? (
              <p {...stylex.props(type.small, styles.note)}>
                Not recorded: this test was not written by a generation Testimus followed.
              </p>
            ) : ev.read.length ? (
              <List
                label="Read by the generation"
                items={ev.read}
                getKey={(x) => x.ref}
                selected={selected}
                onSelect={onPick}
                renderItem={(x) => ({
                  lead: <Icon name={x.ref.includes("#fig:") ? "image" : "section"} size="sm" />,
                  title: x.title || <span {...stylex.props(type.code)}>{x.ref}</span>,
                  meta: x.title ? <span {...stylex.props(type.code)}>{x.ref}</span> : undefined,
                  trail: x.cited ? (
                    <Badge size="sm" tone="success" icon="check" label="Cited" tooltip="A step cites it" />
                  ) : (
                    <Badge size="sm" label="Read" />
                  ),
                })}
              />
            ) : (
              <p {...stylex.props(type.small, styles.note)}>Nothing opened.</p>
            )}
          </>
        )}
      </Disclosure>
    </div>
  );
}
