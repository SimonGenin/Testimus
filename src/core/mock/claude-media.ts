import { GLOSSARY_MARKER, GLOSSARY_TAG } from "../claude/glossary.ts";
import {
  CHAPTERS_TAG,
  FIXES_MARKER,
  FIXES_TAG,
  MEDIA_MARKER,
  MEDIA_TAG,
  PLAN_MARKER,
  SURVEY_MARKER,
  SURVEY_TAG,
  TRANSLATE_MARKER,
  TRANSLATE_TAG,
} from "../claude/media.ts";
import { clock, momentOf } from "../rag/anchors.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const SEEN = [
  "Le synoptique de traction est affiché, le sectionneur S12 est visible entre les deux sous-stations.",
  "Le menu contextuel du sectionneur S12 s'ouvre : seul « Propriétés » est proposé.",
  "La fenêtre Propriétés passe au premier plan, le sectionneur est indiqué fermé, sans télécommande.",
  "Le bandeau d'alarmes affiche le refus de manœuvre, le voyant du sectionneur S12 devient rouge.",
];

// ponytail: the scripted reading of pictures — each image is « seen » as a screen of the TCO with two labels; the key
// frames of a video, in time order, each say what changed since the one before
registerMockScript(
  (prompt) => prompt.startsWith(MEDIA_MARKER),
  (spawn) => {
    const pictures = [...spawn.stdin.matchAll(/^- ((?:img|frame):\S+) — (\S+) — (.+?)(?: — taken .*)?$/gm)];
    const out: Record<string, unknown> = {};
    let frame = 0;
    for (const [, anchor, , name] of pictures)
      out[anchor] = {
        description: anchor.startsWith("frame:")
          ? SEEN[frame++ % SEEN.length]
          : `Image simulée de ${name} : la fenêtre Propriétés d'un sectionneur est ouverte sur le TCO, son menu contextuel propose « Autoriser l'ouverture ».`,
        labels: ["Propriétés", "Autoriser l'ouverture"],
        kind: "screen",
      };
    const reply = ["```" + MEDIA_TAG, JSON.stringify(out, null, 2), "```"].join("\n");
    return mockStream(spawn, {
      tools: pictures.map(([, , file]) => ({ name: "Read", input: { file_path: file } })),
      texts: [reply],
      result: reply,
      costUsd: 0.0274,
      delayMs: 40,
    });
  },
);

const TITLES = [
  "Ouverture du poste et connexion",
  "Sélection du sectionneur S12 sur le synoptique",
  "Menu contextuel et fenêtre Propriétés",
  "Refus de manœuvre, message d'alarme",
];

const lengthOf = (prompt: string) => momentOf(/» \(((?:\d+:)?\d{1,2}:\d{2})\)/.exec(prompt)?.[1] ?? "")?.at ?? 0;
const chaptersOf = (length: number) =>
  TITLES.map((title, i) => ({ at: clock(Math.floor((i * length) / TITLES.length)), title })).filter(
    (c, i, all) => i === 0 || c.at !== all[i - 1].at,
  );

// ponytail: the scripted plan of a video — four chapters, a quarter of its length each
registerMockScript(
  (prompt) => prompt.startsWith(PLAN_MARKER),
  (spawn) => {
    const said = /is in (\S+said\.txt)/.exec(spawn.stdin)?.[1];
    const chapters = chaptersOf(lengthOf(spawn.stdin));
    const reply = ["```" + SURVEY_TAG, JSON.stringify({ chapters }, null, 2), "```"].join("\n");
    return mockStream(spawn, {
      tools: said ? [{ name: "Read", input: { file_path: said } }] : [],
      texts: [reply],
      result: reply,
      costUsd: 0.0188,
      delayMs: 40,
    });
  },
);

