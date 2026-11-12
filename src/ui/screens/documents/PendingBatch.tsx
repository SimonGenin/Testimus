import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { List } from "../../components/ui/List.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { execute, invalidate, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { minutes } from "./VideoEstimate.tsx";

type DocRef = CommandOutput<"docs.list">[number];
type Plan = CommandOutput<"docs.planStart">;

const styles = stylex.create({
  wrap: { paddingInline: space.s3, paddingTop: space.s3 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  muted: { color: color.textMuted },
});

const TYPES: [keyof Plan["byType"], string, string][] = [
  ["docx", "Word", "Word"],
  ["pdf", "PDF", "PDF"],
  ["txt", "text", "text"],
  ["images", "folder of images", "folders of images"],
  ["video", "video", "videos"],
  ["mixed", "images and videos", "images and videos"],
];

export const bytesLine = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${Math.round(bytes / 1e6)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

export const typesLine = (byType: Plan["byType"]) =>
  TYPES.filter(([k]) => byType[k] > 0)
    .map(([k, one, many]) => `${byType[k]} ${byType[k] === 1 ? one : many}`)
    .join(" · ");

// ponytail: what starting them takes, said before the go (docs.planStart) — by type, the bytes to copy against the
// room left, Claude's runs, about how long
export function PlanFacts({ plan }: { plan: Plan }) {
  return (
    <>
      <Facts
        size="sm"
        label="What starting them takes"
        items={[
          { label: "Documents", value: typesLine(plan.byType) || "none" },
          { label: "To copy", value: `${bytesLine(plan.bytes)} · ${plural(plan.files, "file")}` },
          plan.freeBytes !== null && {
            label: "Room",
            value: `${bytesLine(plan.needBytes)} needed · ${bytesLine(plan.freeBytes)} free on the project's drive`,
          },
          { label: "Claude", value: `About ${plural(plan.claudeRuns, "run")}` },
          {
            label: "Time",
            value: `${minutes(plan.seconds)} · estimated (${plan.slots} at a time)`,
          },
        ]}
      />
      {plan.short && (
        <Banner tone="danger" compact>
          Not enough room on the project's drive for these copies: free some room, or start fewer documents.
        </Banner>
      )}
    </>
  );
}

// ponytail: the documents of a folder import waiting for the go, at the head of the list — what starting them takes,
// which ones (all ticked), Start or Remove; nothing waits meanwhile: the other documents, search and generation go on
export function PendingBatch({ docs }: { docs: DocRef[] }) {
  const app = useApp();
  const client = useQueryClient();
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState<"start" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = docs.filter((d) => !off[d.id]).map((d) => d.id);
  const all = picked.length === docs.length;
  const read = useRead("docs.planStart", all ? {} : { ids: picked });
  const plan = read.data;
  const n = picked.length;
  const what = all ? " all" : ` ${plural(n, "document")}`;

  const start = async () => {
    setError(null);
    setBusy("start");
    try {
      const { model, effort } = importClaude();
      const r = await execute(client, "docs.start", {
        ...(all ? {} : { ids: picked }),
        triage: true,
        index: true,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      jobToast(`Starting ${plural(n, "document")}`, r.jobId, app.openJob);
      setOff({});
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
      for (const id of picked) await execute(client, "docs.remove", { id });
      setOff({});
      void invalidate(client, [["docs.list"], ["docs.planStart"]]);
      app.refreshInfo();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div {...stylex.props(styles.wrap)}>
      <Card
        density="tight"
        title={`${plural(docs.length, "document")} waiting to start`}
        note="Nothing is copied nor converted until you start them."
      >
        {plan ? <PlanFacts plan={plan} /> : read.isError ? null : <Loading read="docs.planStart" />}
        {read.isError && (
          <span {...stylex.props(type.small, styles.muted)}>The estimate could not be read: {message(read.error)}</span>
        )}
        <Disclosure quiet summary="Choose the documents" open={choosing} onOpenChange={setChoosing}>
          <List
            label="Documents waiting to start"
            selection="none"
            items={docs}
            getKey={(d) => d.id}
            renderItem={(d) => ({
              title: (
                <Checkbox
                  checked={!off[d.id]}
                  label={d.title || d.id}
                  onChange={(on) => setOff((o) => ({ ...o, [d.id]: !on }))}
                />
              ),
            })}
          />
        </Disclosure>
        {error && (
          <Banner tone="danger" compact>
            {error}
          </Banner>
        )}
        <div {...stylex.props(styles.actions)}>
          <Button
            variant="primary"
            size="sm"
            icon="play"
            label={`Start${what}`}
            loading={busy === "start"}
            disabled={
              !n ? "Tick at least one document" : plan?.short ? "Not enough room on the project's drive" : !!busy
            }
            onClick={() => void start()}
          />
          <Button
            size="sm"
            icon="trash"
            label={`Remove${what}`}
            loading={busy === "remove"}
            disabled={!n ? "Tick at least one document" : !!busy}
            onClick={() => void remove()}
          />
        </div>
      </Card>
    </div>
  );
}
