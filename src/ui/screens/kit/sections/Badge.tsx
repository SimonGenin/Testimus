import {
  Badge,
  type BadgeTone,
  DIFF,
  REVIEW,
  ReviewBadge,
  SEVERITY,
  SeverityBadge,
  SYNC,
} from "../../../components/ui/Badge.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const TONES: BadgeTone[] = ["neutral", "info", "success", "warning", "danger", "claude", "accent"];

export const section: KitSection = {
  name: "Badge",
  family: "Status",
  file: "Badge.tsx",
  summary:
    "A short state attached to a thing: review, severity, sync, a diff mark, a count. An icon and a word carry the meaning, the tone repeats it — never colour alone, never a tone picked for looks. Screens use the fixed vocabularies.",
  note: "ReviewBadge and SeverityBadge are thin wrappers with the fixed words; SYNC and DIFF are the other vocabularies, spread into a Badge. busy is the badge with a spinner the screens drew (Running, Indexing…).",
  states: () => (
    <States>
      <Cell label="review" wide>
        {(Object.keys(REVIEW) as (keyof typeof REVIEW)[]).map((s) => (
          <ReviewBadge key={s} state={s} />
        ))}
      </Cell>
      <Cell label="severity">
        {(Object.keys(SEVERITY) as (keyof typeof SEVERITY)[]).map((s) => (
          <SeverityBadge key={s} severity={s} />
        ))}
      </Cell>
      <Cell label="sync" wide>
        {Object.values(SYNC).map((w) => (
          <Badge key={w.label} {...w} />
        ))}
      </Cell>
      <Cell label="diff" wide>
        {Object.values(DIFF).map((w) => (
          <Badge key={w.label} {...w} />
        ))}
      </Cell>
      <Cell label="tones (word only)" wide>
        {TONES.map((t) => (
          <Badge key={t} tone={t} label={t} />
        ))}
      </Cell>
      <Cell label="outline · sm">
        <Badge label="Jira version" tone="warning" icon="history" outline />
        <Badge label="required" size="sm" />
        <Badge label="off in Xray" size="sm" tone="warning" />
      </Cell>
      <Cell label="count · sm count · accent">
        <Badge label="12" count />
        <Badge label="3" count tone="accent" />
        <Badge label="645" count size="sm" />
      </Cell>
      <Cell label="dot (read out: « All good »)">
        <Badge label="All good" dot tone="success" />
        <Badge label="Claude is not connected" dot tone="danger" />
      </Cell>
      <Cell label="busy">
        <Badge label="Running" tone="info" busy />
        <Badge label="Indexing…" tone="claude" busy size="sm" />
      </Cell>
      <Cell label="tooltip (hover)">
        <Badge {...SYNC["in-sync"]} tooltip="Same as Jira since the last pull, 09:15" />
      </Cell>
    </States>
  ),
};