// ponytail: the scripted survey of a part of a video — its second tile is the moment to keep (its first when it has
// one tile); of a whole video, the four chapters of the plan and the second tile of each
registerMockScript(
  (prompt) => prompt.startsWith(SURVEY_MARKER),
  (spawn) => {
    const mosaics = [...spawn.stdin.matchAll(/^- (\S+mosaic-\d+-\d+\.jpg) — tiles (.+)$/gm)];
    const tiles = mosaics.flatMap(([, , list]) => [...list.matchAll(/(\d+) ((?:\d+:)?\d{2}:\d{2})/g)].map((m) => m[2]));
    const part = /Part to survey: « (.*?) »/.exec(spawn.stdin)?.[1] ?? "";
    const pick = (ts: string[], why: string) => (ts.length ? [{ at: ts[1] ?? ts[0], why }] : []);
    const length = lengthOf(spawn.stdin);
    const chapters = spawn.stdin.includes("To survey: the whole video.") ? chaptersOf(length) : null;
    const second = (m: string) => momentOf(m)?.at ?? 0;
    const moments = chapters
      ? chapters.flatMap((c, i) => {
          const to = chapters[i + 1] ? second(chapters[i + 1].at) : length + 1;
          return pick(
            tiles.filter((t) => second(t) >= second(c.at) && second(t) < to),
            c.title,
          );
        })
      : pick(tiles, part);
    const reply = [
      ...(chapters ? ["```" + CHAPTERS_TAG, JSON.stringify(chapters, null, 2), "```"] : []),
      "```" + SURVEY_TAG,
      JSON.stringify({ moments }, null, 2),
      "```",
    ].join("\n");

    return mockStream(spawn, {
      tools: mosaics.map(([, file]) => ({ name: "Read", input: { file_path: file } })),
      texts: [reply],
      result: reply,
      costUsd: 0.0312,
      delayMs: 40,
    });
  },
);

// ponytail: the scripted translation — the German sentence of the made-up video in French, any other line marked as
// a translation
registerMockScript(
  (prompt) => prompt.startsWith(TRANSLATE_MARKER),
  (spawn) => {
    const lines = [...spawn.stdin.matchAll(/^- ((?:\d+:)?\d{2}:\d{2}) · [^·]+ · (.+)$/gm)];
    const out: Record<string, string> = {};
    for (const [, key, text] of lines)
      out[key] = text.includes("Trennschalter")
        ? "Bon, refermez maintenant le sectionneur S12, s'il vous plaît."
        : `(traduction) ${text}`;
    const reply = ["```" + TRANSLATE_TAG, JSON.stringify(out, null, 2), "```"].join("\n");
    return mockStream(spawn, { tools: [], texts: [reply], result: reply, costUsd: 0.0061, delayMs: 40 });
  },
);

// ponytail: the scripted proposals — the first line the engine doubted gets one, from the glossary
registerMockScript(
  (prompt) => prompt.startsWith(FIXES_MARKER),
  (spawn) => {
    const unsure = /^- ((?:\d+:)?\d{2}:\d{2}) · unsure · (.+)$/m.exec(spawn.stdin);
    const out = unsure
      ? [
          {
            at: unsure[1],
            text: unsure[2].replace("refus de manœuvre", "refus de manœuvre S12"),
            clue: "glossary",
            why: "Le glossaire du projet nomme le sectionneur S12 ; l'écran l'affiche au même moment.",
          },
        ]
      : [];
    const reply = ["```" + FIXES_TAG, JSON.stringify(out, null, 2), "```"].join("\n");
    return mockStream(spawn, { tools: [], texts: [reply], result: reply, costUsd: 0.0093, delayMs: 40 });
  },
);

// ponytail: the scripted glossary — the candidates the prompt names, the first twelve, with the fixture's sectionneur
registerMockScript(
  (prompt) => prompt.startsWith(GLOSSARY_MARKER),
  (spawn) => {
    const found = /^Candidates counted in the documents, most used first: (.+)$/m.exec(spawn.stdin)?.[1] ?? "";
    const terms = [...new Set(["S12", "Sectionneur", ...found.split(", ").filter((t) => t && t !== "(none)")])];
    const reply = [
      "Kept the codes and the equipment the videos name.",
      "```" + GLOSSARY_TAG,
      JSON.stringify(terms.slice(0, 12)),
      "```",
    ].join("\n");
    return mockStream(spawn, { tools: [], texts: [reply], result: reply, costUsd: 0.0071, delayMs: 40 });
  },
);
