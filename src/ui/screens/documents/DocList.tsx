import * as stylex from "@stylexjs/stylex";
import type { DocRef } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { type } from "../../components/ui/type.ts";
import { baseName } from "../../lib/desktop.ts";
import { owns, settled, type Upload } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { DocBadges } from "./badges.tsx";
import { UploadFailure, uploadItem } from "./UploadItem.tsx";

const styles = stylex.create({
  pane: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: 1 },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s5,
    color: color.text,
  },
  body: { boxSizing: "border-box", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: space.s3 },
  lines: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  mono: { overflow: "hidden", textOverflow: "ellipsis" },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

type Item = { key: string; doc?: DocRef; upload?: Upload };

function docItem(d: DocRef): ListItemProps {
  return {
    title: d.title,
    tooltip: `${d.code} · ${d.version} — ${d.title}`,
    lead: <Icon name={/\.pdf$/i.test(d.source.file) ? "file" : "documents"} />,
    meta: (
      <span {...stylex.props(styles.lines)}>
        <span {...stylex.props(type.mono, styles.mono)}>
          {d.code} · {d.version}
        </span>
        <span {...stylex.props(styles.badges)}>
          <DocBadges doc={d} />
        </span>
      </span>
    ),
  };
}

// ponytail: the documents and the files being added or converted, as one list; what failed is said under it — a
// conversion is named by its document's file
export function DocList({
  docs,
  uploads: all,
  activeId,
  head = true,
  onOpen,
}: {
  docs: DocRef[] | undefined;
  uploads: Upload[];
  activeId: string;
  head?: boolean;
  onOpen: (id: string) => void;
}) {
  const uploads = all.map((u) => {
    const d = u.job === "convert" ? docs?.find((x) => x.id === u.docId) : undefined;
    return d ? { ...u, name: baseName(d.source.name || d.source.file) || d.id } : u;
  });
  const listed = (u: Upload) => !!docs?.some((d) => (u.docId ? d.id === u.docId : owns(u, d)));
  const items: Item[] = [
    ...(docs ?? []).map((d) => ({ key: d.id, doc: d, upload: uploads.find((u) => owns(u, d)) })),
    ...uploads
      .filter((u) => !listed(u) && u.phase !== "index-failed")
      .map((u) => ({ key: `upload-${u.key}`, upload: u })),
  ];
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
        <List
          label="Documents"
          items={items}
          getKey={(i) => i.key}
          renderItem={(i) =>
            i.upload && (!i.doc || !settled(i.upload)) ? uploadItem(i.upload) : docItem(i.doc as DocRef)
          }
          selected={activeId || null}
          onSelect={pick}
          density="two-line"
          loading={docs ? false : 4}
        />
        {failures.map((u) => (
          <UploadFailure key={u.key} u={u} />
        ))}
      </div>
    </section>
  );
}
