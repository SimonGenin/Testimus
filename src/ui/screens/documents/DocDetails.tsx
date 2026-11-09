import * as stylex from "@stylexjs/stylex";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useRead } from "../../lib/data/query.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { DocSide } from "./DocSide.tsx";
import { useDocSet } from "./useDocSet.ts";

const styles = stylex.create({
  wait: { display: "flex", flexDirection: "column", gap: space.s4, padding: space.s5 },
  none: { flex: 1, display: "flex", padding: space.s5 },
});

// ponytail: the Documents screen's Details tab — what the team decides about the open document (status, Claude
// context) beside what its conversion found; the same read as the document's own head, so it costs nothing more
export function DocDetails({ id }: { id: string | null }) {
  if (!id)
    return (
      <div {...stylex.props(styles.none)}>
        <EmptyState
          icon="info"
          title="No document open"
          compact
          text="Open a document to see its status, its search index, its Claude context and what its conversion found."
        />
      </div>
    );
  return <Details key={id} id={id} />;
}

function Details({ id }: { id: string }) {
  const meta = useRead("docs.show", { id, brief: true });
  const running = useUploads().some((u) => u.docId === id && u.job === "convert" && !settled(u));
  const settings = useDocSet(id);
  if (meta.isError)
    return (
      <div {...stylex.props(styles.none)}>
        <EmptyState
          icon="documents"
          title="This document cannot be read"
          compact
          text="Its details show once it opens."
        />
      </div>
    );
  if (!meta.data)
    return (
      <div aria-busy="true" {...stylex.props(styles.wait)}>
        <Skeleton width="40%" />
        <Skeleton lines={2} />
        <Skeleton width="55%" />
      </div>
    );
  return <DocSide shown={meta.data} running={running} onStatus={settings.status} />;
}
