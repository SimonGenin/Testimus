import * as stylex from "@stylexjs/stylex";
import type { DocRef, IndexRun } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { baseName } from "../../lib/desktop.ts";
import { indexRunLine, indexRunPercent } from "../../lib/format.ts";
import { type Batch, batchLine } from "../../lib/media.ts";
import { conversionsLine, owns, settled, type Upload } from "../../lib/uploads.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { useCancel } from "../settings/jobs.ts";
import { DocBadges } from "./badges.tsx";
import { UploadFailure, uploadItem } from "./UploadItem.tsx";

const styles = stylex.create({
  pane: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: 1 },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    flex: "none",
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: space.s6,
    color: color.text,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  body: { boxSizing: "border-box", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: space.s3 },
  lines: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.snug, minWidth: 0 },
  mono: { maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", color: color.textSubtle },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  batches: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    alignSelf: "stretch",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  batch: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, color: color.textMuted },
  batchName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  out: { color: color.textSubtle },
  run: { paddingBlock: space.s3, paddingInline: space.s6 },
  converting: { margin: 0, paddingTop: space.s3, paddingInline: space.s6, color: color.textMuted },
});

// ponytail: a document's batches under its row — what each holds, and whether it is in the document
function BatchLines({ batches }: { batches: Batch[] }) {
  if (!batches.length) return null;
  return (
    <ul aria-label="Photos and videos" {...stylex.props(styles.batches)}>
      {batches.map((b) => (
        <li key={b.id} {...stylex.props(type.small, styles.batch, !b.included && styles.out)}>
          <Icon name="image" size="sm" />
          <span {...stylex.props(styles.batchName)}>
            {b.title} — {batchLine(b)}
            {b.included ? "" : " · not in the document"}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Item = { key: string; doc?: DocRef; upload?: Upload };

function docItem(d: DocRef, batches: Batch[]): ListItemProps {
  const code = [d.code, d.version].filter(Boolean).join(" · ");
  return {
    title: d.title,
    tooltip: code ? `${code} — ${d.title}` : d.title,
    lead: <Icon name={/\.pdf$/i.test(d.source.file) ? "file" : "documents"} />,
    meta: (
      <span {...stylex.props(styles.lines)}>
        {code && <span {...stylex.props(type.mono, styles.mono)}>{code}</span>}
        <span {...stylex.props(styles.badges)}>
          <DocBadges doc={d} />
        </span>
        <BatchLines batches={batches} />
      </span>
    ),
  };
}

// ponytail: the documents and the files being added or converted, as one list; an index run is each document's badge
// and the bar under the list; what failed is said under it — a conversion is named by its document's file
export function DocList({
  docs,
  uploads: all,
  activeId,
  head = true,
  run = null,
  onOpen,
}: {
  docs: DocRef[] | undefined;
  uploads: Upload[];
  activeId: string;
  head?: boolean;
  /** the index run under way (rag.status): its bar and its words under the list */
  run?: IndexRun | null;
  onOpen: (id: string) => void;
}) {
  const cancel = useCancel();
  const media = useRead("media.list", {}).data;
  const batchesOf = (id: string) => (Array.isArray(media) ? media.filter((b) => b.doc === id) : []);
  const uploads = all.map((u) => {
    const d = u.job === "convert" ? docs?.find((x) => x.id === u.docId) : undefined;
    return d ? { ...u, name: baseName(d.source.name || d.source.file) || d.id } : u;
  });
  const listed = (u: Upload) => !!docs?.some((d) => (u.docId ? d.id === u.docId : owns(u, d)));
  const items: Item[] = [
    ...(docs ?? []).map((d) => ({ key: d.id, doc: d, upload: uploads.find((u) => owns(u, d)) })),
    ...uploads.filter((u) => !listed(u) && u.job !== "index").map((u) => ({ key: `upload-${u.key}`, upload: u })),
  ];
  const converting = conversionsLine(uploads);
  const failures = uploads.filter((u) => u.phase === "failed" || u.phase === "index-failed");
  const pick = (key: string) => {
    const it = items.find((i) => i.key === key);
    const id = it?.doc?.id ?? it?.upload?.docId;
    if (id) onOpen(id);
  };
  return (
    <section aria-label="Document list" {...stylex.props(styles.pane)}>
      {head && (
        <div {...stylex.props(type.titleSm, styles.head)}>
          Documents
          {docs && <Badge count label={String(docs.length)} />}
        </div>
      )}
      <div {...stylex.props(styles.body)}>
        {converting && (
          <p role="status" {...stylex.props(type.small, styles.converting)}>
            {converting}
          </p>
        )}
        <List
          label="Documents"
          items={items}
          getKey={(i) => i.key}
          renderItem={(i) =>
            i.upload && (!i.doc || !settled(i.upload))
              ? uploadItem(i.upload, cancel)
              : docItem(i.doc as DocRef, batchesOf((i.doc as DocRef).id))
          }
          selected={activeId || null}
          onSelect={pick}
          density="two-line"
          loading={docs ? false : 4}
        />
        {run && (
          <div {...stylex.props(styles.run)}>
            <Progress label="Index" value={indexRunPercent(run)} detail={indexRunLine(run)} />
          </div>
        )}
        {failures.map((u) => (
          <UploadFailure key={u.key} u={u} />
        ))}
      </div>
    </section>
  );
}
