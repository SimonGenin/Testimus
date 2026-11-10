import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Field } from "../../../components/ui/Field.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Switch } from "../../../components/ui/Switch.tsx";
import { type } from "../../../components/ui/type.ts";
import { invalidate, key, read, useRead } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { useSetting, useSettings } from "../machine.ts";
import { Fact, Group, Hint, Row } from "../Section.tsx";
import { AddFolder } from "./AddFolder.tsx";
import { gpuFacts, type Hardware, machineSummary, onDrive, size } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  folder: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: color.textMuted, whiteSpace: "nowrap" },
  line: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
});

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

// ponytail: what the advice of every kind is drawn from — this PC as Testimus read it (« Analyse again » reads it
// afresh and has every model judged again), where the models are kept, and whether they may come from Hugging Face
export function PcGroup({
  dir,
  ops,
  busy,
  onFolder,
}: {
  /** undefined while it is read; null: not chosen yet */
  dir: string | null | undefined;
  /** the long work of the folder (a move, a copy) and of the index */
  ops: Op[];
  busy: boolean;
  onFolder: () => void;
}) {
  const client = useQueryClient();
  const hw = useRead("models.hardware", {});
  const settings = useSettings();
  const setting = useSetting();
  const [analysing, setAnalysing] = useState(false);
  const [adding, setAdding] = useState(false);

  const analyse = async () => {
    setAnalysing(true);
    try {
      await invalidate(client, [["models.hardware", { refresh: true }]]);
      const fresh = (await read(client, "models.hardware", { refresh: true })) as Hardware;
      client.setQueryData(key("models.hardware", {}) as unknown as readonly unknown[], fresh);
      await invalidate(client, [["models.catalog"], ["models.speech"], ["models.packs"], ["models.advice"]]);
      toast({ tone: "success", title: "This PC analysed again", detail: machineSummary(fresh)[3] });
    } catch (e) {
      errorToast(e, "Could not analyse this PC");
    } finally {
      setAnalysing(false);
    }
  };

  const m = hw.data;
  const drive = dir
    ? (m?.drives ?? []).filter((d) => onDrive(dir, d.root)).sort((x, y) => y.root.length - x.root.length)[0]
    : undefined;
  return (
    <Group
      id="models-machine"
      title="This PC"
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
      <Row>
        <Fact
          label="Machine"
          hint="Every advice below is drawn from these figures. Analyse again after changing a GPU or its driver, or closing programs that held its memory."
        >
          {m ? (
            <Facts label="This PC" items={facts(m)} />
          ) : hw.isError ? (
            <Hint>This PC could not be read: {hw.error.message}</Hint>
          ) : (
            <>
              <Skeleton kind="block" />
              <Loading read="models.hardware" />
            </>
          )}
        </Fact>
      </Row>
      <Row>
        <Fact label="Models folder" hint="Every model of every kind is kept here, for every project.">
          <span {...stylex.props(styles.folder)}>
            <Icon name="folder" />
            {dir === undefined ? (
              <Skeleton width="40%" />
            ) : dir ? (
              <>
                <span title={dir} {...stylex.props(type.code, styles.path)}>
                  {dir}
                </span>
                {drive && (
                  <span {...stylex.props(type.small, styles.muted)}>
                    · {size(drive.freeMB)} free on {drive.root.replace(/[\\/]+$/, "") || drive.root}
                  </span>
                )}
              </>
            ) : (
              <span {...stylex.props(type.small, styles.muted)}>
                Not chosen yet — Testimus asks on the first download.
              </span>
            )}
          </span>
          <div {...stylex.props(styles.line)}>
            <Button
              size="sm"
              label={dir === null ? "Choose…" : "Change…"}
              disabled={busy || dir === undefined}
              onClick={onFolder}
            />
            <Button
              size="sm"
              label="Add a model from a folder…"
              expanded={adding}
              onClick={() => setAdding((a) => !a)}
            />
          </div>
          {ops.map((o) => (
            <OpLine key={o.jobId} op={o} />
          ))}
        </Fact>
      </Row>
      {adding && (
        <Row>
          <AddFolder />
        </Row>
      )}
      <Row>
        <Field
          aside
          label="Downloads"
          hint="Behind a proxy that blocks them, turn it off and add models from a folder."
        >
          <div>
            <Switch
              label="Allow downloads from Hugging Face"
              on={settings.data?.models.allowRemote ?? true}
              disabled={!settings.data}
              onChange={(allowRemote) => void setting({ allowRemote })}
            />
          </div>
        </Field>
      </Row>
    </Group>
  );
}
