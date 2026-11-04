import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, radius, space } from "../../../styles/tokens.stylex.ts";
import { blockMarker } from "../markers.stylex.ts";

const styles = stylex.create({
  figure: {
    marginBlock: space.s1,
    marginInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s3,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    maxWidth: "100%",
    alignSelf: "flex-start",
    boxSizing: "border-box",
  },
  frame: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "center",
    maxWidth: "100%",
    overflow: "hidden",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r1,
    backgroundColor: color.surface,
    cursor: "zoom-in",
  },
  img: { maxWidth: "100%", height: "auto", display: "block" },
  cap: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    color: color.textMuted,
  },
  name: {
    color: color.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  size: { flex: "none", whiteSpace: "nowrap" },
  grow: { flex: 1 },
  tools: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

// the caption of a picture block: its handle, its name (or its figure source), its tools
export function Caption({
  grip,
  name,
  icon,
  children,
}: {
  grip?: ReactNode;
  name: ReactNode;
  icon?: "external";
  children?: ReactNode;
}) {
  return (
    <figcaption {...stylex.props(type.small, styles.cap)}>
      {grip}
      {icon && <Icon name={icon} size="sm" />}
      {name}
      <span {...stylex.props(styles.grow)} />
      {children && <span {...stylex.props(styles.tools)}>{children}</span>}
    </figcaption>
  );
}

export function ImageBlock({
  src,
  name,
  label,
  caption,
  grip,
  onOpen,
  onRemove,
}: {
  src: string;
  name: string;
  label: string;
  caption?: ReactNode;
  grip?: ReactNode;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const [size, setSize] = useState("");
  return (
    <figure data-testid="image-block" {...stylex.props(blockMarker, styles.figure)}>
      <div {...stylex.props(styles.frame)} onClick={onOpen}>
        <img
          draggable={false}
          src={src}
          alt={name}
          {...stylex.props(styles.img)}
          onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
        />
      </div>
      <Caption
        grip={grip}
        name={
          <>
            {caption ?? <span {...stylex.props(type.code, styles.name)}>{name}</span>}
            {size && <span {...stylex.props(type.tabular, styles.size)}>{size}</span>}
          </>
        }
      >
        <Button variant="quiet" size="xs" iconOnly icon="zoom-in" label={`Open ${name}`} onClick={onOpen} />
        {onRemove && (
          <Button
            variant="quiet"
            size="xs"
            iconOnly
            icon="close"
            label={`Remove ${name} from ${label}`}
            onClick={onRemove}
          />
        )}
      </Caption>
    </figure>
  );
}

const nameOf = (params: string, url: string) => /alt="([^"]*)"/.exec(params)?.[1] || url;

// ponytail: a picture Jira points to outside the project (a link, or a blob: Jira no longer holds) — shown, never copied
export function ExternBlock({
  url,
  params,
  label,
  grip,
  onRemove,
}: {
  url: string;
  params: string;
  label: string;
  grip?: ReactNode;
  onRemove?: () => void;
}) {
  const dead = url.startsWith("blob:");
  const name = nameOf(params, url);
  return (
    <figure data-testid="image-block" title={url} {...stylex.props(blockMarker, styles.figure)}>
      {!dead && (
        <div {...stylex.props(styles.frame)}>
          <img draggable={false} src={url} alt={name} {...stylex.props(styles.img)} />
        </div>
      )}
      {dead && (
        <Banner tone="danger" compact>
          Jira no longer holds this image.
        </Banner>
      )}
      <Caption grip={grip} icon="external" name={<span {...stylex.props(type.code, styles.name)}>{name}</span>}>
        {onRemove && (
          <Button
            variant="quiet"
            size="xs"
            iconOnly
            icon="close"
            label={`Remove ${name} from ${label}`}
            onClick={onRemove}
          />
        )}
      </Caption>
    </figure>
  );
}
