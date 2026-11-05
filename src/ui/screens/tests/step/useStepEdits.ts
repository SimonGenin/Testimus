import type { Block, Step, StepImage } from "../../../../core/types.ts";
import { imageRef } from "../../../lib/blocks.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import type { Moved } from "./moved.ts";
import { cut, embeds, fileName, gap, inTable, put, setField } from "./stepText.ts";

export type StepEditsInput = {
  step: Step;
  n: number;
  onChange: (fn: (s: Step) => Step) => void;
  addImage?: (file: File) => Promise<StepImage>;
  onImageGone?: (file: string) => void;
  alive?: () => () => boolean;
};

// ponytail: every edit of a step card is one function of the step — the card hands it to the editor, which applies it
// to the step as it is now (an Undo that lands after a move or a reload still finds its step, or says it is too late)
export function useStepEdits({ step, n, onChange, addImage, onImageGone, alive }: StepEditsInput) {
  const token = () => alive?.() ?? (() => true);

  const setText = (name: string, at: number, end: number, value: string) =>
    onChange((s) => {
      const cur = s.fields[name] ?? "";
      // ponytail: a table cell's text is written as typed — its spaces and its line breaks are the cell's own
      const next = inTable(cur, at)
        ? cur.slice(0, at) + value + cur.slice(end)
        : at === end
          ? value.trim()
            ? put(cur, at, value)
            : cur
          : value
            ? cur.slice(0, at) + value + cur.slice(end)
            : cut(cur, at, end);
      return setField(s, name, next);
    });

  const setWhole = (name: string, value: string, undo?: string) => {
    const before = step.fields[name] ?? "";
    onChange((s) => setField(s, name, value));
    if (undo) undoable(undo, name, before);
  };

  const addFiles = async (name: string, at: number, files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length || !addImage) return;
    try {
      const added: StepImage[] = [];
      for (const f of images) added.push(await addImage(f));
      onChange((s) => {
        const cur = s.fields[name] ?? "";
        const to = Math.min(at, cur.length);
        return setField(
          { ...s, images: [...s.images, ...added] },
          name,
          put(cur, to, added.map((im) => imageRef(im.file)).join(gap(cur, to))),
        );
      });
    } catch (e) {
      errorToast(e, "Could not save the screenshot");
    }
  };

  const dropBlock = (to: string, at: number, from: Moved) =>
    onChange((s) => {
      if (from.step !== n) return s;
      if (from.field === to && from.at !== undefined && from.end !== undefined && at >= from.at && at <= from.end)
        return s;
      const clampTo = (k: number, text: string) => Math.min(Math.max(k, 0), text.length);
      if (from.at === undefined || from.end === undefined || !from.field) {
        if (!from.file || !s.images.some((im) => im.file === from.file)) return s;
        const cur = s.fields[to] ?? "";
        return setField(s, to, put(cur, clampTo(at, cur), imageRef(from.file)));
      }
      const src = s.fields[from.field] ?? "";
      const chunk = src.slice(from.at, from.end);
      if (!chunk.trim()) return s;
      const left = cut(src, from.at, from.end);
      let next = setField(s, from.field, left);
      let pos = at;
      if (from.field === to && from.at < at) pos -= src.length - left.length;
      const dst = next.fields[to] ?? "";
      next = setField(next, to, put(dst, clampTo(pos, dst), chunk));
      return next;
    });

  // ponytail: an Undo puts back only what the ✕ took — that field, and the attachment when it went with
  // it — onto the step as it is now, and only on the test instance it was rendered for; a picture left
  // unattached is deleted once its Undo can no longer bring it back
  const undoable = (title: string, name: string, before: string, image?: StepImage) => {
    const ok = token();
    toast({
      tone: "neutral",
      title,
      detail: `${name} of step ${n}`,
      onExpire: image ? () => onImageGone?.(image.file) : undefined,
      action: {
        label: "Undo",
        run: () => {
          if (!ok()) {
            toast({ tone: "neutral", title: "Too late to undo", detail: "The test was reloaded since." });
            if (image) onImageGone?.(image.file);
            return;
          }
          onChange((s) => {
            const back = setField(s, name, before);
            return image && !back.images.some((x) => x.file === image.file)
              ? { ...back, images: [...back.images, image] }
              : back;
          });
        },
      },
    });
  };

  const removeBlock = (name: string, b: Block) => {
    const before = step.fields[name] ?? "";
    const after = setField(step, name, cut(before, b.at, b.end));
    const gone = b.kind === "image" && !embeds(after, b.image.file) ? b.image : undefined;
    onChange((s) => {
      const next = setField(s, name, cut(s.fields[name] ?? "", b.at, b.end));
      return gone ? { ...next, images: next.images.filter((x) => x.file !== gone.file) } : next;
    });
    undoable(
      b.kind === "text" ? "Text removed" : b.kind === "table" ? "Table removed" : "Image removed",
      name,
      before,
      gone,
    );
  };

  const detach = (im: StepImage) => {
    const ok = token();
    onChange((s) => ({ ...s, images: s.images.filter((x) => x.file !== im.file) }));
    toast({
      tone: "neutral",
      title: "Attachment detached",
      detail: `${fileName(im.file)} of step ${n}`,
      onExpire: () => onImageGone?.(im.file),
      action: {
        label: "Undo",
        run: () => {
          if (!ok()) {
            onImageGone?.(im.file);
            return;
          }
          onChange((s) => (s.images.some((x) => x.file === im.file) ? s : { ...s, images: [...s.images, im] }));
        },
      },
    });
  };

  return { setText, setWhole, addFiles, dropBlock, removeBlock, detach };
}
