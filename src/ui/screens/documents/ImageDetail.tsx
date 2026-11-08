import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Answer } from "../../components/ui/Answer.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { invalidate } from "../../lib/data/query.ts";
import { removeMedia } from "../../lib/media-uploads.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import type { Image } from "./MediaImages.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  well: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    maxHeight: "60vh",
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    overflow: "hidden",
  },
  img: { maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" },
  text: { margin: 0, color: color.text },
  muted: { margin: 0, color: color.textMuted },
});

const when = (d?: string) => (d ? `${d.slice(0, 10)} ${d.slice(11, 16)}` : "");

// ponytail: one image large — what a source cites (its anchor, its caption: the quotable text), what Claude read in it
// (never quotable), and the way out of the document (its anchor goes with it; a test citing it then says so)
export function ImageDetail({
  docId,
  image,
  last,
  onClose,
}: {
  docId: string;
  image: Image;
  /** the document's only file: removing it is removing the document */
  last: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = () => {
    void removeMedia(docId, image.name, image.n, () => {
      void invalidate(client, [["docs.list"], ["docs.show", { id: docId }], ["media.show", { doc: docId }]]);
    });
    onClose();
  };
  if (asking)
    return (
      <Modal
        title={`Remove ${image.name} from the document?`}
        size="sm"
        consequences={[[1, `anchor ${image.anchor} goes: a test citing it reports its source missing`]]}
        confirm={{ verb: "Remove the image", danger: true, onConfirm: remove }}
        onClose={() => setAsking(false)}
      >
        <p {...stylex.props(type.body, styles.muted)}>Its copy, its picture and what Claude read in it are deleted.</p>
      </Modal>
    );
  return (
    <Modal
      title={image.name}
      subtitle={<span {...stylex.props(type.code)}>{`${docId}#${image.anchor}`}</span>}
      size="lg"
      onClose={onClose}
      footNote="A source quotes the caption; Claude's reading is searched, never quoted."
      actions={
        <Button
          variant="quiet"
          icon="trash"
          label="Remove from the document…"
          disabled={last ? "The document's only image: delete the document instead" : false}
          onClick={() => setAsking(true)}
        />
      }
    >
      <div {...stylex.props(styles.body)}>
        {image.figure && (
          <span {...stylex.props(styles.well)}>
            <img src={fileUrl(`docs/${docId}/${image.figure}`)} alt={image.caption} {...stylex.props(styles.img)} />
          </span>
        )}
        <Facts
          items={[
            { label: "Anchor", value: <span {...stylex.props(type.code)}>{image.anchor}</span> },
            { label: "Caption", value: image.caption },
            !!image.takenAt && { label: "Taken", value: when(image.takenAt) },
            !!image.width && { label: "Size", value: `${image.width} × ${image.height} px` },
          ]}
        />
        {image.description ? (
          <Answer title="Claude's reading" meta="What Claude saw — searched, never quoted">
            <p {...stylex.props(type.compact, styles.text)}>{image.description}</p>
            {image.labels.length > 0 && (
              <p {...stylex.props(type.small, styles.muted)}>Text in the picture: {image.labels.join(" · ")}</p>
            )}
          </Answer>
        ) : (
          <p {...stylex.props(type.small, styles.muted)}>Claude has not read this image yet.</p>
        )}
      </div>
    </Modal>
  );
}
