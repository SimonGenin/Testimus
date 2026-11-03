import { useState } from "react";
import { call } from "../../../api.ts";
import { Button } from "../../../components/ui/index.ts";
import { useDraft } from "../../../lib/drafts.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { folderPicker } from "./data.ts";

export function AddFolder({ onAdded }: { onAdded: () => void }) {
  const [path, setPath] = useDraft("settings.models.folder", "");
  const [copy, setCopy] = useDraft("settings.models.copy", false);
  const [busy, setBusy] = useState(false);
  const pick = folderPicker();
  const add = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      const r = await call<{ model: string; path: string; dims: number }>("models.add", { path: path.trim(), copy });
      toast({ kind: "ok", title: `${r.model} added`, detail: `${r.path} · ${r.dims} dimensions` });
      setPath("");
      onAdded();
    } catch (e) {
      errorToast(e, "This folder could not be added");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="addfolder">
      <label className="label" htmlFor="models-add">
        Add from a folder…
      </label>
      <p className="muted">
        A model already on disk (a team share, a manual download): a Hugging Face folder, a .gguf file or a llama.cpp
        folder. It is checked with one sentence and used in place.
      </p>
      <div className="dirpick">
        <input
          id="models-add"
          className="field mono"
          value={path}
          placeholder="\\share\models\bge-m3 or D:\models\Qwen3-Embedding-4B-Q8_0.gguf"
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        {pick && (
          <Button
            onClick={() => void pick({ title: "Model folder" }).then((p) => p && setPath(p))}
            aria-label="Browse for a model folder"
          >
            Browse…
          </Button>
        )}
        <Button disabled={!path.trim() || busy} onClick={() => void add()}>
          {busy ? "Checking…" : "Add"}
        </Button>
      </div>
      <label className="addfolder-copy">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Copy it into my models
        folder (a share may be slow or read-only)
      </label>
    </div>
  );
}
