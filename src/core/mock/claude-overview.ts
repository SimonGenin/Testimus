import { OVERVIEW_MARKER } from "../claude/overview.ts";
import type { ClaudeSpawn } from "../env.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { formatOverview, overviewFile, readOverview, sectionsOf } from "../lib/overview.ts";
import { mockStream, registerMockScript } from "./claude.ts";

type Listed = { id: string; title: string; facts: string; outline: string };

// ponytail: the documents the prompt gives — « - <id> — « title » (facts) », then its « Outline: » line
function listed(prompt: string): Listed[] {
  const out: Listed[] = [];
  for (const l of prompt.split("\n")) {
    const d = /^- (\S+) — « (.*) » \((.*)\)$/.exec(l);
    if (d) out.push({ id: d[1], title: d[2], facts: d[3], outline: "" });
    const o = /^ {2}Outline: (.*)$/.exec(l);
    if (o && out.length) out[out.length - 1].outline = o[1];
  }
  return out;
}

const changed = (prompt: string, word: string) =>
  [...prompt.matchAll(new RegExp(`^- ${word}[^:]*: (\\S+) — « (.*) »$`, "gm"))].map((m) => ({ id: m[1], title: m[2] }));

function docSection(d: Listed, again = false): string {
  const first = d.outline.split(" · ").slice(0, 3).join(", ");
  const what = /observed/.test(d.facts)
    ? "Des photos ou une vidéo du système réel : elles montrent ce qu'il fait, pas ce qu'il doit faire."
    : `Document ${d.facts.split(" · ").slice(0, 2).join(", ")}.`;
  return [
    `## ${d.title} <!-- doc ${d.id} -->`,
    "",
    `${what}${first ? ` On y trouve ${first}.` : ""}${again ? " Converti à nouveau : son plan a été relu." : ""}`,
    "",
  ].join("\n");
}

const corpus = (n: number) =>
  ["## Le corpus", "", `${n} document${n > 1 ? "s" : ""} décrivent le poste de commande et ce qu'on y voit.`, ""].join(
    "\n",
  );

function fullText(docs: Listed[]): string {
  const links =
    docs.length > 1
      ? `« ${docs[0].title} » et « ${docs[1].title} » décrivent le même poste de commande, chacun de son côté.`
      : "Un seul document pour l'instant : pas encore de lien.";
  return [
    ...docs.map((d) => docSection(d)),
    corpus(docs.length),
    "## Les liens",
    "",
    links,
    "",
    "## Les amendements",
    "",
    "Aucun document n'en amende un autre.",
    "",
    "## Ce qui se contredit",
    "",
    "Rien de relevé pour l'instant.",
    "",
  ].join("\n");
}

// ponytail: an update in place, as Edit would do it — the sections of the documents that changed, « Le corpus » and
// « Les liens » for the documents added; every other line kept as it was
function updated(cwd: string, prompt: string): string {
  const { meta, body } = readOverview(cwd);
  const docs = listed(prompt);
  const added = changed(prompt, "added");
  const again = new Set(changed(prompt, "converted again").map((c) => c.id));
  const gone = new Set(changed(prompt, "removed").map((c) => c.id));
  const sections = sectionsOf(body).filter((s) => !(s.doc && gone.has(s.doc)));
  const text = sections.map((s) => {
    const d = s.doc && again.has(s.doc) ? docs.find((x) => x.id === s.doc) : undefined;
    if (d) return `${docSection(d, true)}\n`;
    const heading = s.key ? `## ${s.doc ? `${s.title} <!-- doc ${s.doc} -->` : s.title}\n` : "";
    if (s.title === "Le corpus") return `${corpus(sections.filter((x) => x.doc).length + added.length)}\n`;
    if (s.title === "Les liens" && added.length)
      return `${heading}${s.text.replace(/\n*$/, "\n")}${added.map((a) => `« ${a.title} » vient d'être ajouté : il complète les autres documents.`).join("\n")}\n\n`;
    return `${heading}${s.text}`;
  });
  const fresh = added.flatMap((a) => {
    const d = docs.find((x) => x.id === a.id);
    return d ? [`${docSection(d)}\n`] : [];
  });
  const at = sections.findIndex((s) => !s.doc && s.key);
  const parts = at < 0 ? [...text, ...fresh] : [...text.slice(0, at), ...fresh, ...text.slice(at)];
  return formatOverview(meta, parts.join(""));
}

registerMockScript(
  (prompt) => prompt.startsWith(OVERVIEW_MARKER),
  (spawn: ClaudeSpawn) => {
    const full = spawn.stdin.includes("to write docs/OVERVIEW.md");
    const file = overviewFile(spawn.cwd);
    const write = () => writeAtomic(file, full ? fullText(listed(spawn.stdin)) : updated(spawn.cwd, spawn.stdin));
    const reply = full
      ? "J'ai écrit une section par document, puis le corpus, les liens, les amendements et ce qui se contredit."
      : "J'ai mis à jour les sections des documents qui ont changé, le corpus et les liens ; le reste est tel quel.";
    return mockStream(spawn, {
      delayMs: 40,
      tools: [
        { name: "Read", input: { file_path: "docs/OVERVIEW.md" } },
        { name: "mcp__testimus__docs_list", input: {} },
        { name: full ? "Write" : "Edit", input: { file_path: "docs/OVERVIEW.md" }, does: write },
      ],
      texts: [reply],
      result: reply,
    });
  },
);
