import { MEDIA_MARKER, MEDIA_TAG } from "../claude/media.ts";
import { mockStream, registerMockScript } from "./claude.ts";

// ponytail: the scripted reading of a batch — each photo is « seen » as a screen of the TCO with two labels, and
// illustrates the first section of the outline whose title names a sectionneur (else none)
registerMockScript(
  (prompt) => prompt.startsWith(MEDIA_MARKER),
  (spawn) => {
    const photos = [...spawn.stdin.matchAll(/^- (fig:lot-\S+) — (\S+) — (.+?)(?: — taken .*)?$/gm)];
    const section = /^- (§\S+) .*[Ss]ectionneur/m.exec(spawn.stdin)?.[1];
    const out: Record<string, unknown> = {};
    for (const [, anchor, , name] of photos)
      out[anchor] = {
        description: `Photo simulée de ${name} : la fenêtre Propriétés d'un sectionneur est ouverte sur le TCO, son menu contextuel propose « Autoriser l'ouverture ».`,
        labels: ["Propriétés", "Autoriser l'ouverture"],
        kind: "screen",
        sections: section ? [section] : [],
      };
    const reply = ["```" + MEDIA_TAG, JSON.stringify(out, null, 2), "```"].join("\n");
    return mockStream(spawn, {
      tools: photos.map(([, , file]) => ({ name: "Read", input: { file_path: file } })),
      texts: [reply],
      result: reply,
      costUsd: 0.0274,
      delayMs: 40,
    });
  },
);
