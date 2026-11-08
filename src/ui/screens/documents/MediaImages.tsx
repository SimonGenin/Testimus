import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { plural } from "../../lib/format.ts";
import type { MediaShown } from "../../lib/media.ts";
import { color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { ImageDetail } from "./ImageDetail.tsx";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface },
  inner: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: space.s5,
    paddingInline: space.s7,
    paddingBottom: space.s10,
  },
  bar: { margin: 0, color: color.textMuted },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, calc(${size.sidebar} - ${space.s10})), 1fr))`,
    gap: space.s5,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  pic: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    aspectRatio: "4 / 3",
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textSubtle,
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  line: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
    overflow: "hidden",
    color: color.text,
    overflowWrap: "anywhere",
  },
  anchor: { color: color.textSubtle },
  unread: { color: color.textMuted },
});

export type Image = MediaShown["images"][number];

// ponytail: an images document as a grid — each picture with its anchor (img:N, what a source cites) and what Claude
// saw in it; a tile opens the picture large, with its facts and the way to remove it
export function MediaImages({
  docId,
  shown,
  focus,
}: {
  docId: string;
  shown: MediaShown | undefined;
  /** the image a link pointed at (img:3): opened large */
  focus?: string;
}) {
  const [open, setOpen] = useState<string | null>(focus ?? null);
  const images = shown?.images ?? [];
  const picked = images.find((i) => i.anchor === open);
  return (
    <div data-testid="doc-images" {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        {!shown ? (
          <Skeleton lines={4} />
        ) : images.length ? (
          <>
            <p {...stylex.props(type.small, styles.bar)}>
              {plural(images.length, "image")} in the order they were taken · open one to see it large
            </p>
            <ul aria-label="Images" {...stylex.props(styles.grid)}>
              {images.map((im) => (
                <li key={im.n}>
                  <Card density="tight" label={`${im.anchor} ${im.caption}`} onOpen={() => setOpen(im.anchor)}>
                    <span {...stylex.props(styles.pic)}>
                      {im.figure ? (
                        <img
                          src={fileUrl(`docs/${docId}/${im.figure}`)}
                          alt=""
                          loading="lazy"
                          {...stylex.props(styles.img)}
                        />
                      ) : (
                        <Icon name="image" size="lg" />
                      )}
                    </span>
                    <span {...stylex.props(type.small, styles.line)}>
                      <span {...stylex.props(type.code, styles.anchor)}>{im.anchor}</span>{" "}
                      {im.description ? (
                        im.description
                      ) : (
                        <span {...stylex.props(styles.unread)}>
                          {im.state === "failed" ? im.error || "Unreadable" : "Not read by Claude yet"}
                        </span>
                      )}
                    </span>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon="image"
            title="No image"
            text="This document holds no image yet: « Add images… » adds some."
          />
        )}
      </div>
      {picked && <ImageDetail docId={docId} image={picked} last={images.length === 1} onClose={() => setOpen(null)} />}
    </div>
  );
}
