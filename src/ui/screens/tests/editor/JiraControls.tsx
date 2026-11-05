import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar } from "../../../components/ui/Avatar.tsx";
import { Badge, jiraStatus } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { List } from "../../../components/ui/List.tsx";
import { Menu, type MenuEntry } from "../../../components/ui/Menu.tsx";
import { Popover } from "../../../components/ui/Popover.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { type } from "../../../components/ui/type.ts";
import { execute, useRead } from "../../../lib/data/query.ts";
import { message } from "../../../lib/format.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  bar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, flex: "none" },
  who: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  pick: { display: "flex", flexDirection: "column", gap: space.s3 },
  note: { color: color.textSubtle, margin: 0 },
});

const NOW = "Changes the issue in Jira now — not part of a push.";

type Person = { accountId: string; name: string };

// ponytail: the Jira side of the test's head — its workflow status, its assignee, its comments; each change goes to
// Jira at once (issue.*), and test.md follows (the editor reads it again)
export function JiraControls({
  testKey,
  status,
  assignee,
  assigneeId,
  readOnly,
  comments,
  onComments,
}: {
  testKey: string;
  status?: string;
  assignee?: string;
  assigneeId?: string;
  readOnly?: string | false;
  comments: number | null;
  onComments: () => void;
}) {
  return (
    <div {...stylex.props(styles.bar)}>
      <StatusMenu testKey={testKey} status={status} readOnly={readOnly} />
      <AssigneePicker testKey={testKey} name={assignee} id={assigneeId} readOnly={readOnly} />
      <Button
        variant="quiet"
        size="sm"
        icon="quote"
        label={comments === null ? "Comments" : comments === 1 ? "1 comment" : `${comments} comments`}
        onClick={onComments}
      />
    </div>
  );
}

// ponytail: a test not in Jira yet has no status, assignee nor comments; with Jira off the last pull's are shown, read only
export function JiraOff({
  local,
  status,
  assignee,
  assigneeId,
}: {
  local: boolean;
  status?: string;
  assignee?: string;
  assigneeId?: string;
}) {
  if (local)
    return (
      <p {...stylex.props(type.small, styles.note)}>
        Status, assignee and comments come with the Jira issue (push it).
      </p>
    );
  return (
    <div {...stylex.props(styles.bar)}>
      {status && <Badge {...jiraStatus(status)} tooltip="As of the last pull — Jira is not connected" />}
      {assignee && (
        <span {...stylex.props(type.small, styles.who)}>
          <Avatar size="sm" name={assignee} id={assigneeId} />
          {assignee}
        </span>
      )}
      <span {...stylex.props(type.small, styles.note)}>Jira not connected</span>
    </div>
  );
}

function StatusMenu({ testKey, status, readOnly }: { testKey: string; status?: string; readOnly?: string | false }) {
  const client = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const q = useRead("issue.transitions", { key: testKey }, { enabled: asked });
  const word = jiraStatus(status || "No status");

  const move = async (id: string, to: string) => {
    setMoving(to);
    try {
      const r = await execute(client, "issue.transition", { key: testKey, transition: id });
      const undo = r.undo;
      toast({
        tone: "success",
        title: `${testKey} is ${r.status} in Jira`,
        detail: r.local ? undefined : "Pull the test to see it here.",
        action: undo
          ? {
              label: "Undo",
              run: () =>
                void execute(client, "issue.transition", { key: testKey, transition: undo.id }).catch((e) =>
                  errorToast(e, `Could not move ${testKey} back`),
                ),
            }
          : undefined,
      });
    } catch (e) {
      errorToast(e, `Could not move ${testKey}`);
    } finally {
      setMoving(null);
      setAsked(false);
    }
  };

  const entries: MenuEntry[] = q.isError
    ? [{ note: message(q.error) }]
    : !q.data
      ? [{ note: "Asking Jira where it can go…" }]
      : q.data.transitions.length
        ? [
            { group: `Move ${testKey}` },
            ...q.data.transitions.map((t) => ({
              label: t.name,
              hint: `→ ${t.to}`,
              icon: jiraStatus(t.to).icon,
              onSelect: () => void move(t.id, t.to),
            })),
            "separator" as const,
            { note: NOW },
          ]
        : [{ note: `Jira's workflow allows no move from ${q.data.status}.` }];

  return (
    <Menu
      label={`Move ${testKey}`}
      align="end"
      trigger={
        <Button
          size="sm"
          icon={word.icon}
          iconAfter="chevron-down"
          label={moving ? `${moving}…` : word.label}
          loading={!!moving}
          disabled={readOnly || undefined}
          data-testid="jira-status"
          onClick={() => setAsked(true)}
        />
      }
      entries={entries}
    />
  );
}

