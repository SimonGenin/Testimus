import { project, run } from "./data/client.ts";
import { toast } from "./toast.ts";
import { importClaude, type Picked, sameProject, sourceOf, tracked } from "./uploads.ts";

type MediaJob = { added: number[]; rejected: { name: string; why: string }[] };

// ponytail: images or videos added to an images or video document — one job copies, prepares, has Claude read the new
// pictures and updates the index; its row is the document's conversion row
export async function addMedia(docId: string, name: string, picked: Picked[], onDone: () => void): Promise<void> {
  const p = project();
  const files = await Promise.all(picked.map(sourceOf));
  if (!files.length) return;
  const r = await tracked(
    { name, job: "convert", docId, phase: "converting", message: "Adding the files" },
    (onStart) => run<MediaJob>("media.add", { doc: docId, files, ...importClaude(), index: true }, undefined, onStart),
  );
  if (r.ok && r.value.rejected.length)
    toast({
      tone: "danger",
      title: r.value.added.length ? "Some files were not added" : "No file was added",
      detail: r.value.rejected.map((x) => `${x.name}: ${x.why}`).join("\n"),
    });
  sameProject(p, onDone);
}

// ponytail: one image or video out of its document — its picture, transcript and key frames go, the tests citing the
// document are checked again and the index follows
export async function removeMedia(docId: string, name: string, n: number, onDone: () => void): Promise<void> {
  const p = project();
  await tracked({ name, job: "convert", docId, phase: "converting", message: "Removing the file" }, (onStart) =>
    run("media.remove", { doc: docId, n, index: true }, undefined, onStart),
  );
  sameProject(p, onDone);
}
