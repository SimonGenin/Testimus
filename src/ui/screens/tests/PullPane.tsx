import { useEffect, useState } from "react";
import { Badge, Button, Icon, type IconName, Skeleton } from "../../components/ui/index.ts";
import { cx, plural } from "../../lib/format.ts";
import type { Pull, PullRead } from "./pulls.ts";

type RowState = "done" | "active" | "pending" | "skip";

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useElapsed(from: number | undefined, running: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || from === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from, running]);
  return from === undefined ? null : elapsed(now - from);
}

// ponytail: the stage the pull is in — after the read it goes to the images, or straight to the write when Jira
// holds none; a pull still queued behind the others has not reached any
function stageOf(pull: Pull, queued: boolean): number {
  if (queued) return -1;
  if (pull.phase === "write") return 3;
  if (pull.phase === "images") return pull.images && pull.images.done < pull.images.total ? 2 : 3;
  if (pull.phase === "read") return pull.read?.images ? 2 : 3;
  return 0;
}

function Phase({ state, label, detail, bar }: { state: RowState; label: string; detail?: string; bar?: number }) {
  return (
    <li className={cx("pullpane-phase", `is-${state}`)}>
      <span className="pullpane-mark" aria-hidden="true">
        {state === "active" && <span className="spin spin-sm" />}
        {(state === "done" || state === "skip") && <Icon name="check" size={12} />}
      </span>
      <span className="pullpane-label">{label}</span>
      {detail && <span className="pullpane-detail mono">{detail}</span>}
      {bar !== undefined && (
        <span className="prog pullpane-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(bar * 100)}%` }} />
        </span>
      )}
    </li>
  );
}

function Fact({ icon, n, word }: { icon: IconName; n: number; word: string }) {
  return (
    <span className={cx("pullpane-fact", n === 0 && "is-zero")}>
      <Icon name={icon} size={13} />
      <span className="mono">{n}</span> {word}
      {n === 1 ? "" : "s"}
    </span>
  );
}

function TestCard({ read, summary }: { read?: PullRead; summary: string }) {
  if (!read)
    return (
      <div className="pullpane-card" aria-hidden="true">
        {summary ? <p className="pullpane-summary">{summary}</p> : <Skeleton w="70%" h={14} />}
        <Skeleton w="45%" h={10} />
        <div className="pullpane-facts">
          <Skeleton w={64} h={18} r={9} />
          <Skeleton w={64} h={18} r={9} />
          <Skeleton w={88} h={18} r={9} />
        </div>
      </div>
    );
  return (
    <div className="pullpane-card is-read">
      <p className="pullpane-summary">{read.summary || summary}</p>
      <div className="pullpane-where">
        <span className="pullpane-folder">
          <Icon name="folder" size={13} />
          <span className="mono">{read.folder || "/"}</span>
        </span>
        {read.status && (
          <Badge tone="info" small>
            {read.status}
          </Badge>
        )}
      </div>
      <div className="pullpane-facts">
        <Fact icon="tests" n={read.steps} word="step" />
        <Fact icon="image" n={read.images} word="image" />
        <Fact icon="lock" n={read.preconditions} word="precondition" />
        <Fact icon="link" n={read.covers} word="requirement" />
        <Fact icon="tag" n={read.labels} word="label" />
      </div>
    </div>
  );
}

export function PullPane({
  pull,
  others,
  onCancel,
  onRetry,
  onBack,
}: {
  pull: Pull;
  others: Pull[];
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const time = useElapsed(pull.startedAt, !pull.error);
  if (pull.error)
    return (
      <div className="editor-empty pullpane">
        <Badge tone="err" icon="error">
          Pull failed
        </Badge>
        <h2 className="h">
          Could not pull <span className="mono">{pull.key}</span>
        </h2>
        <p className="pullpane-error">{pull.error}</p>
        <div className="pullpane-row">
          <Button tone="primary" onClick={onRetry}>
            Retry
          </Button>
          <Button onClick={onBack}>Back</Button>
        </div>
      </div>
    );
  // ponytail: a pull that has not reported yet is either still reaching Jira or queued behind the
  // others the core is already working on
  const queued = !pull.message && others.some((p) => p.message);
  const line = pull.message ?? (queued ? "waiting for a free slot…" : "contacting Jira…");
  const stage = stageOf(pull, queued);
  const state = (i: number): RowState => (i < stage ? "done" : i === stage ? "active" : "pending");
  const read = pull.read;
  const imgs = pull.images ?? (read ? { done: 0, total: read.images } : undefined);
  return (
    <div className="editor-empty pullpane" aria-busy="true">
      <div className="pullpane-panel">
        <div className="pullpane-head">
          <span className={cx("pullpane-badge", queued && "is-queued")} aria-hidden="true">
            <Icon name="pull" size={18} />
          </span>
          <div className="pullpane-title">
            <span className="pullpane-eyebrow">{queued ? "Queued" : "From Jira"}</span>
            <h2 className="h">
              Pulling <span className="mono">{pull.key}</span>
            </h2>
          </div>
          {time && <span className="pullpane-time mono">{time}</span>}
        </div>
        <TestCard read={read} summary={pull.summary} />
        <ol className="pullpane-phases">
          <Phase state={state(0)} label={stage > 0 ? "Jira reached" : "Reach Jira"} />
          <Phase
            state={state(1)}
            label={stage > 1 ? "Test read" : "Read the test"}
            detail={read ? plural(read.steps, "step") : undefined}
          />
          <Phase
            state={read && !read.images ? "skip" : state(2)}
            label={read && !read.images ? "No images" : "Download the images"}
            detail={imgs?.total ? `${imgs.done} / ${imgs.total}` : undefined}
            bar={imgs?.total ? imgs.done / imgs.total : undefined}
          />
          <Phase state={state(3)} label="Write test.md" />
        </ol>
        <div className="pullpane-progress mono" role="status">
          {line}
        </div>
        <div className="pullpane-foot">
          <Button onClick={onCancel}>Cancel</Button>
          {others.length > 0 && (
            <span className="muted pullpane-hint">{others.length} more pulling in the background</span>
          )}
        </div>
      </div>
    </div>
  );
}