function AssigneePicker({
  testKey,
  name,
  id,
  readOnly,
}: {
  testKey: string;
  name?: string;
  id?: string;
  readOnly?: string | false;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useRead("issue.people", { key: testKey, query: query.trim() }, { enabled: open, keepPrevious: true });
  const me = q.data?.me;

  const assign = async (to: string | null, label: string) => {
    setOpen(false);
    setBusy(true);
    try {
      const r = await execute(client, "issue.assign", { key: testKey, to });
      toast({
        tone: "success",
        title: r.assignee ? `${testKey} is assigned to ${r.assignee.name}` : `${testKey} is unassigned`,
        detail: r.local ? undefined : "Pull the test to see it here.",
      });
    } catch (e) {
      errorToast(e, `Could not assign ${testKey} to ${label}`);
    } finally {
      setBusy(false);
      setQuery("");
    }
  };

  type Row = { key: string; person: Person | null; label: string };
  const rows: Row[] = [];
  if (me && me.accountId !== id && !query.trim())
    rows.push({ key: `me:${me.accountId}`, person: me, label: "Assign to me" });
  if (id && !query.trim()) rows.push({ key: "nobody", person: null, label: "Unassigned" });
  for (const p of q.data?.people ?? [])
    rows.push({ key: p.accountId, person: p, label: p.accountId === me?.accountId ? `${p.name} · you` : p.name });

  return (
    <span {...stylex.props(styles.who)}>
      <Avatar name={name} id={id} />
      <Popover
        title={`Assign ${testKey}`}
        width="sm"
        align="end"
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQuery("");
        }}
        trigger={
          <Button
            size="sm"
            variant="quiet"
            iconAfter="chevron-down"
            label={busy ? "Assigning…" : name || "Unassigned"}
            loading={busy}
            disabled={readOnly || undefined}
            data-testid="jira-assignee"
          />
        }
        foot={NOW}
      >
        <div {...stylex.props(styles.pick)}>
          <Text
            type="search"
            icon="search"
            ariaLabel="Search people"
            placeholder="Search people…"
            value={query}
            autoFocus
            onChange={setQuery}
          />
          {q.isError ? (
            <p {...stylex.props(type.small, styles.note)}>{message(q.error)}</p>
          ) : (
            <List
              label="People"
              items={rows}
              getKey={(r) => r.key}
              selected={rows.find((r) => r.person?.accountId === id && !r.key.startsWith("me:"))?.key ?? null}
              loading={!q.data && q.isFetching ? 3 : false}
              empty={<p {...stylex.props(type.small, styles.note)}>Nobody of that name can be assigned.</p>}
              renderItem={(r) => ({
                title: r.label,
                lead: <Avatar size="sm" name={r.person?.name} id={r.person?.accountId} />,
              })}
              onSelect={(k) => {
                const r = rows.find((x) => x.key === k);
                if (r) void assign(r.person?.accountId ?? null, r.person?.name ?? "nobody");
              }}
            />
          )}
        </div>
      </Popover>
    </span>
  );
}
