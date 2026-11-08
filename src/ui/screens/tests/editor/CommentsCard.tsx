import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { useClaudeJob } from "../../../components/claude/useClaudeJob.ts";
import { Avatar } from "../../../components/ui/Avatar.tsx";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Chip } from "../../../components/ui/Chip.tsx";
import { ClaudeBlock } from "../../../components/ui/ClaudeBlock.tsx";
import { List, optionId } from "../../../components/ui/List.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Popover } from "../../../components/ui/Popover.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { type } from "../../../components/ui/type.ts";
import { execute, invalidate, useRead } from "../../../lib/data/query.ts";
import { message, relTime } from "../../../lib/format.ts";
import { forComposer, forJira, pieces, putMention, typingMention, type Who } from "../../../lib/mentions.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { border, color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  item: { display: "flex", gap: space.s4, paddingBlock: space.s4 },
  divided: { borderTopStyle: "solid", borderTopWidth: border.width, borderTopColor: color.border },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  who: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  name: { color: color.text },
  when: { color: color.textSubtle },
  grow: { flex: 1 },
  body: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: color.text },
  composer: { display: "flex", flexDirection: "column", gap: space.s3, paddingTop: space.s4 },
  foot: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  note: { margin: 0, color: color.textSubtle },
  drafting: { color: color.claudeText },
  row: { display: "flex", justifyContent: "flex-end", gap: space.s2 },
});

type Comment = CommandOutput<"issue.comments">["comments"][number];

const QUICK = [
  { label: "Answer the last comment", prompt: "Answer the last comment that waits for an answer." },
  { label: "Say what changed in the test", prompt: "Say what changed in the test since the last comment." },
  { label: "Ask for the source", prompt: "Ask where the documents say what the last comment claims." },
];

function Body({ text }: { text: string }) {
  return (
    <p {...stylex.props(type.body, styles.body)}>
      {pieces(text).map((p, i) =>
        "id" in p ? <Chip key={i} label={`@${p.name}`} inField /> : <span key={i}>{p.text}</span>,
      )}
    </p>
  );
}

