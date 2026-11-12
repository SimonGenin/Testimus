import * as stylex from "@stylexjs/stylex";
import { useRead } from "../../lib/data/query.ts";
import { stageOf } from "../../lib/stage.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { DocStage } from "../sources/DocStage.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  line: { display: "flex", alignItems: "center", gap: space.s2, color: color.textMuted },
});

// ponytail: a job about one document (its conversion) says where that document is, as the documents list does
export function JobDocStage({ id }: { id: string }) {
  const d = useRead("docs.list", {}).data?.find?.((x) => x.id === id);
  if (!d) return null;
  return (
    <div {...stylex.props(type.small, styles.line)}>
      <span>{d.title || d.id}</span>
      <DocStage stage={stageOf(d)} />
    </div>
  );
}
