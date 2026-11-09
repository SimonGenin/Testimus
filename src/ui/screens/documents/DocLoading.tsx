import * as stylex from "@stylexjs/stylex";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import type { LoadingRead } from "../../lib/data/loading.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { TOC } from "./layout.ts";

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
  width: (w: number) => ({ width: w }),
  grow: { flex: 1, minWidth: 0, display: "flex", backgroundColor: color.surface },
});

// ponytail: a document while it loads — its head, its contents and its text at their places, so nothing moves when it
// lands (its details have their own tab)
export function DocLoading({
  label,
  read,
  toc = true,
  tocWidth = TOC.initial,
}: {
  label: string;
  read: LoadingRead;
  /** the contents beside the text (false: the section is too narrow for them) */
  toc?: boolean;
  tocWidth?: number;
}) {
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
            <div {...stylex.props(styles.toc, styles.width(tocWidth))}>
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
              <Loading read={read} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
