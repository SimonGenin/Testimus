import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../../lib/app.ts";
import { execute, invalidate, read, useRead } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import type { CatalogRow, Hardware, PackRow, UsePackOut } from "../settings/models/data.ts";
import { suggestPack } from "../settings/models/data.ts";

// ponytail: the Search pack step — the packs of the project on this PC, the machine read only when asked (no pack is
// said to fit before), then « Use » plans the pack, asks for a models folder when a download has nowhere to go, and
// starts it (a job: the page moves on to the documents)
export function usePackStep(hasProject: boolean) {
  const app = useApp();
  const client = useQueryClient();
  const packsRead = useRead("models.packs", {}, { enabled: hasProject });
  const catalog = (useRead("models.catalog", {}, { enabled: hasProject }).data ?? []) as CatalogRow[];
  const packs = packsRead.isPending ? null : ((packsRead.data ?? []) as PackRow[]);
  const [chosen, setChosen] = useState("");
  const [machine, setMachine] = useState<Hardware | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folderNeed, setFolderNeed] = useState<number | null>(null);

  const analyse = async () => {
    setAnalysing(true);
    try {
      await invalidate(client, [["models.hardware", { refresh: true }]]);
      const hw = (await read(client, "models.hardware", { refresh: true })) as Hardware;
      await invalidate(client, [["models.packs"]]);
      const p = ((await read(client, "models.packs", {})) ?? []) as PackRow[];
      const s = p.find((x) => x.suggested)?.id ?? suggestPack(p, hw, catalog);
      setMachine(hw);
      setSuggested(s);
      setChosen((c) => c || s);
    } catch (e) {
      errorToast(e, "Could not analyse this machine");
    } finally {
      setAnalysing(false);
    }
  };

  const pack = packs?.find((p) => p.id === chosen);
  const done = () => app.navigate("documents");

  const use = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      await invalidate(client, [["models.planPack", { pack: pack.id }]]);
      const plan = (await read(client, "models.planPack", { pack: pack.id })) as UsePackOut;
      if (plan.plan.download.length && !plan.plan.dir) {
        setFolderNeed(plan.plan.download.reduce((a, d) => a + d.sizeMB, 0));
        return;
      }
      await execute(client, "models.usePack", { pack: pack.id }, { invalidates: [["models.packs"], ["rag.status"]] });
      toast({
        kind: "ok",
        title: `${pack.label} pack chosen`,
        detail: plan.plan.download.length ? "Downloading in the background: see Jobs" : "Indexing follows",
      });
      done();
    } catch (e) {
      errorToast(e, `Could not use the ${pack.label} pack`);
    } finally {
      setBusy(false);
    }
  };

  return {
    packs,
    error: packsRead.error?.message ?? "",
    catalog,
    label: (id: string) => catalog.find((c) => c.id === id)?.label ?? id,
    chosen,
    setChosen,
    pack,
    machine,
    suggested,
    analysing,
    analyse,
    busy,
    use,
    done,
    folderNeed,
    closeFolder: () => setFolderNeed(null),
    folderChosen: () => {
      setFolderNeed(null);
      void use();
    },
  };
}
