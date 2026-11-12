import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { toast } from "../../lib/toast.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { type ModelRef, useModelActions } from "./models/actions.ts";
import type { CatalogRow, Installed } from "./models/data.ts";
import { useEngineActions } from "./models/engines.ts";
import { FitConfirm } from "./models/FitConfirm.tsx";
import { FolderDialog } from "./models/FolderDialog.tsx";
import { useOps } from "./models/ops.tsx";
import { PcGroup } from "./models/PcGroup.tsx";
import { RemoveDialog } from "./models/RemoveDialog.tsx";
import { SearchGroup } from "./models/SearchGroup.tsx";
import { TranscriptionGroup } from "./models/TranscriptionGroup.tsx";
import { Group, Section } from "./Section.tsx";

const styles = stylex.create({
  plain: { margin: 0 },
  soon: { display: "inline-flex", alignItems: "center", gap: space.s2 },
});

const PC = ["index", "dir"];

// ponytail: the models of this PC, one kind at a time (embeddings, reranker, transcription; an LLM soon): the one
// advised for this PC first, then every other one, the constraints said where they bite — no pack here, packs are the
// first launch's; every job is followed where its subject shows
export function ModelsSection() {
  const app = useApp();
  const hasProject = !!app.info;
  const status = useRead("rag.status", {}, { enabled: hasProject });
  const st = status.data;
  const embedding = st && st.embedding !== "none" ? st.embedding : null;
  const catalog = useRead("models.catalog", embedding ? { beside: embedding } : {}, {
    enabled: !hasProject || !!st || status.isError,
  });
  const installed = useRead("models.list", {});
  const dirs = useRead("models.dirs", {});
  const dir = dirs.data ? dirs.data.dir : undefined;
  const label = (id: string) => catalog.data?.find((c) => c.id === id)?.label ?? id;
  const { ops, start, watchers } = useOps(undefined, label);
  const a = useModelActions({ packs: undefined, catalog: catalog.data, status: st, dir, start });
  const needsFolder = !!dirs.data && !(dirs.data.runtimesDir ?? dirs.data.dir);
  const engines = useEngineActions({ needsFolder, setFolder: a.setFolder, start });
  const busy = ops.some((o) => o.key !== "index");
  const rows = (kind: string) => catalog.data?.filter((c) => c.kind === kind);
  const advisedEmbedding = catalog.data?.find((c) => c.kind === "embedding" && c.advised);
  const search = {
    installed: installed.data ?? [],
    advisedOnCpu: advisedEmbedding?.fit.device === "cpu",
    ops,
    busy,
    hasProject,
    onUse: (r: CatalogRow | null) => void a.chooseModel(r),
    onCheck: (r: ModelRef) => void a.verify(r),
    onRemove: (r: ModelRef, inst: Installed) => a.setRemoving({ row: r, inst }),
  };

  return (
    <Section
      id="models"
      title="Models"
      intro="The models Testimus runs on this PC. For each kind, the one that suits this PC best comes first; every other one is listed under it. Documents and sound never leave the PC."
    >
      {watchers}
      <PcGroup
        dir={dir}
        ops={ops.filter((o) => PC.includes(o.key))}
        busy={busy}
        onFolder={() => a.setFolder({ needMB: 0 })}
      />
      {catalog.error ? (
        <Banner
          tone="danger"
          title="The models could not be read"
          actions={<Button size="sm" icon="refresh" label="Try again" onClick={() => void catalog.refetch()} />}
        >
          <span>{catalog.error.message}</span>
        </Banner>
      ) : (
        <>
          <SearchGroup
            {...search}
            kind="embedding"
            rows={rows("embedding")}
            inUse={hasProject && st ? embedding : undefined}
            place={hasProject ? st?.embeddingPlace : null}
          />
          <SearchGroup
            {...search}
            kind="reranker"
            rows={rows("reranker")}
            inUse={hasProject && st ? (st.reranker ?? null) : undefined}
            llama={dirs.data?.llamacpp}
            onLlama={() => void engines.pullLlama(0)}
          />
        </>
      )}
      <TranscriptionGroup
        installed={installed.data ?? []}
        ops={ops}
        busy={busy}
        needsFolder={needsFolder}
        start={start}
        onFolder={a.setFolder}
        onInstall={a.install}
        onVerify={(m) => void a.verify(m)}
        onRemove={(row, inst) => a.setRemoving({ row, inst })}
      />
      <Group
        title={
          <span {...stylex.props(styles.soon)}>
            LLM <Badge label="Soon" size="sm" />
          </span>
        }
        note="A language model on this PC, for small jobs that need not go to Claude."
      >
        {null}
      </Group>
      {a.fitAsk && (
        <FitConfirm
          name={a.fitAsk.name}
          short={a.fitAsk.short}
          fit={a.fitAsk.fit}
          processorOnly={a.fitAsk.processorOnly}
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
      {a.folder && (
        <FolderDialog
          current={dir ?? null}
          needMB={a.folder.needMB}
          onApplied={(d, jobId, action) => {
            const next = a.folder?.next;
            a.setFolder(null);
            if (jobId)
              start(jobId, "dir", "models-dir", action === "move" ? "Moving the models" : "Copying the models");
            else toast({ tone: "success", title: "Models folder saved", detail: d });
            next?.();
          }}
          onClose={() => a.setFolder(null)}
        />
      )}
      {a.ask && (
        <Modal
          size="sm"
          title={a.ask.title}
          consequences={a.ask.consequences}
          consequencesAt="start"
          confirm={{ verb: a.ask.verb, icon: a.ask.icon, onConfirm: a.ask.go }}
          onClose={() => a.setAsk(null)}
        >
          <p {...stylex.props(styles.plain)}>{a.ask.text}</p>
        </Modal>
      )}
      {a.removing && (
        <RemoveDialog
          label={a.removing.row.label}
          inst={a.removing.inst}
          speech={a.removing.row.kind === "speech"}
          onConfirm={() => a.remove()}
          onClose={() => a.setRemoving(null)}
        />
      )}
    </Section>
  );
}