// ponytail: the comments of the test's Jira issue under its steps — read from Jira, written to Jira at once as the
// connected account (issue.comment*); Claude may draft one (claude.draftComment), the person sends it
export function CommentsCard({
  testKey,
  readOnly,
  onOpenInJira,
}: {
  testKey: string;
  readOnly?: boolean;
  onOpenInJira: () => void;
}) {
  const client = useQueryClient();
  const q = useRead("issue.comments", { key: testKey });
  const list = q.data?.comments ?? [];
  const [editing, setEditing] = useState<{ id: string; text: string; who: Who } | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const refresh = () => invalidate(client, [["issue.comments", { key: testKey }]]);

  const save = async (c: Comment) => {
    if (!editing) return;
    try {
      await execute(
        client,
        "issue.editComment",
        { key: testKey, id: c.id, text: forJira(editing.text, editing.who) },
        { invalidates: [["issue.comments", { key: testKey }]] },
      );
      setEditing(null);
    } catch (e) {
      errorToast(e, "Jira did not take the change");
    }
  };

  return (
    <section aria-label="Comments in Jira" id="jira-comments" data-testid="comments-card">
      <Card
        title={
          <>
            Comments
            {list.length > 0 && <Badge label={String(list.length)} count size="sm" />}
          </>
        }
        actions={
          <>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="refresh"
              label="Read the comments again"
              loading={q.isFetching}
              onClick={() => void refresh()}
            />
            <Button variant="quiet" size="sm" icon="external" label="Open in Jira" onClick={onOpenInJira} />
          </>
        }
      >
        {q.isError ? (
          <Banner
            tone="warning"
            compact
            actions={<Button size="sm" label="Try again" onClick={() => void refresh()} />}
          >
            {message(q.error)}
          </Banner>
        ) : !q.data ? (
          <>
            <Skeleton lines={3} />
            <Loading read="issue.comments" />
          </>
        ) : (
          list.length > 0 && (
            <ol {...stylex.props(styles.list)}>
              {list.map((c, i) => (
                <li key={c.id} {...stylex.props(styles.item, i > 0 && styles.divided)}>
                  <Avatar name={c.author?.name ?? "?"} id={c.author?.accountId} />
                  <div {...stylex.props(styles.main)}>
                    <div {...stylex.props(styles.who)}>
                      <span {...stylex.props(type.compact, type.strong, styles.name)}>
                        {c.author?.name ?? "Someone"}
                      </span>
                      {c.mine && <Badge label="you" size="sm" />}
                      <span {...stylex.props(type.small, styles.when)} title={c.created}>
                        {relTime(Date.parse(c.created))}
                        {c.updated && c.updated !== c.created ? " · edited" : ""}
                      </span>
                      <span {...stylex.props(styles.grow)} />
                      {c.mine && !readOnly && editing?.id !== c.id && (
                        <>
                          <Button
                            variant="quiet"
                            size="xs"
                            label="Edit"
                            onClick={() => setEditing({ id: c.id, ...forComposer(c.body) })}
                          />
                          <Button variant="quiet" size="xs" label="Delete" onClick={() => setDeleting(c)} />
                        </>
                      )}
                    </div>
                    {editing?.id === c.id ? (
                      <>
                        <Text
                          multiline
                          ariaLabel="Edit your comment"
                          value={editing.text}
                          autoFocus
                          onChange={(text) => setEditing({ ...editing, text })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              void save(c);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                        <div {...stylex.props(styles.row)}>
                          <Button variant="quiet" size="sm" label="Cancel" onClick={() => setEditing(null)} />
                          <Button
                            variant="primary"
                            size="sm"
                            label="Save"
                            disabled={!editing.text.trim()}
                            onClick={() => void save(c)}
                          />
                        </div>
                      </>
                    ) : (
                      <Body text={c.body} />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )
        )}
        {!readOnly && <Composer testKey={testKey} first={!!q.data && list.length === 0} />}
      </Card>
      {deleting && (
        <Modal
          title="Delete this comment?"
          size="sm"
          confirm={{
            verb: "Delete",
            danger: true,
            onConfirm: async () => {
              const c = deleting;
              setDeleting(null);
              try {
                await execute(
                  client,
                  "issue.deleteComment",
                  { key: testKey, id: c.id },
                  { invalidates: [["issue.comments", { key: testKey }]] },
                );
              } catch (e) {
                errorToast(e, "Jira did not delete the comment");
              }
            },
          }}
          consequences={[[1, `comment leaves ${testKey} — Jira keeps no copy`]]}
          onClose={() => setDeleting(null)}
        >
          <Body text={deleting.body} />
        </Modal>
      )}
    </section>
  );
}

function Composer({ testKey, first }: { testKey: string; first: boolean }) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [who, setWho] = useState<Who>(new Map());
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [closedAt, setClosedAt] = useState(-1);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const job = useClaudeJob();

  const at = typingMention(text, caret);
  const mentioning = at && at.start !== closedAt ? at : null;
  const peopleQ = useRead(
    "issue.people",
    { key: testKey, query: mentioning?.query.trim() ?? "" },
    { enabled: !!mentioning, keepPrevious: true },
  );
  const people = mentioning ? (peopleQ.data?.people ?? []) : [];
  const activeKey = people.some((p) => p.accountId === active) ? active : (people[0]?.accountId ?? null);

  const change = (v: string) => {
    setText(v);
    setRefused(null);
    setCaret(field.current?.selectionStart ?? v.length);
  };

  const mention = (accountId: string) => {
    const p = people.find((x) => x.accountId === accountId);
    if (!p || !mentioning) return;
    const next = putMention(text, mentioning, p.name);
    setWho(new Map(who).set(p.name, p.accountId));
    setText(next);
    setCaret(mentioning.start + p.name.length + 2);
    // ponytail: the name put in still reads as a mention being typed — that @ is done, its list stays shut
    setClosedAt(mentioning.start);
    setActive(null);
    field.current?.focus();
  };

  const send = async () => {
    const body = forJira(text.trim(), who);
    if (!body || sending) return;
    setSending(true);
    setRefused(null);
    try {
      const r = await execute(
        client,
        "issue.comment",
        { key: testKey, text: body },
        { invalidates: [["issue.comments", { key: testKey }]] },
      );
      setText("");
      setWho(new Map());
      setDrafted(null);
      if (r.mentions.length)
        toast({
          tone: "success",
          title: "Comment posted",
          detail: `Jira tells ${r.mentions.map((m) => m.name).join(", ")}.`,
        });
    } catch (e) {
      setRefused(message(e));
    } finally {
      setSending(false);
    }
  };

  const draft = async (prompt: string) => {
    setAsking(false);
    setDrafting(true);
    try {
      const r = await job.start<CommandOutput<"claude.draftComment">>(
        "claude.draftComment",
        { key: testKey, ask: prompt },
        () => {},
      );
      if (!r.ok) {
        errorToast(new Error(r.text), "Claude could not draft the comment");
        return;
      }
      const shown = forComposer(r.text, who);
      setText(shown.text);
      setWho(shown.who);
      setDrafted(shown.text);
      setCaret(shown.text.length);
    } catch (e) {
      if (!(e as { cancelled?: boolean }).cancelled) errorToast(e, "Claude could not draft the comment");
    } finally {
      setDrafting(false);
    }
  };

  const stop = () => {
    if (job.jobId) void execute(client, "jobs.cancel", { id: job.jobId }, { invalidates: "none" });
  };

  const listId = `mention-${testKey}`;
  const isDraft = drafted !== null && drafted === text && !!text;
  return (
    <div {...stylex.props(styles.composer)}>
      {refused && (
        <Banner
          tone="danger"
          compact
          title="Jira refused the comment"
          actions={<Button size="sm" label="Try again" onClick={() => void send()} />}
        >
          {refused} Nothing was posted; your text is still here.
        </Banner>
      )}
      <Text
        multiline
        ariaLabel={`Comment on ${testKey}`}
        placeholder={
          first
            ? `Start the conversation on ${testKey}… @ mentions someone`
            : `Comment on ${testKey}… @ mentions someone`
        }
        value={text}
        readOnly={drafting || sending}
        inputRef={(el) => {
          field.current = el;
        }}
        combobox={
          mentioning
            ? {
                expanded: people.length > 0,
                controls: listId,
                activeDescendant: activeKey ? optionId(listId, activeKey) : undefined,
                autocomplete: "list",
              }
            : undefined
        }
        onChange={change}
        onKeyDown={(e) => {
          if (mentioning && people.length) {
            const i = people.findIndex((p) => p.accountId === activeKey);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = (i + (e.key === "ArrowDown" ? 1 : -1) + people.length) % people.length;
              return setActive(people[n].accountId);
            }
            if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
              e.preventDefault();
              if (activeKey) mention(activeKey);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              return setClosedAt(mentioning.start);
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {mentioning && people.length > 0 && (
        <List
          label="Mention someone"
          items={people}
          getKey={(p) => p.accountId}
          selected={activeKey}
          activeDescendant={{ id: listId, onActive: setActive }}
          renderItem={(p) => ({ title: p.name, lead: <Avatar size="sm" name={p.name} id={p.accountId} /> })}
          onSelect={mention}
        />
      )}
      <div {...stylex.props(styles.foot)}>
        {drafting ? (
          <>
            <span {...stylex.props(type.small, styles.drafting)}>Claude is drafting…</span>
            <Button variant="quiet" size="sm" icon="stop" label="Stop" onClick={stop} />
          </>
        ) : (
          <>
            {isDraft && <Badge label="Drafted by Claude" tone="claude" icon="claude" />}
            <Popover
              title={`Draft a comment on ${testKey}`}
              icon="claude"
              width="md"
              flush
              align="start"
              open={asking}
              onOpenChange={setAsking}
              trigger={
                <Button
                  variant="claude-quiet"
                  size="sm"
                  icon="claude"
                  label={isDraft ? "Draft again" : "Draft with Claude"}
                />
              }
              foot="Claude reads the test, this thread and the documents. It writes here only — you send."
            >
              <ClaudeBlock
                ariaLabel="What should the comment say"
                value={ask}
                placeholder="What should the comment say? (empty: answer the thread)"
                quickAsks={QUICK}
                submit="enter"
                submitLabel="Draft"
                allowEmpty
                frameless
                onChange={setAsk}
                onSubmit={(prompt) => void draft(prompt)}
              />
            </Popover>
          </>
        )}
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(type.small, styles.note)}>Posted to Jira as you · Ctrl+Enter</span>
        {text && !drafting && (
          <Button
            variant="quiet"
            size="sm"
            label="Discard"
            onClick={() => {
              setText("");
              setDrafted(null);
              setRefused(null);
            }}
          />
        )}
        <Button
          variant="primary"
          size="sm"
          icon="send"
          label="Comment"
          loading={sending}
          disabled={!text.trim() || drafting}
          onClick={() => void send()}
        />
      </div>
    </div>
  );
}
