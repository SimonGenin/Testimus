import * as stylex from "@stylexjs/stylex";
import { useReachable } from "../../lib/data/query.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";

const styles = stylex.create({
  wrap: { flex: "none", paddingBlock: space.s3, paddingInline: space.s5 },
});

// ponytail: the page lost the Testimus server — it says so on top, the screen stays readable, edits wait in their
// autosave until it answers again
export function ServerLost() {
  if (useReachable()) return null;
  return (
    <div {...stylex.props(styles.wrap)}>
      <Banner tone="danger" title="Testimus is not answering">
        The screen stays as it was; what you type is kept and saved when it answers again. If it does not come back,
        start Testimus again.
      </Banner>
    </div>
  );
}
