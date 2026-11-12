import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Group, Row } from "../Section.tsx";
import { AdvisedRow } from "./AdvisedRow.tsx";
import { aboutModel, type CatalogRow, type Dirs, type Installed, isInstalled, roomOf, runsOn, size } from "./data.ts";
import { Here, type ModelLine, ModelTable } from "./ModelTable.tsx";
import { OpLine } from "./OpLine.tsx";
import { LLAMA, type Op } from "./ops.tsx";
import { Rule } from "./Rule.tsx";

const styles = stylex.create({
  head: { display: "flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textMuted },
  foot: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3, color: color.textMuted },
});

const KIND = {
  embedding: {
    title: "Embeddings",
    id: "models-embeddings",
    note: "Turns each passage into a vector, so search finds it by meaning as well as by its words.",
    rule: "Changing it indexes the open project's documents again (a job; search keeps working on words meanwhile). Each project keeps its own choice on this PC, and the vectors of a model already used are kept, so going back to it is quick.",
    table: "Embedding models",
  },
  reranker: {
    title: "Reranker",
    id: "models-reranker",
    note: "Reads the best candidates again and puts the most relevant first. Better first results, slower queries. Optional.",
    rule: "The reranker shares the card with the embedding: one that does not fit beside the embedding in use says why. A reranker on the processor is not offered while the embedding runs on the processor: every query would wait for both.",
    table: "Reranker models",
  },
} as const;

const PLACE = {
  cpu: "A process of its own, at low priority, leaves two threads to the rest of the PC and closes after 10 minutes without work.",
  gpu: "The card computes the vectors in a process of its own, which closes after 10 minutes without work.",
  "llama.cpp": "llama-server computes the vectors and closes after 10 minutes without work.",
} as const;

const CANNOT = ["ram-too-small", "unsupported"];

