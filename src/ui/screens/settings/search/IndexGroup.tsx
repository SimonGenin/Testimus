import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Progress } from "../../../components/ui/Progress.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { execute, invalidate, useRead } from "../../../lib/data/query.ts";
import { indexRunLine, indexRunPercent, plural, relTime } from "../../../lib/format.ts";
import { errorToast } from "../../../lib/toast.ts";
import { importClaude } from "../../../lib/uploads.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { OpLine } from "../models/OpLine.tsx";
import { useOps } from "../models/ops.tsx";
import { Fact, Group, Hint, Row } from "../Section.tsx";
import { DropSpace, type Space } from "./DropSpace.tsx";
import { useModelLabel } from "./labels.ts";

const styles = stylex.create({
  state: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap", minWidth: 0 },
  muted: { color: color.textMuted },
  model: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  id: { color: color.textMuted },
  badges: { display: "flex", gap: space.s2, flexWrap: "wrap" },
  foot: { display: "flex", alignItems: "flex-start", gap: space.s2, color: color.textMuted },
  loading: { paddingInline: space.s6, paddingBlockEnd: space.s4 },
});

type Status = CommandOutput<"rag.status">;

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? relTime(Date.parse(iso)) : "—");

function State({ s, label }: { s: Status; label: (id: string) => string }) {
  const muted = (text: string) => <span {...stylex.props(styles.muted)}>{text}</span>;
  if (!s.docs.length)
    return (
      <>
        <Badge label="Empty" icon="circle-dashed" />
        {muted("No document yet — nothing to index.")}
      </>
    );
  if (s.exists && s.profileMatches && s.docs.every((d) => d.indexed === "fresh"))
    return (
      <>
        <Badge label="Up to date" tone="success" icon="check-circle" />
        {muted(
          `${plural(s.chunks, "passage")} from ${plural(s.docs.length, "document")}, with ${
            s.embedding === "none" ? "no embedding model" : label(s.embedding)
          }, ${s.reranker ? label(s.reranker) : "no reranker"}`,
        )}
      </>
    );
  if (!s.exists) return <Badge label="No index yet" tone="warning" icon="alert-triangle" />;
  if (!s.profileMatches)
    return (
      <>
        <Badge label="Words only" tone="warning" icon="alert-triangle" />
        {muted(
          `${plural(s.chunks, "passage")} · ${plural(s.docs.length, "document")} · no vectors for the active model`,
        )}
      </>
    );
  return (
    <>
      <Badge label="To reindex" tone="warning" icon="alert-triangle" />
      {muted(`${plural(s.docs.filter((d) => d.indexed !== "fresh").length, "document")} to reindex`)}
    </>
  );
}

// ponytail: this project's index on this PC — its state with Reindex (an index run is a job followed here, one
// found running after a reload too), and one vector space per embedding model ever used, each droppable
export function IndexGroup() {
  const client = useQueryClient();
  const st = useRead("rag.status", {});
  const spaces = useRead("rag.spaces", {});
  const label = useModelLabel();
  const [dropping, setDropping] = useState<Space | null>(null);
  const [starting, setStarting] = useState(false);
  const { ops, start, watchers } = useOps((op, job) => {
    if (op.key === "index" && job.status !== "running") void invalidate(client, [["rag.status"], ["rag.spaces"]]);
  }, label);
  const run = ops.find((o) => o.key === "index");
  const s = st.data;
  const building = s?.indexing ?? null;
  const indexing = starting || !!run || !!building;
  // ponytail: while an index run builds the index, words only and the documents behind are its work, not warnings
  const degraded = building ? null : (s?.degraded ?? null);
  const startIndex = async () => {
    setStarting(true);
    try {
      const { jobId } = await execute(client, "rag.index", importClaude(), { invalidates: [["jobs.list"]] });
      start(jobId, "index", "rag-index", "Indexing the documents");
    } catch (e) {
      errorToast(e, "Could not reindex");
    } finally {
      setStarting(false);
    }
  };
  return (
    <Group
      id="index"
      title="This project's index"
      actions={
        <Button
          size="sm"
          icon="refresh"
          label="Reindex"
          loading={starting}
          disabled={indexing || (s && !s.docs.length ? "Add documents first" : false)}
          onClick={() => void startIndex()}
        />
      }
      footer={
        <span {...stylex.props(styles.foot)}>
          <Icon name="lock" size="sm" />
          <Hint>
            Indexed on this PC, never sent elsewhere. Each model keeps its own vectors, so switching back to one already
            indexed is quick.
          </Hint>
        </span>
      }
    >
      {watchers}
      <Row>
        <Fact label="State">
          {st.isError ? (
            <Banner tone="danger" title="The index state could not be read">
              {st.error.message}
            </Banner>
          ) : !s ? (
            <Skeleton width="40%" />
          ) : run ? (
            <OpLine op={run} />
          ) : building ? (
            <Progress label="Index" value={indexRunPercent(building)} detail={indexRunLine(building)} />
          ) : (
            <div {...stylex.props(styles.state)}>
              <State s={s} label={label} />
            </div>
          )}
          {degraded && (
            <Banner tone="warning" title="Search on words only">
              {degraded}
            </Banner>
          )}
        </Fact>
      </Row>
      <Row flush>
        <Table<Space>
          label="Vector spaces"
          dense
          flush
          loading={!spaces.data && !spaces.isError}
          rows={spaces.data ?? []}
          getKey={(x) => x.id}
          empty="None yet: the first index run with an embedding model builds one."
          columns={[
            {
              key: "model",
              label: "Vectors kept for",
              render: (x) => (
                <span {...stylex.props(styles.model)}>
                  <span>{label(x.model)}</span>
                  <span {...stylex.props(type.code, styles.id)}>
                    {x.id}, {x.dims} dims
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
                  ) : x.active && building ? (
                    <Badge label="Building" tone="info" busy size="sm" />
                  ) : (
                    <Badge label="Incomplete" tone="warning" icon="alert-triangle" size="sm" />
                  )}
                  {x.active && <Badge label="In use here" tone="success" icon="target" size="sm" />}
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
        {!spaces.data && !spaces.isError && (
          <div {...stylex.props(styles.loading)}>
            <Loading read="rag.spaces" />
          </div>
        )}
      </Row>
      {dropping && <DropSpace space={dropping} label={label(dropping.model)} onClose={() => setDropping(null)} />}
    </Group>
  );
}
