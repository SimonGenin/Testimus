import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../lib/app.ts";
import { invalidate, read, useRead } from "../../lib/data/query.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { useModelActions } from "../settings/models/actions.ts";
import type { CatalogRow, Hardware, PackRow } from "../settings/models/data.ts";

// ponytail: the Search pack step — the packs of the project on this PC, the machine read on arrival (no pack is said to
// fit before); the pack this PC already chose for the project stays picked, else the core's suggestion, then « Use » goes the way Settings › Models goes: does it fit
// (FitConfirm), a models folder when a download has nowhere to go, the plan (PackPlanDialog), and the job — downloaded
// and used at once; the page says it started and moves on
export function usePackStep(hasProject: boolean, onDone?: () => void) {
  const app = useApp();
  const client = useQueryClient();
  const packsRead = useRead("models.packs", {}, { enabled: hasProject });
  const catalogRead = useRead("models.catalog", {}, { enabled: hasProject });
  const catalog = (catalogRead.data ?? []) as CatalogRow[];
  const packs = packsRead.isPending ? null : ((packsRead.data ?? []) as PackRow[]);
  const [chosen, setChosen] = useState("");
  const [machine, setMachine] = useState<Hardware | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const analyse = async () => {
    setAnalysing(true);
    try {
      await invalidate(client, [["models.hardware", { refresh: true }]]);
      const hw = (await read(client, "models.hardware", { refresh: true })) as Hardware;
      await invalidate(client, [["models.packs"]]);
      const p = ((await read(client, "models.packs", {})) ?? []) as PackRow[];
      const s = p.find((x) => x.suggested)?.id ?? null;
      setMachine(hw);
      setSuggested(s);
      if (!p.some((x) => x.chosen)) setChosen((c) => c || (s ?? ""));
    } catch (e) {
      errorToast(e, "Could not analyse this machine");
    } finally {
      setAnalysing(false);
    }
  };

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !packs || !catalogRead.data) return;
    asked.current = true;
    void analyse();
  });

  const active = packs?.find((p) => p.active);
  const picked = chosen || packs?.find((p) => p.chosen)?.id || "";
  const pack = packs?.find((p) => p.id === picked);
  const done = () => (onDone ? onDone() : app.navigate("documents"));
  const a = useModelActions({
    packs: packs ?? undefined,
    catalog,
    status: undefined,
    dir: undefined,
    start: () => {},
    thenUse: true,
    onPackStarted: (row, jobId, out) => {
      jobToast(
        `${row.label} pack — started`,
        jobId,
        app.navigate,
        out.plan.download.length
          ? "It downloads the models, then indexes the documents, in Jobs; you can keep working."
          : "It indexes the documents in Jobs; you can keep working.",
      );
      done();
    },
  });

  return {
    packs,
    error: packsRead.error?.message ?? "",
    catalog,
    label: (id: string) => catalog.find((c) => c.id === id)?.label ?? id,
    chosen: picked,
    setChosen,
    pack,
    active,
    machine,
    suggested,
    analysing,
    analyse,
    actions: a,
    busy: a.planning,
    use: () => pack && a.choosePack(pack),
    done,
  };
}