// ponytail: the search models of one kind, one by one — the one advised for this PC first, then every other one; the
// model in use is the open project's on this PC (inUse: undefined while no project is open, null for « no reranker »)
export function SearchGroup({
  kind,
  rows,
  installed,
  inUse,
  advisedOnCpu,
  llama,
  ops,
  busy,
  hasProject,
  onUse,
  onCheck,
  onRemove,
  onLlama,
  place,
}: {
  kind: "embedding" | "reranker";
  rows: CatalogRow[] | undefined;
  installed: Installed[];
  inUse: string | null | undefined;
  /** the embedding advised runs on the processor: no reranker is advised beside it */
  advisedOnCpu: boolean;
  llama?: Dirs["llamacpp"];
  ops: Op[];
  busy: boolean;
  hasProject: boolean;
  onUse: (r: CatalogRow | null) => void;
  onCheck: (r: CatalogRow) => void;
  onRemove: (r: CatalogRow, inst: Installed) => void;
  onLlama?: () => void;
  /** where the embedding in use runs on this PC (rag.status) */
  place?: { where: "gpu" | "cpu"; engine: string; text: string } | null;
}) {
  const k = KIND[kind];
  const rr = kind === "reranker";
  const advised = rows?.find((r) => r.advised) ?? null;
  const used = rows?.find((r) => r.id === inUse);
  const usable = (off: string | null) => ({ disabled: hasProject ? (off ?? busy) : "Open a project first" });

  const lineOf = (r: CatalogRow): ModelLine => {
    const inst = installed.find((i) => i.model === r.id);
    const judged = rr && r.pair ? r.pair : r.fit;
    const cannot = CANNOT.includes(judged.verdict);
    const off = r.aside ?? (cannot ? judged.message : null);
    return {
      id: r.id,
      label: r.label,
      note: aboutModel(r),
      why: r.aside ?? (judged.verdict === "fits" ? null : judged.message),
      off: !!off,
      runsOn: runsOn(r.fit),
      sizeMB: inst?.sizeMB ?? r.sizeMB,
      here: <Here state={r.state} />,
      inUse: r.id === inUse,
      op: ops.find((o) => o.key === r.id) ?? null,
      use: { ...usable(off ? "Not offered here: see why under its name" : null), onClick: () => onUse(r) },
      ...(isInstalled(r.state) || inst ? { check: () => onCheck(r) } : {}),
      ...(inst ? { remove: () => onRemove(r, inst) } : {}),
    };
  };

  const none: ModelLine = {
    id: "none",
    label: "None",
    note: "Search ranks by words and meaning only.",
    runsOn: "",
    sizeMB: null,
    here: null,
    inUse: inUse === null,
    op: null,
    use: { ...usable(null), onClick: () => onUse(null) },
  };
  const lines = [...(rr && advised ? [none] : []), ...(rows ?? []).filter((r) => r !== advised).map(lineOf)];

  const pick = (r: CatalogRow) => {
    const here = isInstalled(r.state);
    return (
      <Button
        variant="primary"
        size="sm"
        icon={here ? "check" : "download"}
        label={here ? "Use" : "Download and use"}
        disabled={hasProject ? busy : "Open a project first"}
        onClick={() => onUse(r)}
      />
    );
  };

  const llamaOp = ops.find((o) => o.key === LLAMA) ?? null;
  return (
    <Group
      id={k.id}
      title={k.title}
      note={k.note}
      actions={
        inUse !== undefined && (
          <span {...stylex.props(styles.head)}>
            <span {...stylex.props(type.small, styles.muted)}>In use</span>
            <Badge label={inUse === null ? "None" : (used?.label ?? inUse)} size="sm" />
          </span>
        )
      }
      footer={
        place ? (
          <div {...stylex.props(type.small, styles.foot)}>
            <Badge label={place.text} icon={place.where === "gpu" ? "monitor" : "cpu"} size="sm" />
            <span>{PLACE[place.engine === "llama.cpp" ? "llama.cpp" : place.where]}</span>
          </div>
        ) : (
          rr &&
          llama !== undefined && (
            <div {...stylex.props(type.small, styles.foot)}>
              {llama ? (
                <Badge label={`llama.cpp ${llama.build}, ${llama.backend}`} tone="success" icon="check" size="sm" />
              ) : (
                <Badge label="llama.cpp not installed" icon="download" size="sm" />
              )}
              <span>Runs the GGUF models. A model marked CPU or DirectML does not need it.</span>
              {llamaOp ? (
                <OpLine op={llamaOp} />
              ) : (
                !llama &&
                onLlama && (
                  <Button size="sm" icon="download" label="Download llama.cpp" disabled={busy} onClick={onLlama} />
                )
              )}
            </div>
          )
        )
      }
    >
      {!rows ? (
        <Row>
          <Skeleton kind="block" />
          <Loading read="models.catalog" />
        </Row>
      ) : (
        <>
          {advised ? (
            <AdvisedRow
              name={advised.label}
              hint={advised.reason}
              facts={[["Download", size(advised.sizeMB)], roomOf(advised.fit)]}
              inUse={advised.id === inUse}
              op={ops.find((o) => o.key === advised.id) ?? null}
            >
              {advised.id !== inUse && pick(advised)}
            </AdvisedRow>
          ) : (
            rr && (
              <AdvisedRow
                name="None"
                hint={
                  advisedOnCpu
                    ? "With the embedding advised on the processor, a reranker would slow every query: none is advised."
                    : "None is advised for this PC: search ranks by words and meaning only."
                }
                facts={[]}
                inUse={inUse === null}
                op={null}
              >
                {inUse !== null && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon="check"
                    label="Use"
                    disabled={hasProject ? busy : "Open a project first"}
                    onClick={() => onUse(null)}
                  />
                )}
              </AdvisedRow>
            )
          )}
          <Rule>{k.rule}</Rule>
          <Row flush>
            <ModelTable label={k.table} lines={lines} busy={busy} />
          </Row>
        </>
      )}
    </Group>
  );
}
