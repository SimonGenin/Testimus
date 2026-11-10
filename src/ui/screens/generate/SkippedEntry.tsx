import * as stylex from "@stylexjs/stylex";
import { useContext } from "react";
import type { Skipped } from "../../../core/claude/gen-reply.ts";
import { Badge, SECOND_LOOK } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { type } from "../../components/ui/type.ts";
import { AppContext } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { nameTests, type TestNames, testNamed } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { SkippedRefs } from "./SkippedRefs.tsx";

// ponytail: a result written before the reasons existed has none: the page groups by `category`, the reason's words
export type SkippedItem = Omit<Skipped, "reason"> & { reason?: Skipped["reason"] };

const styles = stylex.create({
  item: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, color: color.text },
  line: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: color.textMuted },
  state: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    margin: 0,
    minWidth: 0,
  },
  words: { flex: "1 1 12rem", minWidth: 0, overflowWrap: "anywhere" },
  asked: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
});

const ID = /^(?=.*[\d_])[\w.#-]+$/;

// ponytail: what a reviewer must look at before trusting the reason — a doubt of Testimus' own, or a second look that
// found the passage. A confirmed item, or one nobody looked at twice, stays quiet
export const needsLook = (s: SkippedItem) => !!s.doubts?.length || s.review?.verdict === "writable";

const SECOND = "The second look Claude took at this reason while checking the tests";
const searches = (n: number) => `${n} ${n === 1 ? "search" : "searches"}`;

// ponytail: one behavior left without a test, to judge in seconds — what and why, the second look and Testimus' doubts
// as states, what would let it be written, the passage that asks for it, and the evidence (what the run searched and
// opened) folded but there. One that needs a look is framed; the others are plain lines
export function SkippedEntry({ s, nameOf }: { s: SkippedItem; nameOf: TestNames }) {
  const app = useContext(AppContext);
  const searched = s.searched ?? [];
  const read = s.read ?? [];
  const review = s.review;
  const test = s.test;
  const body = (
    <>
      <p {...stylex.props(type.small, styles.line)}>
        <span {...stylex.props(ID.test(s.item) ? type.code : type.medium)}>{s.item}</span>
        {s.why && (
          <>
            <span {...stylex.props(styles.muted)}> — </span>
            <span {...stylex.props(styles.muted)}>{s.why}</span>
          </>
        )}
      </p>
      {review && (
        <p {...stylex.props(type.small, styles.state)}>
          <Badge
            {...(SECOND_LOOK[review.verdict] ?? SECOND_LOOK.unsure)}
            size="sm"
            quiet={review.verdict === "confirmed"}
            tooltip={SECOND}
          />
          {review.why && <span {...stylex.props(styles.words, styles.muted)}>{nameTests(review.why, nameOf)}</span>}
          <SkippedRefs lines={review.sources ?? []} />
        </p>
      )}
      {(s.doubts ?? []).map((d) => (
        <p key={d} {...stylex.props(type.small, styles.state)}>
          <Badge {...SECOND_LOOK.doubt} size="sm" />
          <span {...stylex.props(styles.words)}>{nameTests(d, nameOf)}</span>
        </p>
      ))}
      {s.unblock && (
        <p {...stylex.props(type.small, styles.line)}>
          <span {...stylex.props(type.medium, styles.muted)}>To write it</span> {s.unblock}
        </p>
      )}
      {test && (
        <p {...stylex.props(type.small, styles.line)}>
          <span {...stylex.props(type.medium, styles.muted)}>Verified by</span>{" "}
          {app ? (
            <Button variant="link" label={testNamed(nameOf, test)} onClick={() => app.navigate("tests", test)} />
          ) : (
            testNamed(nameOf, test)
          )}
        </p>
      )}
      {!!s.sources?.length && (
        <span {...stylex.props(styles.asked)}>
          <SkippedRefs lines={s.sources} />
        </span>
      )}
      {searched.length + read.length > 0 && (
        <Disclosure
          quiet
          summary="Searched and read"
          meta={[searched.length ? searches(searched.length) : "", read.length ? plural(read.length, "passage") : ""]
            .filter(Boolean)
            .join(" · ")}
        >
          <Facts
            size="sm"
            items={[
              searched.length > 0 && { label: "Searched", value: searched.map((q) => `« ${q} »`).join(" · ") },
              read.length > 0 && { label: "Opened", value: <SkippedRefs lines={read} compact /> },
            ]}
          />
        </Disclosure>
      )}
    </>
  );
  return (
    <li {...stylex.props(styles.item)}>
      {needsLook(s) ? (
        <Card density="compact" sunken>
          {body}
        </Card>
      ) : (
        body
      )}
    </li>
  );
}
