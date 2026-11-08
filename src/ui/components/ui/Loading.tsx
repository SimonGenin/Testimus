import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { type LoadingRead, loadingWords, useLoadingTurn, useRetryRead } from "../../lib/data/loading.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "./Banner.tsx";
import { Button } from "./Button.tsx";
import { Spinner } from "./Spinner.tsx";
import { type } from "./type.ts";

const SAY_AFTER_S = 1;
const SLOW_AFTER_S = 10;

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  inset: { paddingBlock: space.s3, paddingInline: space.s5 },
  line: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, color: color.textMuted },
});

export type LoadingProps = {
  /** the read the skeleton above stands for: the line names it in words, Try again asks it again */
  read: LoadingRead;
  /** under a list's loading rows: the inset of a row */
  inset?: boolean;
  /** the catalogue only: a state at once — status (after 1 s) · slow (after 10 s) */
  debugState?: "status" | "slow";
};

// ponytail: the sign of life under a skeleton — nothing for a second (the skeleton's shimmer is enough), then what is
// loading and the seconds counting, then from 10 s that the answer is slow, with Try again; an error stays the
// screen's own danger banner
export function Loading({ read, inset = false, debugState }: LoadingProps) {
  const retry = useRetryRead(read);
  const mine = useLoadingTurn(read);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(since);
  useEffect(() => {
    if (debugState) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [debugState]);
  const seconds = debugState === "slow" ? 12 : debugState === "status" ? 2 : Math.floor((now - since) / 1000);
  if (seconds < SAY_AFTER_S || (!mine && !debugState)) return null;
  const slow = seconds >= SLOW_AFTER_S;
  return (
    <div {...stylex.props(styles.wrap, inset && styles.inset)}>
      <div role="status" {...stylex.props(styles.line)}>
        <Spinner size="sm" />
        <span {...stylex.props(type.small)}>
          {slow ? "Still loading" : "Loading"} {loadingWords(read)}…{" "}
          <span aria-hidden="true" {...stylex.props(type.code, type.tabular)}>
            {seconds} s
          </span>
        </span>
      </div>
      {slow && (
        <Banner
          tone="neutral"
          compact
          actions={
            <Button
              size="sm"
              label="Try again"
              onClick={() => {
                const t = Date.now();
                setSince(t);
                setNow(t);
                retry();
              }}
            />
          }
        >
          Testimus is answering slowly. The page keeps waiting.
        </Banner>
      )}
    </div>
  );
}
