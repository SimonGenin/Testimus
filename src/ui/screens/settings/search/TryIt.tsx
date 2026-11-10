import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Banner } from "../../../components/ui/Banner.tsx";
import { List } from "../../../components/ui/List.tsx";
import { Select } from "../../../components/ui/Select.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { type } from "../../../components/ui/type.ts";
import { useRead } from "../../../lib/data/query.ts";
import { useSettled } from "../../../lib/search.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Group, Hint, Row } from "../Section.tsx";
import type { Retrieval } from "./draft.ts";
import { Measure } from "./Measure.tsx";

const styles = stylex.create({
  filters: { display: "flex", gap: space.s2, flexWrap: "wrap", alignItems: "center" },
  ref: { color: color.textMuted },
  idle: { paddingBlock: space.s4, textAlign: "center" },
});

type Hit = CommandOutput<"rag.search">[number];

const KINDS: { value: Hit["kind"] | "all"; label: string }[] = [
  { value: "all", label: "Every kind" },
  { value: "section", label: "Text only" },
  { value: "figure", label: "Figures only" },
  { value: "image", label: "Images only" },
  { value: "transcript", label: "Video transcripts only" },
  { value: "frame", label: "Video key frames only" },
];

const quoted = (xs: string[]) => xs.map((x) => `« ${x} »`).join(", ");

// ponytail: the line under a hit — why it came, in the order a person checks it: the two rankings, the reranker,
// then the forms of the query its text holds
export function whyLine(h: Hit): string {
  if (h.via) return h.via === "section" ? "Brought as the parent section" : "Brought as a referenced section";
  const w = h.why;
  if (!w) return "";
  return [
    w.words ? `words #${w.words}` : "not by its words",
    w.meaning ? `meaning #${w.meaning}` : h.degraded ? "words only" : "",
    w.reranker !== null ? `reranker ${w.reranker.toFixed(2)}` : "",
    w.matched.length ? `words ${quoted(w.matched)}` : "",
    w.stems.length ? `forms ${quoted(w.stems)}` : "",
    ...w.synonyms.map((s) => `synonym ${s}`),
    ...w.typos.map((t) => `typo ${t}`),
  ]
    .filter(Boolean)
    .join(" · ");
}

function titleOf(h: Hit): string {
  if (h.kind === "figure") return h.text.split("\n")[0] ?? "";
  const where = h.header.split(" — ").pop() ?? h.header;
  return h.path && where.startsWith(`${h.path} `) ? where.slice(h.path.length + 1) : where;
}

// ponytail: a search with the settings being edited, each hit with its why — so a setting is judged on real questions
// before it is kept; Measure runs the benchmark with them
export function TryIt({ draft }: { draft: Retrieval }) {
  const [query, setQuery] = useState("");
  const [doc, setDoc] = useState("all");
  const [kind, setKind] = useState<Hit["kind"] | "all">("all");
  const [section, setSection] = useState("");
  const docs = useRead("docs.list", {});
  const asked = { q: useSettled(query.trim(), 300), section: useSettled(section.trim(), 300) };
  const search = useRead(
    "rag.search",
    {
      query: asked.q,
      k: 10,
      explain: true,
      retrieval: draft,
      ...(doc !== "all" ? { docIds: [doc] } : {}),
      ...(kind !== "all" ? { kinds: [kind] } : {}),
      ...(asked.section ? { section: asked.section } : {}),
    },
    { enabled: !!asked.q, keepPrevious: true },
  );
  const hits = asked.q ? (search.data ?? []) : [];
  return (
    <Group id="try" title="Try it" note="With the settings as they are now." footer={<Measure draft={draft} />}>
      <Row>
        <Text
          type="search"
          icon="search"
          ariaLabel="Try a search"
          placeholder="A question, a code, a device name…"
          value={query}
          onChange={setQuery}
        />
        <div {...stylex.props(styles.filters)}>
          <Select
            label="Documents"
            appearance="quiet"
            size="sm"
            value={doc}
            options={[
              { value: "all", label: "All documents" },
              ...(docs.data ?? []).map((d) => ({ value: d.id, label: d.title || d.code })),
            ]}
            onChange={setDoc}
          />
          <Select
            label="Kind of passage"
            appearance="quiet"
            size="sm"
            value={kind}
            options={KINDS}
            onChange={setKind}
          />
          <Text size="sm" ariaLabel="Section" placeholder="Section, e.g. 5.6" value={section} onChange={setSection} />
        </div>
      </Row>
      <Row>
        {search.isError ? (
          <Banner tone="danger" title="The search failed">
            {search.error.message}
          </Banner>
        ) : asked.q ? (
          <List<Hit>
            label="Passages found"
            selection="none"
            divided
            density="two-line"
            loading={search.isPending}
            items={hits}
            getKey={(h) => `${h.docId}#${h.anchor}${h.via ?? ""}`}
            empty={<Hint>Nothing found with these settings.</Hint>}
            renderItem={(h) => ({
              title: (
                <>
                  <span {...stylex.props(type.code, styles.ref)}>
                    {h.docId}#{h.anchor}
                  </span>{" "}
                  {titleOf(h)}
                </>
              ),
              meta: whyLine(h),
            })}
          />
        ) : (
          <div {...stylex.props(styles.idle)}>
            <Hint>Each hit says why it ranked: word rank, model rank, reranker score, which forms matched.</Hint>
          </div>
        )}
      </Row>
    </Group>
  );
}
