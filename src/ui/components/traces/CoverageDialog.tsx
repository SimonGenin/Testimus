import { useEffect, useState } from "react";
import type { TraceCoverage, TraceUse } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { handOff } from "../../lib/traces.ts";
import { Button, Modal, Segmented, Skeleton } from "../ui/index.ts";

type Show = "missing" | "covered" | "unknown";

function Uses({ uses, open }: { uses: TraceUse[]; open: (test: string) => void }) {
  return (
    <span className="cov-uses">
      {uses.map((u) => (
        <button key={u.test} type="button" className="linkbtn" title={u.summary} onClick={() => open(u.test)}>
          {u.key ?? u.test}
          <span className="muted"> · step {u.steps.join(", ")}</span>
        </button>
      ))}
    </span>
  );
}

export function CoverageDialog({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const app = useApp();
  const [all, setAll] = useState<TraceCoverage[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(initial ?? "");
  const [show, setShow] = useState<Show>("missing");

  useEffect(() => {
    call<TraceCoverage[]>("traces.coverage", {})
      .then((r) => {
        setAll(r);
        setKind((k) => (r.some((c) => c.trace === k) ? k : (r[0]?.trace ?? "")));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const cov = all?.find((c) => c.trace === kind);
  const missing = cov?.items.filter((i) => !i.uses.length) ?? [];
  const covered = cov?.items.filter((i) => i.uses.length) ?? [];
  const open = (test: string) => {
    onClose();
    app.navigate("tests", test);
  };
  const generate = () => {
    if (!cov) return;
    handOff(
      cov.trace,
      missing.map((i) => i.id),
    );
    onClose();
    app.navigate("generate");
  };
  const pct = cov?.total ? Math.round((cov.covered / cov.total) * 100) : 0;

  return (
    <Modal
      label="Coverage of the tracked ids"
      title="Which ids do the tests cover?"
      subtitle="Every id the documents write, and the local tests whose steps cite it in their column."
      width={820}
      className="cov"
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>
          <Button tone="primary" icon="generate" disabled={!missing.length} onClick={generate}>
            {missing.length ? `Generate tests for the ${plural(missing.length, "missing id")}` : "Nothing missing"}
          </Button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      {!all && !error && <Skeleton h={120} />}
      {all && !all.length && <p className="muted">This project tracks no ids. « Track ids… » adds a kind.</p>}
      {all && all.length > 1 && (
        <Segmented
          label="Kind of id"
          value={kind}
          options={all.map((c) => ({ value: c.trace, label: c.label, count: `${c.covered}/${c.total}` }))}
          onChange={setKind}
        />
      )}
      {cov && (
        <>
          <div className="cov-head">
            <p className="cov-count">
              <strong>
                {cov.covered} of {plural(cov.total, `${cov.label} id`)}
              </strong>{" "}
              covered by {plural(cov.tests, "test")} (column « {cov.field} »)
            </p>
            <div className="cov-meter" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
          <Segmented
            label="Show"
            value={show}
            options={[
              { value: "missing", label: "Not covered", count: missing.length },
              { value: "covered", label: "Covered", count: covered.length },
              {
                value: "unknown",
                label: "Not in the documents",
                count: cov.unknown.length,
                title: "Values in the column that no document writes: a typo, or an id renamed or removed",
              },
            ]}
            onChange={setShow}
          />
          {show !== "unknown" && (
            <ul className="cov-list" aria-label={show === "missing" ? "Ids not covered" : "Ids covered"}>
              {(show === "missing" ? missing : covered).map((i) => (
                <li key={i.id}>
                  <span className="mono cov-id">{i.id}</span>
                  <span className="muted mono cov-where">{i.doc ? `${i.doc} ${i.anchor}` : "requirements.csv"}</span>
                  {i.context && <span className="cov-ctx">{i.context}</span>}
                  {i.uses.length > 0 && <Uses uses={i.uses} open={open} />}
                </li>
              ))}
              {(show === "missing" ? missing : covered).length === 0 && (
                <li className="muted">{show === "missing" ? "Every id is covered." : "No id is covered yet."}</li>
              )}
            </ul>
          )}
          {show === "unknown" && (
            <ul className="cov-list" aria-label="Ids not in the documents">
              {cov.unknown.map((u) => (
                <li key={u.id}>
                  <span className="mono cov-id">{u.id}</span>
                  <Uses uses={u.uses} open={open} />
                </li>
              ))}
              {cov.unknown.length === 0 && (
                <li className="muted">Every value in the column is an id of the documents.</li>
              )}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
