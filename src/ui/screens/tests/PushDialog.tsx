import { useEffect, useState } from "react";
import type { JobEvent, PlanOp, PushOpResult, PushPlanView, Review } from "../../../core/types.ts";
import { ApiError, call, run } from "../../api.ts";
import { Button, Icon, type IconName, Modal, REVIEW, Skeleton } from "../../components/ui/index.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";

type PushResult = {
  ok: boolean;
  id: string;
  plan?: PushPlanView;
  ops: PushOpResult[];
  failedAt?: number;
  error?: string;
};

const OP_ICON: Record<PlanOp["kind"], IconName> = {
  create: "plus",
  update: "edit",
  upload: "image",
  embed: "image",
  label: "tag",
  link: "link",
  folder: "folder",
  other: "right",
};

type Phase = "loading" | "plan" | "running" | "failed" | "error";

type Plan = PushPlanView & { planHash?: string };

export function PushDialog({
  testId,
  testKey,
  summary,
  review,
  onDone,
  onClose,
  onCompare,
}: {
  testId: string;
  testKey?: string;
  summary: string;
  review?: Review;
  onDone: (id: string) => void;
  onClose: () => void;
  onCompare?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [replace, setReplace] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<PushResult | null>(null);
  const [failure, setFailure] = useState<{ message: string; fix?: string } | null>(null);
  const [from, setFrom] = useState(0);

  useEffect(() => {
    let dead = false;
    call<Plan>("xray.plan", { id: testId })
      .then((p) => {
        if (dead) return;
        setPlan(p);
        setPhase("plan");
      })
      .catch((e) => {
        if (dead) return;
        setFailure({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined });
        setPhase("error");
      });
    return () => {
      dead = true;
    };
  }, [testId]);

  const push = async (start: number) => {
    setPhase("running");
    setFrom(start);
    setDone(start);
    setFailure(null);
    const onEvent = (e: JobEvent) => {
      if (e.type === "progress" && e.done !== undefined) setDone(e.done);
    };
    try {
      const r = await run<PushResult>(
        "xray.push",
        {
          id: testId,
          from: start || undefined,
          planHash: plan?.planHash,
          overwriteRemote: plan?.remoteChanged && replace ? true : undefined,
        },
        onEvent,
      );
      setResult(r);
      if (r.plan) setPlan((p) => ({ ...r.plan, planHash: (r.plan as Plan).planHash ?? p?.planHash }) as Plan);
      if (!r.ok) {
        setFailure({
          message: r.error ?? r.ops.find((o) => o.status === "failed")?.error ?? "Jira refused an operation.",
        });
        setPhase("failed");
        return;
      }
      toast({
        kind: "ok",
        title: `Pushed ${r.id || testKey || "the test"}`,
        detail: plural(r.ops.filter((o) => o.status === "done").length || (plan?.ops.length ?? 0), "operation"),
      });
      onDone(r.id || testId);
    } catch (e) {
      setFailure({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined });
      setPhase("failed");
    }
  };

  const name = testKey ?? "this test";
  const ops = plan?.ops ?? [];

  if (phase === "running" || phase === "failed") {
    const failedAt = result?.failedAt ?? (phase === "failed" ? done : -1);
    const state = (i: number): PushOpResult["status"] | "running" => {
      const r = result?.ops[i];
      if (r && (phase === "failed" || r.status !== "not-started")) return r.status;
      if (i < done) return "done";
      if (phase === "running" && i === done) return "running";
      if (phase === "failed" && i === failedAt) return "failed";
      return "not-started";
    };
    const counts = ops.reduce(
      (c, _, i) => {
        const s = state(i);
        if (s === "done") c.done++;
        else if (s === "failed") c.failed++;
        else c.left++;
        return c;
      },
      { done: 0, failed: 0, left: 0 },
    );
    return (
      <Modal
        label="Pushing to Jira"
        width={576}
        className="push"
        title={
          phase === "running" ? `Pushing ${name} to Jira` : `Push stopped at operation ${failedAt + 1} of ${ops.length}`
        }
        onClose={phase === "running" ? () => {} : onClose}
        foot={
          phase === "running" ? (
            <span className="muted">Operations run one after the other; a failure stops the push.</span>
          ) : (
            <>
              <div className="spacer" />
              <Button onClick={onClose}>Close</Button>
              <Button tone="primary" onClick={() => void push(Math.max(failedAt, 0))}>
                Resume from operation {failedAt + 1}
              </Button>
            </>
          )
        }
      >
        <div
          className="prog"
          role="progressbar"
          aria-valuenow={counts.done}
          aria-valuemin={0}
          aria-valuemax={ops.length}
          aria-label={`${counts.done} of ${ops.length} operations done`}
        >
          <span style={{ width: `${ops.length ? (counts.done / ops.length) * 100 : 0}%` }} />
        </div>
        <p className="muted push-counts">
          {counts.done} done{counts.failed ? ` · ${counts.failed} failed` : ""} · {counts.left} not started
          {from > 0 && phase === "running" ? ` · resumed at ${from + 1}` : ""}
        </p>
        <div className="ops">
          {ops.map((op, i) => {
            const s = state(i);
            return (
              <div key={i} className={cx("op", s === "failed" && "op-failed")}>
                {s === "done" ? (
                  <Icon name="check" className="op-ok" />
                ) : s === "failed" ? (
                  <Icon name="error" className="op-err" />
                ) : s === "running" ? (
                  <span className="dot op-dot" />
                ) : (
                  <Icon name="draft" className="op-wait" />
                )}
                <div className="op-body">
                  <span className={cx(s === "failed" && "op-title", s === "not-started" && "muted")}>{op.label}</span>
                  {s === "failed" && failure && (
                    <>
                      <p>{failure.message}</p>
                      <p>
                        <strong>What to do:</strong>{" "}
                        {failure.fix ?? "fix what Jira refused, then resume. What is already in Jira stays there."}
                      </p>
                    </>
                  )}
                </div>
                <span className={cx("st", `st-${s}`)}>
                  {s === "done" ? "Done" : s === "failed" ? "Failed" : s === "running" ? "Running" : "Not started"}
                </span>
              </div>
            );
          })}
        </div>
      </Modal>
    );
  }

  const reviewState: Review = review ?? plan?.review ?? "validated";
  const notValidated = reviewState !== "validated";
  const warnings = (plan?.warnings ?? []).filter((w) => !(notValidated && /validat/i.test(w)));
  return (
    <Modal
      label="Push plan"
      width={576}
      className="push"
      title={
        <>
          Push <span className="mono push-key">{name}</span> to Jira
        </>
      }
      subtitle={summary}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">
            Same as <span className="mono">testimus xray push {testKey ?? testId}</span>
          </span>
          <div className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            icon="push"
            disabled={phase !== "plan" || !ops.length || (!!plan?.remoteChanged && !replace)}
            onClick={() => void push(0)}
          >
            Confirm push
          </Button>
        </>
      }
    >
      {phase === "loading" && (
        <div className="ops" role="status" aria-busy="true" aria-label="Building the push plan">
          {[70, 82, 64, 76].map((w) => (
            <div key={w} className="op">
              <Skeleton w={16} h={16} />
              <Skeleton w={`${w}%`} h={12} />
              <span />
            </div>
          ))}
        </div>
      )}
      {phase === "error" && failure && (
        <div className="find f-err" role="alert">
          <span className="sev s-err">
            <Icon name="error" />
            Could not build the push plan
          </span>
          <p>{failure.message}</p>
          {failure.fix && (
            <p>
              <strong>What to do:</strong> {failure.fix}
            </p>
          )}
        </div>
      )}
      {phase === "plan" && plan && (
        <>
          {notValidated && (
            <div className="find" role="note">
              <span className="sev s-warn">
                <Icon name="warning" />
                This test is {REVIEW[reviewState]?.label ?? reviewState}, not Validated
              </span>
              <p>
                It will reach Jira with its review state as a label. Validate it first if it should go out as reviewed.
              </p>
            </div>
          )}
          {plan.remoteChanged && (
            <div className="find" role="note">
              <span className="sev s-warn">
                <Icon name="changed" />
                Changed in Jira since your pull
              </span>
              <p>
                Someone changed this test in Jira after your pull. Compare first, or replace their change on purpose.
              </p>
              {onCompare && (
                <div>
                  <Button size="sm" onClick={onCompare}>
                    Compare with Jira
                  </Button>
                </div>
              )}
              <label className="push-replace">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Push anyway, replace their change
              </label>
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} className="find" role="note">
              <span className="sev s-warn">
                <Icon name="warning" />
                {w}
              </span>
            </div>
          ))}
          <span className="label push-what">What will happen · {plural(ops.length, "operation")}</span>
          {ops.length ? (
            <div className="ops">
              {ops.map((op, i) => (
                <div key={i} className="op">
                  <Icon name={OP_ICON[op.kind] ?? "right"} />
                  <span>{op.label}</span>
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing to push: Jira already has this version.</p>
          )}
        </>
      )}
    </Modal>
  );
}
