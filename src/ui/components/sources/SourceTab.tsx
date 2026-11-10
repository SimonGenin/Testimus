import { useEffect } from "react";
import type { Source } from "../../../core/types.ts";
import { useBar } from "../../lib/workspace/signals.ts";
import { useSideTab } from "../ui/workspace/useSideTab.tsx";
import { PassageDialog, type SourceFrom } from "./PassageDialog.tsx";

export const SOURCE_TAB = "source";

type Opened = { source: Source; from?: SourceFrom };

// ponytail: a source opened anywhere (a step's chip, the analysis, Generate, a run, Claude's activity) is read in the
// Source tab of the screen shown — beside the work, never over it; a screen with a Source tab of its own (Review) shows
// it there while it is open. A screen without sections (Setup) shows it in a dialog
export function SourceTab({
  opened,
  onClose,
  onOpenDoc,
}: {
  opened: Opened | null;
  onClose: () => void;
  onOpenDoc: (docId: string, anchor: string, quote: string, cited?: { test: string; step?: number }) => void;
}) {
  const bar = useBar();
  const passage = (frame: "modal" | "tab") =>
    opened && (
      <PassageDialog
        key={`${opened.source.docId}#${opened.source.anchor} ${opened.source.quote} ${opened.from?.step ?? ""}`}
        frame={frame}
        source={opened.source}
        from={opened.from}
        onClose={onClose}
        onOpenDoc={onOpenDoc}
      />
    );
  const side = useSideTab({ id: SOURCE_TAB, label: "Source", icon: "quote" }, !!opened && !!bar, passage("tab"), bar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: shown each time a source is opened, not at each change of the sections
  useEffect(() => {
    if (opened) side.reveal();
  }, [opened]);
  return bar ? side.node : passage("modal");
}
