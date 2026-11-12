import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { DocStage } from "../../components/sources/DocStage.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { execute, invalidate, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { bytesLine, PlanFacts } from "./PendingBatch.tsx";

type DocRef = CommandOutput<"docs.list">[number];

const styles = stylex.create({
  wrap: { padding: space.s5, overflowY: "auto", flex: 1, minHeight: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  text: { margin: 0, color: color.textMuted },
  path: { overflowWrap: "anywhere" },
  acts: { display: "flex", gap: space.s3 },
});

// ponytail: a document waiting for the go — where its originals are, what starting it takes, why its last start
// stopped; Start copies and converts it, Remove takes it away without a trace (its originals stay where they are)
export function PendingDoc({ doc, onRemoved }: { doc: DocRef; onRemoved: () => void }) {
  const app = useApp();
  const client = useQueryClient();
  const plan = useRead("docs.planStart", { ids: [doc.id] });
  const [busy, setBusy] = useState<"start" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = doc.pending?.files ?? [];
  const copying = doc.stage.name === "copying";

  const start = async () => {
    setError(null);
    setBusy("start");
    try {
      const { model, effort } = importClaude();
      const r = await execute(client, "docs.start", {
        ids: [doc.id],
        triage: true,
        index: true,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      jobToast(`Starting ${doc.title || doc.id}`, r.jobId, app.openJob);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setError(null);
    setBusy("remove");
    try {
      await execute(client, "docs.remove", { id: doc.id });
      void invalidate(client, [["docs.list"], ["docs.planStart"]]);
      onRemoved();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };

  return (
    <div {...stylex.props(styles.wrap)}>
      <Card title={<DocStage stage={doc.stage} size="md" />}>
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(type.compact, styles.text)}>
            Nothing of it is copied nor converted yet. Start it to copy {files.length > 1 ? "its files" : "its file"}{" "}
            into the project, convert {files.length > 1 ? "them" : "it"} and index it.
          </p>
          <Facts
            size="sm"
            label="Its originals"
            items={[
              ...files.slice(0, 5).map((f, i) => ({
                label: i === 0 ? (files.length > 1 ? plural(files.length, "file") : "File") : "",
                value: (
                  <span {...stylex.props(type.mono, styles.path)}>
                    {f.path} · {bytesLine(f.size)}
                  </span>
                ),
              })),
              files.length > 5 && { label: "", value: `and ${files.length - 5} more` },
              doc.pending?.pdf && {
                label: "Its PDF",
                value: (
                  <span {...stylex.props(type.mono, styles.path)}>
                    {doc.pending.pdf.path} · {bytesLine(doc.pending.pdf.size)}
                  </span>
                ),
              },
            ]}
          />
          {plan.data ? <PlanFacts plan={plan.data} /> : plan.isError ? null : <Loading read="docs.planStart" />}
          {doc.pending?.failed && (
            <Banner tone="danger" compact title="The last start stopped">
              {doc.pending.failed}
            </Banner>
          )}
          {error && (
            <Banner tone="danger" compact>
              {error}
            </Banner>
          )}
          <div {...stylex.props(styles.acts)}>
            <Button
              variant="primary"
              icon="play"
              label={doc.pending?.failed ? "Start again" : "Start"}
              loading={busy === "start"}
              disabled={
                copying ? "It is being copied" : plan.data?.short ? "Not enough room on the project's drive" : !!busy
              }
              onClick={() => void start()}
            />
            <Button
              icon="trash"
              label="Remove"
              loading={busy === "remove"}
              disabled={copying ? "Cancel the start that copies it first" : !!busy}
              onClick={() => void remove()}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
