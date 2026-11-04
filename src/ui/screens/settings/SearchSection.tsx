import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { useApp } from "../../lib/app.ts";
import { execute, invalidate, useRead } from "../../lib/data/query.ts";
import { plural, relTime } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { reindexAll, useUploads } from "../../lib/uploads.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { choiceLabel, ORIGIN } from "./models/data.ts";
import { useInfo } from "./project.ts";
import { Hint, Section, Stack } from "./Section.tsx";

const styles = stylex.create({
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: space.s5,
    rowGap: space.s2,
    margin: 0,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  dt: { color: color.textMuted },
  dd: { margin: 0, display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap", minWidth: 0 },
  muted: { color: color.textMuted },
  state: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  spacer: { flex: 1 },
  model: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  id: { fontFamily: fontFamily.mono, fontSize: fontSize.code, lineHeight: lineHeight.code, color: color.textMuted },
  badges: { display: "flex", gap: space.s2, flexWrap: "wrap" },
  lock: { display: "flex", alignItems: "flex-start", gap: space.s2, color: color.textMuted },
});

export type Space = CommandOutput<"rag.spaces">[number];

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? relTime(Date.parse(iso)) : "—");

function DropSpace({ space: s, label, onClose }: { space: Space; label: string; onClose: () => void }) {
  const client = useQueryClient();
  const drop = async () => {
    try {
      const r = await execute(
        client,
        "rag.dropSpace",
        { id: s.id, force: s.active },
        {
          invalidates: [["rag.spaces"], ["rag.status"], ["docs.list"], ["models.advice"]],
        },
      );
      toast({ kind: "ok", title: "Vector space dropped", detail: `${r.dropped} · ${r.freedMB} MB freed` });
    } catch (e) {
      errorToast(e, "Could not drop the vector space");
    } finally {
      onClose();
    }
  };
  return (
    <Modal
      size="sm"
      title={`Drop the ${label} vectors?`}
      confirm={{ verb: `Drop ${s.sizeMB} MB`, danger: true, onConfirm: drop }}
      consequences={[
        [s.chunks, "vectors deleted from the index"],
        [`${s.sizeMB} MB`, "freed on this PC"],
      ]}
      consequencesAt="start"
      onClose={onClose}
    >
      {s.active && (
        <Banner tone="warning" compact>
          This PC searches with it: search falls back to words only until you reindex.
        </Banner>
      )}
    </Modal>
  );
}

