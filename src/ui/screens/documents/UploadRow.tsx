import { ProblemPanel } from "../../components/shell/ProblemPanel.tsx";
import { Icon, IconButton, Severity } from "../../components/ui/index.ts";
import { cx } from "../../lib/format.ts";
import { dismissUpload, type Upload } from "../../lib/uploads.ts";

type Step = { label: string; state: "done" | "now" | "todo" | "failed" };

function stepsOf(u: Upload): Step[] {
  const whole = !u.docId && (u.phase === "indexing" || u.phase === "done");
  const at = u.phase === "done" ? 2 : u.phase === "indexing" ? 1 : 0;
  const steps: Step[] = [
    { label: "Converting", state: u.phase === "failed" ? "failed" : at > 0 ? "done" : "now" },
    { label: "Indexing", state: at > 1 ? "done" : at === 1 ? "now" : "todo" },
  ];
  return whole ? steps.slice(1) : steps;
}

const MARK = { done: "check", failed: "error" } as const;

export function UploadRow({ u, on, onOpen }: { u: Upload; on?: boolean; onOpen?: () => void }) {
  const steps = stepsOf(u);
  const now = steps.find((s) => s.state === "now");
  const busy = !!now;
  const msg = u.message === now?.label ? "" : u.message;
  return (
    <tr
      className={cx("up-row", onOpen && "is-open", on && "row-on")}
      aria-selected={onOpen ? !!on : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
    >
      <td colSpan={5}>
        <div className="up">
          <div className={cx("up-line", u.phase === "failed" && "has-act")}>
            <div className="up-name" title={u.name}>
              <span className={cx("up-tile", u.phase === "failed" && "is-failed")}>
                <Icon name="documents" />
              </span>
              <div className="up-name-text">
                <div className="mono muted tbl-sub">
                  {u.docId ?? (steps.length === 1 ? "Search index" : "New document")}
                </div>
                <div className="tbl-title">{u.name}</div>
              </div>
            </div>
            <div className="up-track">
              <div className="up-head">
                <ol className="up-steps" aria-label="Steps">
                  {steps.map((s) => (
                    <li
                      key={s.label}
                      className={`up-step is-${s.state}`}
                      aria-current={s.state === "now" ? "step" : undefined}
                    >
                      <span className="up-mark">
                        {s.state === "done" || s.state === "failed" ? <Icon name={MARK[s.state]} size={12} /> : null}
                      </span>
                      {s.label}
                    </li>
                  ))}
                </ol>
                {u.phase === "done" ? (
                  <span className="up-msg">
                    <Severity tone="ok">{u.message === "Indexed" ? "Added and indexed" : u.message}</Severity>
                  </span>
                ) : u.phase === "failed" ? (
                  <span className="up-msg s-err">Not added</span>
                ) : (
                  <span className="up-msg muted" title={msg}>
                    {msg}
                  </span>
                )}
                {busy && u.pct !== null && <span className="up-pct">{u.pct}%</span>}
              </div>
              {u.phase !== "failed" && (
                <div
                  className={cx("prog up-bar", u.phase === "done" && "is-done")}
                  role="progressbar"
                  aria-label={now?.label ?? "Added"}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={busy ? (u.pct ?? undefined) : 100}
                >
                  <span
                    style={{ width: `${busy ? (u.pct ?? 35) : 100}%` }}
                    className={busy && u.pct === null ? "prog-busy" : undefined}
                  />
                </div>
              )}
            </div>
            {u.phase === "failed" && (
              <IconButton
                icon="close"
                className="up-act"
                label={`Dismiss ${u.name}`}
                onClick={() => dismissUpload(u.key)}
              />
            )}
          </div>
          {u.phase === "failed" && (
            <ProblemPanel
              error={u.error ?? new Error(u.message)}
              doing={`Adding ${u.name}`}
              untouched="Nothing else changed in the project."
            />
          )}
        </div>
      </td>
    </tr>
  );
}
