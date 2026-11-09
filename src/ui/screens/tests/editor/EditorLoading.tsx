import * as stylex from "@stylexjs/stylex";
import { Card } from "../../../components/ui/Card.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { border, breakpoint, color, size, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  editor: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.canvas,
  },
  bar: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.row2,
    paddingInline: space.s5,
    backgroundColor: color.surface,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  grow: { flex: 1 },
  col: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `calc(${size.reading} + ${size.dock})`,
    marginInline: "auto",
    paddingTop: space.s6,
    paddingInline: { default: space.s7, [breakpoint.narrow]: space.s4 },
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  lines: { display: "flex", flexDirection: "column", gap: space.s3 },
});

// ponytail: the editor while its test is read — the bar, the summary card and three step cards, at their places
export function EditorLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the test" {...stylex.props(styles.editor)}>
      <div {...stylex.props(styles.bar)}>
        <Skeleton width="10%" />
        <Skeleton width="14%" />
        <span {...stylex.props(styles.grow)} />
        <Skeleton width="8%" />
        <Skeleton width="8%" />
      </div>
      <div {...stylex.props(styles.col)}>
        <Card>
          <div {...stylex.props(styles.lines)}>
            <Skeleton kind="title" width="55%" />
            <Skeleton width="20%" />
          </div>
        </Card>
        <Skeleton width="8%" />
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <Skeleton lines={4} />
          </Card>
        ))}
        <Loading read="tests.show" />
      </div>
    </div>
  );
}
