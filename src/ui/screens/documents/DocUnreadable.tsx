import * as stylex from "@stylexjs/stylex";
import type { DocJson } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useApp } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import {
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto" },
  inner: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    width: "100%",
    maxWidth: `calc(${size.reading} + ${space.s11})`,
    marginInline: "auto",
    paddingBlock: space.s7,
    paddingInline: space.s5,
  },
  head: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: space.s3 },
  title: {
    margin: 0,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code, lineHeight: lineHeight.code },
  code: { color: color.textMuted },
  said: { display: "flex", flexDirection: "column", gap: space.s2 },
  caption: {
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  raw: {
    margin: 0,
    padding: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  acts: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

// ponytail: a document whose files cannot be read — what happened, what to do (read it again, convert it from its
// original, look at the folder, the system check), and the raw words of the app
export function DocUnreadable({
  id,
  doc,
  error,
  onRetry,
  onConvertAgain,
}: {
  id: string;
  doc?: DocJson;
  error: string;
  onRetry: () => void;
  onConvertAgain?: () => void;
}) {
  const app = useApp();
  const dir = project();
  return (
    <div {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(styles.head)}>
          <h2 {...stylex.props(styles.title)}>{doc?.title || id}</h2>
          {doc && (
            <span {...stylex.props(styles.mono, styles.code)}>
              {doc.code} · version {doc.version}
            </span>
          )}
        </div>
        <Banner
          tone="danger"
          title="This document could not be opened"
          actions={
            <>
              <Button size="sm" icon="refresh" label="Try again" onClick={onRetry} />
              {onConvertAgain && <Button size="sm" label="Convert again" onClick={onConvertAgain} />}
            </>
          }
        >
          Testimus could not read <span {...stylex.props(styles.mono)}>docs/{id}/doc.md</span>. Convert it again from
          its original, or look at the folder.
        </Banner>
        <div {...stylex.props(styles.said)}>
          <span {...stylex.props(styles.caption)}>What the app said</span>
          <pre {...stylex.props(styles.raw)}>{error}</pre>
        </div>
        <div {...stylex.props(styles.acts)}>
          {desktop() && dir && (
            <Button
              size="sm"
              variant="quiet"
              icon="folder-open"
              label="Show in Explorer"
              onClick={() => void reveal(pathJoin(dir, "docs", id))}
            />
          )}
          <Button
            size="sm"
            variant="quiet"
            icon="doctor"
            label="Open the system check"
            onClick={() => app.navigate("doctor")}
          />
        </div>
      </div>
    </div>
  );
}
