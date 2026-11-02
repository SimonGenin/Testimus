import { useEffect, useState } from "react";
import { project as apiProject, call } from "../../api.ts";
import { errorToast } from "../../lib/toast.ts";
import { Button } from "../ui/index.ts";

type Listed = { id: string; name: string };
type Projects = { projects: { dir: string; name: string; exists: boolean }[] };

// ponytail: contexts live in each project folder; this brings one over from another project in two picks
export function CopyContext({ onCopied }: { onCopied: (id: string) => void }) {
  const here = apiProject() ?? "";
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Projects["projects"]>([]);
  const [from, setFrom] = useState("");
  const [theirs, setTheirs] = useState<Listed[] | null>(null);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (!open) return;
    call<Projects>("project.list", {})
      .then((r) => setProjects((r?.projects ?? []).filter((p) => p.exists && p.dir !== here)))
      .catch((e) => errorToast(e, "Could not list the projects"));
  }, [open, here]);

  useEffect(() => {
    setTheirs(null);
    setPick("");
    if (!from) return;
    call<Listed[]>("contexts.list", { from })
      .then((l) => {
        setTheirs(l ?? []);
        setPick(l?.[0]?.id ?? "");
      })
      .catch((e) => errorToast(e, "Could not list that project's contexts"));
  }, [from]);

  if (!open)
    return (
      <Button size="sm" tone="quiet" onClick={() => setOpen(true)}>
        Copy from another project…
      </Button>
    );

  const copy = () =>
    call<{ id: string }>("contexts.copy", { from, id: pick })
      .then((c) => {
        setOpen(false);
        setFrom("");
        onCopied(c.id);
      })
      .catch((e) => errorToast(e, "Could not copy the context"));

  return (
    <fieldset className="ctxcopy">
      <legend className="label">Copy from another project</legend>
      {projects.length ? (
        <select
          className="field"
          aria-label="Project to copy from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          <option value="">Choose a project…</option>
          {projects.map((p) => (
            <option key={p.dir} value={p.dir} title={p.dir}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted">No other project opened yet</span>
      )}
      {theirs &&
        (theirs.length ? (
          <select className="field" aria-label="Context to copy" value={pick} onChange={(e) => setPick(e.target.value)}>
            {theirs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">That project has no context</span>
        ))}
      <span className="ctxcopy-acts">
        <Button size="sm" tone="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!from || !pick} onClick={() => void copy()}>
          Copy
        </Button>
      </span>
    </fieldset>
  );
}
