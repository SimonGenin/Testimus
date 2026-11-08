import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { invalidate, key, read, useRead } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { Hint, Stack } from "../Section.tsx";
import { gpuFacts, type Hardware, machineSummary } from "./data.ts";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function facts(m: Hardware) {
  const [system, processor, memory] = machineSummary(m);
  return [
    { label: "System", value: system },
    { label: "Processor", value: processor },
    { label: "Memory", value: memory },
    ...gpuFacts(m),
    { label: "Analysed", value: when(m.at) },
  ];
}

// ponytail: what Testimus read of this PC — the facts every pack's verdict is held against — and « Analyse again »,
// which reads it afresh (a GPU or a driver changed, programs closed) and has the packs and the advice judged again
export function MachineCard() {
  const client = useQueryClient();
  const hw = useRead("models.hardware", {});
  const [analysing, setAnalysing] = useState(false);
  const analyse = async () => {
    setAnalysing(true);
    try {
      await invalidate(client, [["models.hardware", { refresh: true }]]);
      const fresh = (await read(client, "models.hardware", { refresh: true })) as Hardware;
      client.setQueryData(key("models.hardware", {}) as unknown as readonly unknown[], fresh);
      await invalidate(client, [["models.packs"], ["models.advice"]]);
      toast({ tone: "success", title: "This machine analysed again", detail: machineSummary(fresh)[3] });
    } catch (e) {
      errorToast(e, "Could not analyse this machine");
    } finally {
      setAnalysing(false);
    }
  };

  const m = hw.data;
  return (
    <Card
      title="This machine"
      actions={
        <Button
          size="sm"
          icon="refresh"
          label={analysing ? "Analysing…" : "Analyse again"}
          loading={analysing}
          disabled={!m && !hw.isError}
          onClick={() => void analyse()}
        />
      }
    >
      <Stack>
        {m ? (
          <Facts label="This machine" items={facts(m)} />
        ) : hw.isError ? (
          <Hint>This machine could not be read: {hw.error.message}</Hint>
        ) : (
          <>
            <Skeleton kind="block" />
            <Loading read="models.hardware" />
          </>
        )}
        <Hint>
          Every pack below is judged against these figures. Analyse again after changing a GPU or its driver, or closing
          programs that held its memory.
        </Hint>
      </Stack>
    </Card>
  );
}
