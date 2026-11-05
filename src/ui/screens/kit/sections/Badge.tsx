import {
  Badge,
  type BadgeTone,
  COLUMN,
  DIFF,
  DOC_STATUS,
  HEALTH,
  jiraStatus,
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
  note: "ReviewBadge and SeverityBadge are thin wrappers with the fixed words; SYNC, DIFF, COLUMN, DOC_STATUS and HEALTH are the other vocabularies, spread into a Badge, and jiraStatus reads a Jira status. The words of REVIEW, SEVERITY and DIFF (and Modified in SYNC) take their own colour alias (`ink`: color-status-*, -severity-*, -diff-*), so the design changes them in one place. busy is the badge with a spinner the screens drew (Running, Indexing…).",
  guidelines: [
    {
      head: "Anatomy",
      text: "Icon (14 px) + one or two words in a tinted pill, 22 px high, `radius-full`, no edge. Never colour alone: the icon and the word carry the meaning, the tone repeats it.",
    },
    {
      head: "Tones",
      text: "(each has a meaning — never pick a tone for looks):",
      items: [
        "`neutral` Draft, Local, To Do (Jira status), Not checked",
        "`info` an info finding, Checking…",
        "`success` Validated, In sync, OK, new step",
        "`warning` To fix, Modified, Changed in Jira, a warning finding, Rate limited",
        "`danger` Conflict, Error, Failed, Deleted, Not fully read",
        "`claude` Changed by Claude, Added by Claude, Generated",
        "`accent` the selected count in a tab",
      ],
    },
    {
      head: "Options",
      text: "`outline` (a state that is a link: « Jira version ») · `sm` (16 px, in dense meta lines) · `count` (a number pill) · `dot` (a state on an icon: the rail's system status).",
    },
    {
      head: "Fixed vocabularies",
      text: "Review: Draft · To fix · Validated. Severity: Error · Warning · Info. Sync: Checking… · In sync · Modified · Changed in Jira · Conflict · Local only. Diff: New · Modified · Deleted · Changed by Claude.",
    },
    {
      head: "Vocabularies of the app",
      items: [
        "`COLUMN` a step column's origin: Xray · Xray · standard · Local only (the sync word) · Xray · to describe (a field found in Xray, not described yet) · No longer in Xray · New local column.",
        "`DOC_STATUS` a document's status: Draft · Submitted · Validated.",
        "`HEALTH` a check of the System check: Failed · To do · OK · Not checked · Info.",
        "`jiraStatus(name)` a Jira status keeps Jira's word; done words are success, under-way words warning, the rest neutral, each with its icon.",
        "A screen never writes these words nor picks their tone: it spreads the vocabulary into a Badge.",
      ],
    },
  ],
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
      <Cell label="column" wide>
        {Object.values(COLUMN).map((w) => (
          <Badge key={w.label} {...w} />
        ))}
      </Cell>
      <Cell label="document status">
        {Object.values(DOC_STATUS).map((w) => (
          <Badge key={w.label} {...w} />
        ))}
      </Cell>
      <Cell label="health (System check)" wide>
        {Object.values(HEALTH).map((w) => (
          <Badge key={w.label} {...w} />
        ))}
      </Cell>
      <Cell label="Jira status">
        {["To Do", "In Progress", "Done"].map((s) => (
          <Badge key={s} {...jiraStatus(s)} size="sm" />
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
      <Cell label="onClick: a state you can open (Jira version) · pressed">
        <Badge tone="warning" icon="history" label="Jira version" onClick={() => {}} />
        <Badge tone="warning" icon="history" label="Hide Jira version" pressed onClick={() => {}} />
      </Cell>
      <Cell label="tooltip (hover)">
        <Badge {...SYNC["in-sync"]} tooltip="Same as Jira since the last pull, 09:15" />
      </Cell>
    </States>
  ),
};