// ponytail: what searches this project's documents on this PC — the team's reference and the models used here, the
// index state with Reindex, and one vector space per embedding model ever used
export function SearchSection() {
  const app = useApp();
  const client = useQueryClient();
  const info = useInfo();
  const st = useRead("rag.status", {});
  const spaces = useRead("rag.spaces", {});
  const catalog = useRead("models.catalog", {});
  const [dropping, setDropping] = useState<Space | null>(null);
  const indexing = useUploads().some((u) => u.phase === "indexing");
  const labels = new Map((catalog.data ?? []).map((c) => [c.id, c.label]));
  const label = (id: string) => labels.get(id) ?? id;
  const s = st.data;
  const reference = info.data?.project.rag?.reference;
  const fresh = !!s?.exists && s.profileMatches && s.docs.every((d) => d.indexed === "fresh");
  const behind = s?.docs.filter((d) => d.indexed !== "fresh").length ?? 0;

  return (
    <Section
      id="search"
      title="Search"
      intro="How this project's documents are searched on this PC: the models, the index, and the vectors each model keeps."
      actions={<Button icon="cpu" label="Choose models…" onClick={() => app.navigate("settings", "models")} />}
    >
      <Card title="Search on this PC">
        <Stack>
          {st.isError ? (
            <Banner tone="danger" title="The index state could not be read">
              {st.error.message}
            </Banner>
          ) : (
            <dl {...stylex.props(styles.facts)}>
              <dt {...stylex.props(styles.dt)}>Team reference</dt>
              <dd {...stylex.props(styles.dd)}>
                {reference ? choiceLabel(reference, label) : "Not set: the Light pack"}
                <span {...stylex.props(styles.muted)}>· in project.json, shared with the team</span>
              </dd>
              <dt {...stylex.props(styles.dt)}>Used on this PC</dt>
              <dd {...stylex.props(styles.dd)}>
                {!s ? (
                  <Skeleton width="60%" />
                ) : (
                  <>
                    {s.embedding === "none" ? (
                      "No embedding model"
                    ) : (
                      <>
                        {label(s.embedding)}
                        <span {...stylex.props(styles.muted)}> · {s.reranker ? label(s.reranker) : "no reranker"}</span>
                      </>
                    )}
                    <Badge
                      label={ORIGIN[s.activation]}
                      tone={s.activation === "none" ? "warning" : "neutral"}
                      outline
                      size="sm"
                      tooltip="Where this choice comes from"
                    />
                  </>
                )}
              </dd>
              {s && s.missing.length > 0 && (
                <>
                  <dt {...stylex.props(styles.dt)}>Not on this PC</dt>
                  <dd {...stylex.props(styles.dd)}>
                    <Badge label={s.missing.map(label).join(", ")} tone="warning" icon="alert-triangle" size="sm" />
                    <span {...stylex.props(styles.muted)}>· install them in Models, or another choice is used</span>
                  </dd>
                </>
              )}
            </dl>
          )}
          {s?.degraded && (
            <Banner tone="warning" title="Search on words only">
              <span role="status">Search on words only — {s.degraded}</span>
            </Banner>
          )}
          <div {...stylex.props(styles.state)}>
            {!s ? (
              <Skeleton width="40%" />
            ) : indexing ? (
              <Badge label="Indexing…" tone="info" busy />
            ) : fresh ? (
              <>
                <Badge label="Up to date" tone="success" icon="check-circle" />
                <span {...stylex.props(styles.muted)}>Index up to date · {plural(s.chunks, "passage")}</span>
              </>
            ) : !s.exists ? (
              <Badge label="No index yet" tone="warning" icon="alert-triangle" />
            ) : (
              <Badge
                label={
                  !s.profileMatches
                    ? "Vectors missing for this model — reindex"
                    : `${plural(behind, "document")} to reindex`
                }
                tone="warning"
                icon="alert-triangle"
              />
            )}
            <span {...stylex.props(styles.spacer)} />
            <Button
              size="sm"
              icon="refresh"
              label="Reindex"
              disabled={indexing}
              onClick={() => void reindexAll(() => void invalidate(client, [["rag.status"], ["rag.spaces"]]))}
            />
          </div>
        </Stack>
      </Card>
      <Card title="Vector spaces in this index">
        <Stack>
          <Table<Space>
            label="Vector spaces"
            dense
            loading={!spaces.data && !spaces.isError}
            rows={spaces.data ?? []}
            getKey={(x) => x.id}
            empty="None yet: the first index run with an embedding model builds one."
            columns={[
              {
                key: "model",
                label: "Model",
                render: (x) => (
                  <span {...stylex.props(styles.model)}>
                    <span>{label(x.model)}</span>
                    <span {...stylex.props(styles.id)}>
                      Space {x.id} · {x.runtime} · {x.dims} dims
                    </span>
                  </span>
                ),
              },
              { key: "chunks", label: "Vectors", numeric: true },
              { key: "sizeMB", label: "Size", numeric: true, render: (x) => `${x.sizeMB} MB` },
              {
                key: "state",
                label: "State",
                render: (x) => (
                  <span {...stylex.props(styles.badges)}>
                    {x.complete ? (
                      <Badge label="Complete" tone="success" icon="check" size="sm" />
                    ) : (
                      <Badge label="Incomplete" tone="warning" icon="alert-triangle" size="sm" />
                    )}
                    {x.active && <Badge label="In use here" tone="success" icon="circle-dot" size="sm" />}
                  </span>
                ),
              },
              { key: "lastUsed", label: "Last used", render: (x) => when(x.lastUsed ?? x.builtAt) },
              {
                key: "drop",
                label: "Actions",
                render: (x) => (
                  <Button
                    size="xs"
                    variant="quiet"
                    icon="trash"
                    iconOnly
                    label={`Drop space ${x.id}`}
                    onClick={() => setDropping(x)}
                  />
                ),
              },
            ]}
          />
          <span {...stylex.props(styles.lock)}>
            <Icon name="lock" size="sm" />
            <Hint>
              Documents are indexed on this PC and never sent elsewhere. Each model keeps its own vectors: switching
              back to a model already indexed is quick.
            </Hint>
          </span>
        </Stack>
      </Card>
      {dropping && <DropSpace space={dropping} label={label(dropping.model)} onClose={() => setDropping(null)} />}
    </Section>
  );
}
