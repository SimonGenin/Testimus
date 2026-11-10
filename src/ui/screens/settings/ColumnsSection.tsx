import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CommandInput } from "../../../core/commands/index.ts";
import type { ColumnShow, StepColumn } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, key, type Prefix } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { ColumnCard, columnFieldId } from "./ColumnCard.tsx";
import { ColumnsClaude } from "./ColumnsClaude.tsx";
import { NewColumn } from "./NewColumn.tsx";
import { type Info, useInfo } from "./project.ts";
import { Group, Row, Section } from "./Section.tsx";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  item: {
    containerType: "inline-size",
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  open: { backgroundColor: color.canvas },
  dragging: { opacity: 0.5 },
  read: { color: color.textMuted },
  plain: { margin: 0 },
  acts: { display: "flex", gap: space.s2, flexWrap: "wrap" },
});

const READS: Prefix[] = [["project.info"], ["columns.list"], ["tests.folds"]];

export function ColumnsSection() {
  const app = useApp();
  const client = useQueryClient();
  const info = useInfo();
  const [drag, setDrag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<StepColumn | null>(null);
  const columns = info.data?.columns ?? [];
  const fields = info.data?.xray.fields ?? [];
  const order = columns.map((c) => c.name);

  useEffect(() => {
    if (!focus) return;
    const field = document.getElementById(columnFieldId(focus));
    field?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    field?.focus();
    setFocus(null);
  }, [focus]);

  const patchColumns = (next: (cols: StepColumn[]) => StepColumn[]) => (c: typeof client) => {
    const k = key("project.info", {}) as unknown as readonly unknown[];
    const before = c.getQueryData<Info>(k);
    if (before) c.setQueryData<Info>(k, { ...before, columns: next(before.columns) });
    return () => c.setQueryData(k, before);
  };

  const setModes = (modes: CommandInput<"columns.setModes">["modes"]) =>
    void execute(
      client,
      "columns.setModes",
      { modes },
      {
        invalidates: READS,
        optimistic: patchColumns((cols) => cols.map((c) => (modes[c.name] ? { ...c, mode: modes[c.name] } : c))),
      },
    ).catch((e) => errorToast(e, "Could not save the smart columns"));

  const move = (column: string, to: number) => {
    const rest = order.filter((n) => n !== column);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, column);
    void execute(
      client,
      "columns.order",
      { names: rest },
      {
        invalidates: READS,
        optimistic: patchColumns((cols) => rest.map((n) => cols.find((c) => c.name === n) as StepColumn)),
      },
    ).catch((e) => errorToast(e, "Could not save the smart columns"));
  };

  const saveReference = (column: string, referenceSource: boolean) =>
    void execute(
      client,
      "columns.save",
      { name: column, referenceSource },
      {
        invalidates: READS,
        optimistic: patchColumns((cols) => cols.map((c) => (c.name === column ? { ...c, referenceSource } : c))),
      },
    ).catch((e) => errorToast(e, "Could not save the column"));

  const remove = async (column: string) => {
    await execute(client, "columns.remove", { name: column }, { invalidates: READS });
    setRemoving(null);
    toast({
      tone: "success",
      title: `Column ${column} removed`,
      detail: "What the tests hold in it stays in test.md.",
    });
  };

  const leaveEmpty = (column: string) =>
    void execute(
      client,
      "columns.save",
      { name: column, description: "" },
      {
        invalidates: READS,
        optimistic: patchColumns((cols) =>
          cols.map((c) => (c.name === column ? { ...c, status: "ok", description: "" } : c)),
        ),
      },
    ).catch((e) => errorToast(e, "Could not save the column"));

  const describeColumn = (column: string) => {
    setOpen(column);
    setFocus(column);
  };

  const descriptionOf = (c: StepColumn): { saveKey: Key; save: Save<string> } => {
    const saveKey: Key = [project(), "project.info", { column: c.name }];
    return {
      saveKey,
      save: async (text) => {
        if (text.trim() === c.description) return;
        await execute(client, "columns.save", { name: c.name, description: text }, { invalidates: READS }, saveKey[0]);
      },
    };
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await execute(client, "xray.refreshFields", {}, { invalidates: READS });
      toast({ tone: "success", title: "Smart columns read again from Xray" });
    } catch (e) {
      errorToast(e, "Could not read the step fields from Jira");
    } finally {
      setRefreshing(false);
    }
  };

  const fetchedAt = info.data?.xray.fetchedAt;
  const noKey = !!info.data && !info.data.project.jiraProject?.trim();
  const fresh = columns.filter((c) => c.status === "new").map((c) => c.name);
  const first = fresh[0];
  const gone = columns.filter((c) => c.status === "gone").map((c) => c.name);
  const fieldOf = (c: StepColumn) => fields.find((f) => (c.id ? f.id === c.id : f.name === c.name));
  return (
    <Section
      id="columns"
      title="Smart columns"
      intro="The columns of a test step. Claude fills a column from its description; a column with no description stays empty."
      actions={
        <>
          {fetchedAt && (
            <span {...stylex.props(type.small, styles.read)}>
              Read from Xray {new Date(fetchedAt).toLocaleString("en-GB")}
            </span>
          )}
          <Button
            size="sm"
            icon="download"
            label={refreshing ? "Reading…" : "Read again from Xray"}
            loading={refreshing}
            disabled={noKey ? "Set the project's Jira key first (Project)" : false}
            onClick={() => void refresh()}
          />
        </>
      }
    >
      {noKey && (
        <Banner
          tone="neutral"
          icon="info"
          actions={
            <Button
              size="sm"
              variant="quiet"
              label="Set the Jira key"
              onClick={() => app.navigate("settings", "project-jira")}
            />
          }
        >
          This project has no Jira key: the columns are Xray's three standard ones until you set one in Project.
        </Banner>
      )}
      {(fresh.length > 0 || gone.length > 0) && (
        <Banner
          tone="warning"
          actions={
            first && (
              <span {...stylex.props(styles.acts)}>
                <Button
                  size="sm"
                  label={fresh.length === 1 ? "Describe it" : `Describe ${first}`}
                  onClick={() => describeColumn(first)}
                />
                <Button
                  size="sm"
                  variant="quiet"
                  label={fresh.length === 1 ? "Leave it empty" : `Leave ${first} empty`}
                  onClick={() => leaveEmpty(first)}
                />
              </span>
            )
          }
        >
          {fresh.length === 1 &&
            `${first} is a step field in Xray with no description yet. Say what Claude writes in it, or leave it empty for good. `}
          {fresh.length > 1 &&
            `${fresh.join(", ")} are step fields in Xray with no description yet. Say what Claude writes in each, or leave it empty for good. `}
          {gone.length > 0 && `No longer in Xray, kept as local columns: ${gone.join(", ")}.`}
        </Banner>
      )}
      <Group
        title="Columns of a step"
        note="Drag to reorder. The order is the order in the editor."
        footer={<NewColumn reads={READS} />}
      >
        {!info.data ? (
          <Row>
            <Skeleton kind="block" />
            <Loading read="project.info" />
          </Row>
        ) : (
          <ul aria-label="Smart columns" {...stylex.props(styles.list)}>
            {columns.map((c, i) => (
              <li
                key={c.name}
                aria-label={c.name}
                draggable
                data-dragging={drag === c.name || undefined}
                onDragStart={(e) => {
                  setDrag(c.name);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.name);
                }}
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && drag !== c.name) move(drag, i);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                {...stylex.props(styles.item, open === c.name && styles.open, drag === c.name && styles.dragging)}
              >
                <ColumnCard
                  column={c}
                  field={fieldOf(c)}
                  open={open === c.name}
                  onToggle={() => setOpen(open === c.name ? null : c.name)}
                  first={i === 0}
                  last={i === columns.length - 1}
                  description={descriptionOf(c)}
                  onMode={(m: ColumnShow) => setModes({ [c.name]: m })}
                  onReferenceSource={(on) => saveReference(c.name, on)}
                  onMove={(by) => move(c.name, i + by)}
                  onRemove={c.origin === "local" ? () => setRemoving(c) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </Group>
      <ColumnsClaude columns={columns} />
      {removing && (
        <Modal
          size="sm"
          title={`Remove the column ${removing.name}?`}
          confirm={{ verb: "Remove", danger: true, onConfirm: () => remove(removing.name) }}
          onClose={() => setRemoving(null)}
        >
          <p {...stylex.props(styles.plain)}>
            {removing.description.trim()
              ? "What Claude is told to write in it is lost. What the tests hold in it stays in test.md."
              : "What the tests hold in it stays in test.md."}
          </p>
        </Modal>
      )}
    </Section>
  );
}
