import { MEDIA_MARKER, MEDIA_TAG, SURVEY_MARKER, SURVEY_TAG } from "../claude/media.ts";
import { clock } from "../rag/anchors.ts";
import { mockStream, registerMockScript } from "./claude.ts";

// ponytail: the scripted reading of pictures — each image or key frame is « seen » as a screen of the TCO with two
// labels; a picture named in the prompt by a file name that speaks of an alarm shows the alarm banner
registerMockScript(
  (prompt) => prompt.startsWith(MEDIA_MARKER),
  (spawn) => {
    const pictures = [...spawn.stdin.matchAll(/^- ((?:img|frame):\S+) — (\S+) — (.+?)(?: — taken .*)?$/gm)];
    const out: Record<string, unknown> = {};
    for (const [, anchor, , name] of pictures)
      out[anchor] = {
        description: `Image simulée de ${name} : la fenêtre Propriétés d'un sectionneur est ouverte sur le TCO, son menu contextuel propose « Autoriser l'ouverture ».`,
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

// ponytail: the scripted survey of a video — a chapter every quarter of its tiles, and three moments to see: the
// second tile, the middle one, the last one
registerMockScript(
  (prompt) => prompt.startsWith(SURVEY_MARKER),
  (spawn) => {
    const mosaics = [...spawn.stdin.matchAll(/^- (\S+mosaic-\d+\.jpg) — tiles (.+)$/gm)];
    const tiles = mosaics.flatMap(([, , list]) => [...list.matchAll(/(\d+) ((?:\d+:)?\d{2}:\d{2})/g)].map((m) => m[2]));
    const titles = [
      "Ouverture du poste et connexion",
      "Sélection du sectionneur S12 sur le synoptique",
      "Menu contextuel et fenêtre Propriétés",
      "Refus de manœuvre, message d'alarme",
    ];
    const quarter = Math.max(1, Math.ceil(tiles.length / titles.length));
    const chapters = titles
      .map((title, i) => ({ at: i === 0 ? clock(0) : tiles[i * quarter], title }))
      .filter((c) => c.at);
    const picks = [tiles[1], tiles[Math.floor(tiles.length / 2)], tiles.at(-1)].filter(
      (t, i, all): t is string => !!t && all.indexOf(t) === i,
    );
    const moments = picks.map((at, i) => ({
      at,
      why: ["Le synoptique avec le sectionneur S12", "Le menu contextuel ouvert", "Le message de refus"][i] ?? "",
    }));
    const reply = ["```" + SURVEY_TAG, JSON.stringify({ chapters, moments }, null, 2), "```"].join("\n");
    return mockStream(spawn, {
      tools: mosaics.map(([, file]) => ({ name: "Read", input: { file_path: file } })),
      texts: [reply],
      result: reply,
      costUsd: 0.0312,
      delayMs: 40,
    });
  },
);
