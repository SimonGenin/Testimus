import { existsSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { normalizeAnchor } from "../rag/anchors.ts";
import { figure as docFigure } from "../rag/search/passage.ts";
import { docDir, readFigures } from "./docs.ts";

// ponytail: a picture a step can show, by its anchor — a document figure (fig:<n>), a photo of an images document
// (img:<n>) or a key frame of a video (frame:<moment>) — and the file that holds it; one that has no file is refused

function mediaPicture(project: string, docId: string, anchor: string): { path: string; figure: string } {
  const a = normalizeAnchor(anchor);
  const e = readFigures(project, docId).find((f) => f.anchor === a);
  if (!e?.file)
    throw new UserError(`${docId} has no picture ${a}.`, `testimus media show ${docId} lists its pictures.`);
  const path = join(docDir(project, docId), e.file);
  if (!existsSync(path))
    throw new UserError(`The file of ${docId}#${a} is missing (${e.file}).`, "Convert the document again.");
  return { path, figure: `${docId}#${a}` };
}

export function pictureFile(project: string, ref: string): { path: string; figure: string } {
  const pic = /^([^#\s]+)#\s*((?:img|frame)\s*:\s*\S+)$/i.exec(ref.trim());
  if (pic) return mediaPicture(project, pic[1], pic[2]);
  const m = ref.trim().match(/^([^#\s]+)#\s*(?:fig[:\s]*)?(\S+)$/i);
  if (!m) throw new UserError(`"${ref}" is not a figure reference.`, "Write it docId#fig:40.");
  const f = docFigure(project, m[1], m[2]);
  if (!f.picture)
    throw new UserError(
      `${m[1]}#fig:${f.n} has no picture: the document writes it as text (a table, a caption).`,
      "Cite it in ### Sources; only a figure with a picture can be embedded.",
    );
  if (!f.exists)
    throw new UserError(`The file of ${m[1]}#fig:${f.n} is missing (${f.file}).`, "Convert the document again.");
  return { path: f.absPath, figure: `${m[1]}#fig:${f.n}` };
}
