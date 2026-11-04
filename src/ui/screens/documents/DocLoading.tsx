import * as stylex from "@stylexjs/stylex";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { COLS, type Fold } from "./layout.ts";

const styles = stylex.create({
  doc: { boxSizing: "border-box", flex: 1, minWidth: 0, minHeight: 0, display: "flex" },
  reader: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    paddingBlock: space.s2,
    paddingInline: space.s6,
    minHeight: `calc(${space.s11} - ${space.s2})`,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    backgroundColor: color.surface,
  },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s3 },
  body: { flex: 1, minHeight: 0, display: "flex", minWidth: 0 },
  toc: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    padding: space.s5,
    backgroundColor: color.surface,
    borderRightStyle: "solid",
    borderRightWidth: border.width,
    borderRightColor: color.border,
  },
  text: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s7,
    paddingTop: space.s7,
    paddingRight: space.s8,
    paddingBottom: space.s11,
    paddingLeft: `calc(${space.s3} + ${space.s11} + ${space.s8} + ${space.s5})`,
    maxWidth: `calc(${size.reading} + ${space.s11} + ${space.s8} + ${space.s5})`,
    marginInline: "auto",
    backgroundColor: color.surface,
  },
  side: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.surface,
    borderLeftStyle: "solid",
    borderLeftWidth: border.width,
    borderLeftColor: color.border,
  },
  sec: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  width: (w: number) => ({ width: w }),
  grow: { flex: 1, minWidth: 0, display: "flex", backgroundColor: color.surface },
});

// ponytail: a document while it loads — its head, its contents, its text and its settings at their places, so nothing
// moves when it lands
export function DocLoading({
  fold = "wide",
  label,
  widths = COLS,
}: {
  fold?: Fold;
  label: string;
  widths?: { toc: number; side: number };
}) {
  const toc = fold !== "tiny";
  const side = fold === "wide" || fold === "medium";
  return (
    <section aria-label={label} aria-busy="true" {...stylex.props(styles.doc)}>
      <div {...stylex.props(styles.reader)}>
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.titles)}>
            <Skeleton kind="title" width="24%" />
            <Skeleton width="36%" />
          </div>
        </div>
        <div {...stylex.props(styles.body)}>
          {toc && (
            <div {...stylex.props(styles.toc, styles.width(widths.toc))}>
              <Skeleton width="70%" />
              <Skeleton width="55%" />
              <Skeleton width="62%" />
              <Skeleton width="45%" />
            </div>
          )}
          <div {...stylex.props(styles.grow)}>
            <div {...stylex.props(styles.text)}>
              <Skeleton lines={4} />
              <Skeleton lines={5} />
              <Skeleton kind="block" width="55%" />
            </div>
          </div>
        </div>
      </div>
      {side && (
        <div {...stylex.props(styles.side, styles.width(widths.side))}>
          {[0, 1, 2].map((i) => (
            <div key={i} {...stylex.props(styles.sec)}>
              <Skeleton width="40%" />
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
