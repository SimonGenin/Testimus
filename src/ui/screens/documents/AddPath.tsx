import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { baseName, desktop, examplePath, pickFiles } from "../../lib/desktop.ts";

const FILTERS = [{ name: "Word or PDF", extensions: ["docx", "pdf"] }];
const PDF = [{ name: "PDF", extensions: ["pdf"] }];

const unquote = (p: string) => p.trim().replace(/^"|"$/g, "");
const stem = (p: string) =>
  baseName(p)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();

// ponytail: the core pairs a .docx with the .pdf of the same name (docs.addFiles), so a rendering under another name
// would be added as a document of its own: it is refused here, with the name it needs
function pdfProblem(main: string, pdf: string): string | undefined {
  if (!pdf) return undefined;
  if (!/\.pdf$/i.test(pdf)) return "A PDF rendering ends in .pdf";
  if (!/\.docx$/i.test(main)) return "Only a .docx has a PDF rendering";
  if (stem(pdf) !== stem(main)) return `Name it like the .docx: ${baseName(main).replace(/\.docx$/i, ".pdf")}`;
  return undefined;
}

function Browse({ title, filters, onPick }: { title: string; filters: typeof FILTERS; onPick: (p: string) => void }) {
  if (!desktop()) return null;
  return (
    <Button
      size="sm"
      variant="quiet"
      label="Browse…"
      onClick={() => void pickFiles(title, filters, false).then(([picked]) => picked && onPick(picked))}
    />
  );
}

// ponytail: a path typed or pasted (quotes from « Copy as path » dropped), and the PDF rendering that lends its
// pictures to the .docx; Browse… is the desktop's picker
export function AddPath({ onAdd, onClose }: { onAdd: (path: string, pdf?: string) => void; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [pdf, setPdf] = useState("");
  const clean = unquote(path);
  const twin = unquote(pdf);
  const problem = clean ? pdfProblem(clean, twin) : undefined;
  const add = () => {
    if (!clean || problem) return;
    if (twin) onAdd(clean, twin);
    else onAdd(clean);
    onClose();
  };
  return (
    <Modal
      title="Add a document from a path"
      subtitle="A .docx (preferred) or .pdf on this PC or a synced share. It is copied into the project; the original is never changed."
      onClose={onClose}
      onSubmit={add}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" icon="plus" label="Add" disabled={!clean || !!problem} />
        </>
      }
    >
      <Text
        label="Path of the file"
        value={path}
        onChange={setPath}
        autoFocus
        placeholder={examplePath("C:\\…\\SOSIE_211_D401-1_3_01.01.docx", "/Users/you/…/SOSIE_211_D401-1_3_01.01.docx")}
        hint={examplePath(
          "Paste it from Explorer (Shift + right-click › Copy as path)",
          "Paste it from the Finder (Option + right-click › Copy as Pathname)",
        )}
        trailing={<Browse title="Add a document" filters={FILTERS} onPick={setPath} />}
      />
      <Text
        label="Its PDF rendering (optional)"
        value={pdf}
        onChange={setPdf}
        placeholder={examplePath("…\\SOSIE_211_D401-1_3_01.01.pdf", "…/SOSIE_211_D401-1_3_01.01.pdf")}
        hint="Recovers pictures the .docx lacks (figures pasted as flat text)"
        error={problem}
        trailing={<Browse title="Its PDF rendering" filters={PDF} onPick={setPdf} />}
      />
    </Modal>
  );
}
