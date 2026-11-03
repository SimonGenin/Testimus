import * as stylex from "@stylexjs/stylex";
import { border, radius, size } from "../../styles/tokens.stylex.ts";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  spinner: {
    flex: "none",
    display: "inline-block",
    borderRadius: radius.full,
    borderStyle: "solid",
    borderWidth: border.widthStrong,
    borderColor: "currentColor",
    borderRightColor: "transparent",
    opacity: 0.85,
    animationName: spin,
    animationDuration: "0.9s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  sm: { width: size.iconSm, height: size.iconSm },
  md: { width: size.iconMd, height: size.iconMd },
});

export type SpinnerProps = {
  /** sm 14 px · md 16 px (default, the size of an icon it replaces) */
  size?: "sm" | "md";
  /** read out when the spinner is the only sign of the work (else the owner says it, e.g. aria-busy) */
  label?: string;
};

export function Spinner({ size: s = "md", label }: SpinnerProps) {
  const look = stylex.props(styles.spinner, styles[s]);
  return label ? <span role="status" aria-label={label} {...look} /> : <span aria-hidden="true" {...look} />;
}
