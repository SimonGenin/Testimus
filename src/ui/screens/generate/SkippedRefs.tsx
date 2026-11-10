import * as stylex from "@stylexjs/stylex";
import { useContext } from "react";
import type { Source } from "../../../core/types.ts";
import { videoPreview } from "../../components/sources/VideoPreview.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { AppContext } from "../../lib/app.ts";
import { parseSourceRef, sourceLabel } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  chips: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
});

// ponytail: passages named beside a behavior left without a test — the ones that ask for it, the ones the run opened,
// the one a second look found — as source chips that open the passage; a line that is not docId#anchor is left out
export function SkippedRefs({ lines, compact = false }: { lines: string[]; compact?: boolean }) {
  const openSource = useContext(AppContext)?.openSource;
  const observed = useObserved();
  const sources = lines.map(parseSourceRef).filter((x): x is Source => !!x);
  if (!sources.length) return null;
  return (
    <span {...stylex.props(styles.chips)}>
      {sources.map((x) => (
        <SourceChip
          key={`${x.docId}#${x.anchor} ${x.quote}`}
          compact={compact}
          reference={sourceLabel(x)}
          quote={x.quote || undefined}
          figure={isPictureAnchor(x.anchor)}
          observed={observed(x.docId)}
          preview={videoPreview(x)}
          onOpen={openSource && (() => openSource(x))}
        />
      ))}
    </span>
  );
}
