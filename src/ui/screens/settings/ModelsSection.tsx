import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { AddFolder } from "./models/AddFolder.tsx";
import { AdviceBanner } from "./models/AdviceBanner.tsx";
import { useModelActions } from "./models/actions.ts";
import { BenchDialog } from "./models/BenchDialog.tsx";
import { CustomCard } from "./models/CustomCard.tsx";
import { size } from "./models/data.ts";
import { FitConfirm } from "./models/FitConfirm.tsx";
import { FolderDialog } from "./models/FolderDialog.tsx";
import { ModelsTable } from "./models/ModelsTable.tsx";
import { OpLine } from "./models/OpLine.tsx";
import { MEASURE, type Op, packLabel, useOps } from "./models/ops.tsx";
import { PackCard } from "./models/PackCard.tsx";
import { PackPlanDialog } from "./models/PackPlanDialog.tsx";
import { Hint, Section, Stack } from "./Section.tsx";

const styles = stylex.create({
  folder: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  path: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
  },
  muted: { color: color.textMuted, fontSize: fontSize.small, lineHeight: lineHeight.small },
  packs: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${space.s11} * 4), 1fr))`,
    gap: space.s5,
  },
});

const GLOBAL = ["index", "dir"];

// ponytail: the search models of this PC — where they are stored, the advice, the packs of the open project (one in
// use), and the catalog of models with what is installed here; every job is followed where its subject shows
export function ModelsSection() {
  const app = useApp();
  const hasProject = !!app.info;
  const catalog = useRead("models.catalog", {});
  const installed = useRead("models.list", {});
  const packs = useRead("models.packs", {}, { enabled: hasProject });
  const advice = useRead("models.advice", {}, { enabled: hasProject });
  const status = useRead("rag.status", {}, { enabled: hasProject });
  const dirs = useRead("models.dirs", {});
  const [open, setOpen] = useState(false);
  const [benchOf, setBenchOf] = useState<string | null>(null);
  const shownBench = useRef<string | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const dir = dirs.data ? dirs.data.dir : undefined;

  const measured = (op: Op, status: "done" | "failed" | "cancelled", error?: string) => {
    const pack = op.key.slice(MEASURE.length);
    a.benchEnded(pack, op.jobId, status, error);
    if (shownBench.current === pack) return;
    const title = `${packLabel(pack)} pack`;
    if (status === "done") toast({ kind: "ok", title: `${title} measured` });
    else if (status === "failed")
      errorToast(new Error(error ?? "The measure stopped."), `${title}: the measure stopped`);
  };
  const { ops, start, watchers } = useOps((op, job) => {
    if (op.kind === "models-measure" && job.status !== "running") measured(op, job.status, job.error);
  });
  const a = useModelActions({ packs: packs.data, catalog: catalog.data, status: status.data, dir, start });

  const label = (id: string) => catalog.data?.find((c) => c.id === id)?.label ?? id;
  const st = status.data;
  const inUse = st && st.embedding !== "none" ? [st.embedding, st.reranker ?? ""].filter(Boolean) : [];
  const customActive = !!packs.data && !packs.data.some((p) => p.active) && st?.activation === "machine";
  const busy = ops.some((o) => !GLOBAL.includes(o.key) || o.key === "dir") || a.planning;
  const packBusy = ops.some((o) => o.key === "dir") || a.planning;
  const failed = catalog.error ?? packs.error;
  const top = advice.data?.[0];
  const benchPack = packs.data?.find((p) => p.id === benchOf) ?? null;
  const showBench = (id: string | null) => {
    shownBench.current = id;
    setBenchOf(id);
  };
  const measuring = (id: string) => ops.find((o) => o.key === `${MEASURE}${id}`) ?? null;
  const retry = () => {
    void catalog.refetch();
    if (hasProject) void packs.refetch();
  };

  return (
    <Section
      id="models"
      title="Models"
      wide
      intro="Search models run on this PC; documents never leave it. A pack picks the best models this PC can run; your colleagues choose their own."
    >
      {watchers}
      <Card
        title="Models folder"
        actions={
          <Button
            size="sm"
            label={dir ? "Change…" : "Choose…"}
            disabled={busy}
            onClick={() => a.setFolder({ needMB: 0 })}
          />
        }
      >
        <Stack>
          <span {...stylex.props(styles.folder)}>
            <Icon name="folder" />
            {dir === undefined ? (
              <Skeleton width="40%" />
            ) : dir ? (
              <span title={dir} {...stylex.props(styles.path)}>
                {dir}
              </span>
            ) : (
              <span {...stylex.props(styles.muted)}>not chosen yet</span>
            )}
          </span>
          {ops
            .filter((o) => GLOBAL.includes(o.key))
            .map((o) => (
              <OpLine key={o.jobId} op={o} />
            ))}
        </Stack>
      </Card>
      {failed ? (
        <Banner
          tone="danger"
          title="The models could not be read"
          actions={<Button size="sm" label="Try again" onClick={retry} />}
        >
          <span role="alert">{failed.message}</span>
        </Banner>
      ) : (
        <>
          {top && (
            <AdviceBanner
              advice={top}
              label={label}
              busy={packBusy}
              onApply={() => void a.applyAdvice(top)}
              onDismiss={() => a.dismiss(top)}
            />
          )}
          {!hasProject ? (
            <Hint>Open a project to choose its search pack. The models below are shared by every project.</Hint>
          ) : !packs.data ? (
            <div role="status" aria-busy="true" aria-label="Loading the packs" {...stylex.props(styles.packs)}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} kind="block" />
              ))}
            </div>
          ) : (
            <div {...stylex.props(styles.packs)}>
              {packs.data.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  label={label}
                  op={ops.find((o) => o.key === p.id) ?? null}
                  measure={measuring(p.id)}
                  busy={packBusy}
                  onUse={() => a.choosePack(p)}
                  onMeasure={() => {
                    showBench(p.id);
                    if (!measuring(p.id)) void a.measure(p);
                  }}
                />
              ))}
              <CustomCard
                active={customActive}
                embedding={st && st.embedding !== "none" ? st.embedding : null}
                reranker={st?.reranker ?? null}
                label={label}
                onChoose={() => {
                  setOpen(true);
                  requestAnimationFrame(() => table.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
                }}
              />
            </div>
          )}
          <div ref={table}>
            <Disclosure
              summary="Model catalog"
              open={open}
              onOpenChange={setOpen}
              meta={
                catalog.data
                  ? `${catalog.data.length} in the catalog · ${installed.data?.length ?? 0} on this PC`
                  : "Loading the catalog"
              }
            >
              <Stack>
                {!catalog.data ? (
                  <Skeleton kind="block" />
                ) : (
                  <ModelsTable
                    rows={catalog.data}
                    installed={installed.data ?? []}
                    inUse={inUse}
                    ops={ops}
                    busy={busy}
                    onInstall={(r) => void a.install(r)}
                    onUse={(r) => void a.chooseModel(r)}
                    onVerify={(r) => void a.verify(r)}
                    onRemove={(row, inst) => a.setRemoving({ row, inst })}
                  />
                )}
                <AddFolder />
              </Stack>
            </Disclosure>
          </div>
        </>
      )}
      {a.fitAsk && (
        <FitConfirm
          title={a.fitAsk.title}
          fit={a.fitAsk.fit}
          lighter={a.fitAsk.lighter}
          onClose={() => a.setFitAsk(null)}
          onUse={() => {
            a.setFitAsk(null);
            a.fitAsk?.go();
          }}
          onLighter={() => {
            a.setFitAsk(null);
            a.fitAsk?.lighterGo();
          }}
        />
      )}
      {a.plan && (
        <PackPlanDialog
          pack={a.plan.row}
          out={a.plan.out}
          label={label}
          busy={a.planning}
          onClose={() => a.setPlan(null)}
          onConfirm={() => void a.confirmPack()}
          onChangeFolder={() => {
            const row = a.plan?.row;
            a.setPlan(null);
            if (row) a.setFolder({ needMB: 0, next: () => void a.planPack(row) });
          }}
        />
      )}
      {benchPack && (
        <BenchDialog
          pack={benchPack}
          bench={a.benches[benchPack.id]}
          label={label}
          onAgain={() => void a.measure(benchPack)}
          onClose={() => showBench(null)}
        />
      )}
      {a.folder && (
        <FolderDialog
          current={dir ?? null}
          needMB={a.folder.needMB}
          onApplied={(d, jobId, action) => {
            const next = a.folder?.next;
            a.setFolder(null);
            if (jobId)
              start(jobId, "dir", "models-dir", action === "move" ? "Moving the models" : "Copying the models");
            else toast({ kind: "ok", title: "Models folder saved", detail: d });
            next?.();
          }}
          onClose={() => a.setFolder(null)}
        />
      )}
      {a.removing && (
        <Modal
          size="sm"
          title={`Remove ${a.removing.row.label}?`}
          confirm={{
            verb: a.removing.inst.via === "path" ? "Forget it" : "Delete it",
            danger: a.removing.inst.via !== "path",
            onConfirm: () => a.remove(),
          }}
          onClose={() => a.setRemoving(null)}
        >
          <Stack>
            <p>
              {a.removing.inst.via === "download"
                ? `Its files (${size(a.removing.inst.sizeMB)}) are deleted from ${a.removing.inst.where}.`
                : `Testimus forgets it; the folder ${a.removing.inst.where} stays on disk.`}
            </p>
            <Hint>Vector spaces built with it stay in the index until you drop them (Settings › Search).</Hint>
          </Stack>
        </Modal>
      )}
    </Section>
  );
}
