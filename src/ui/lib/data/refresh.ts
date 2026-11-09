import type { Prefix } from "./query.ts";

type Rule = [pattern: RegExp, keys: (m: RegExpMatchArray) => Prefix[]];

// ponytail: a file changed in the project → the reads that show it (the files are the state)
const PATHS: Rule[] = [
  [
    /^tests\/([^/]+)\/test\.md$/,
    (m) => [
      ["tests.show", { id: m[1] }],
      ["check.show", { id: m[1] }],
      ["analysis.show", { id: m[1] }],
      ["claude.before", { testId: m[1] }],
      ["tests.list"],
      ["review.queue"],
      ["xray.plan", { id: m[1] }],
      ["search.all"],
      ["project.info"],
      ["gen.preview"],
    ],
  ],
  [
    /^tests\/([^/]+)\/\.remote\.md$/,
    (m) => [
      ["tests.show", { id: m[1] }],
      ["claude.before", { testId: m[1] }],
      ["tests.list"],
      ["xray.plan", { id: m[1] }],
      ["xray.status", { id: m[1] }],
    ],
  ],
  [
    /^tests\/([^/]+)\/check\.json$/,
    (m) => [["check.show", { id: m[1] }], ["tests.show", { id: m[1] }], ["review.queue"], ["tests.list"]],
  ],
  [/^tests\/([^/]+)\/analysis\.json$/, (m) => [["analysis.show", { id: m[1] }]]],
  [/^tests\/([^/]+)\/images\//, (m) => [["tests.show", { id: m[1] }]]],
  [
    /^tests\/([^/]+)\/local\.json$/,
    (m) => [
      ["contexts.ofTest", { testId: m[1] }],
      ["tests.folds", { id: m[1] }],
    ],
  ],
  [/^tests\/([^/]+)\/\.state\.json$/, (m) => [["tests.show", { id: m[1] }], ["tests.list"]]],
  [
    /^tests\/([^/]+)(\/|$)/,
    (m) => [["tests.show", { id: m[1] }], ["tests.list"], ["review.queue"], ["project.info"], ["gen.preview"]],
  ],
  [/^docs\/OVERVIEW\.md$/, () => [["docs.overviewShow"], ["claude.prompts"]]],
  [
    /^docs\/([^/]+)\/doc\.json$/,
    (m) => [
      ["docs.overviewShow"],
      ["docs.list"],
      ["docs.show", { id: m[1] }],
      ["rag.status"],
      ["project.info"],
      ["rag.passage"],
      ["gen.preview"],
      ["media.show", { doc: m[1] }],
    ],
  ],
  [
    /^docs\/([^/]+)\/(doc\.md|figures|figures\.json)/,
    (m) => [
      ["docs.show", { id: m[1] }],
      ["rag.passage"],
      ["rag.figure"],
      ["docs.page"],
      ["docs.list"],
      ["media.show", { doc: m[1] }],
    ],
  ],
  [/^docs\/([^/]+)\/context\.md$/, (m) => [["docs.show", { id: m[1] }]]],
  [
    /^docs\/([^/]+)\/(video|files)\//,
    (m) => [
      ["media.show", { doc: m[1] }],
      ["media.transcript", { doc: m[1] }],
      ["docs.show", { id: m[1] }],
    ],
  ],
  [
    /^docs\/([^/]+)(\/|$)/,
    () => [["docs.list"], ["rag.status"], ["project.info"], ["gen.preview"], ["docs.overviewShow"]],
  ],
  [
    /^project\.json$/,
    () => [
      ["project.info"],
      ["contexts.ofProject"],
      ["contexts.ofTest"],
      ["models.packs"],
      ["models.usage"],
      ["models.advice"],
      ["rag.status"],
      ["system.doctor"],
      ["claude.prompts"],
      ["docs.overviewShow"],
    ],
  ],
  [/^(xray|columns)\.json$/, () => [["project.info"], ["columns.list"]]],
  [/^CLAUDE\.md$/, () => [["project.notes"], ["claude.prompts"]]],
  [/^\.claude\/skills\//, () => [["claude.prompts"]]],
  [
    /^contexts\//,
    () => [["contexts.list"], ["contexts.show"], ["contexts.ofTest"], ["contexts.ofProject"], ["claude.prompts"]],
  ],
  [/^\.testimus\/actions\//, () => [["actions.list"], ["actions.show"]]],
  [/^test-runs\/([^/]+)(\/|$)/, (m) => [["runs.list"], ["runs.show", { run: m[1] }], ["runs.history"]]],
];

// ponytail: what a finished job changed outside the project files (the index, the models folder, Jira)
const KINDS: Rule[] = [
  [
    /^rag-index$|^rag\.index$/,
    () => [
      ["rag.status"],
      ["rag.spaces"],
      ["docs.list"],
      ["docs.show"],
      ["search.all"],
      ["models.advice"],
      ["gen.preview"],
      ["system.doctor"],
    ],
  ],
  [/^search-index$/, () => [["search.all"]]],
  [/^update$/, () => [["system.updates"]]],
  [
    /^docs\.(add|addFiles|convert)$|^docs-|^describe-figures$/,
    () => [["docs.list"], ["docs.show"], ["media.show"], ["media.transcript"], ["rag.status"]],
  ],
  [/^docs\.overview$/, () => [["docs.overviewShow"], ["claude.prompts"]]],
  [/^generate$/, () => [["review.queue"], ["gen.preview"], ["gen.show"], ["actions.list"]]],
  [/^chat$/, () => [["chat.list"], ["chat.show"]]],
  [
    /^models-/,
    () => [
      ["models.list"],
      ["models.catalog"],
      ["models.packs"],
      ["models.usage"],
      ["models.advice"],
      ["models.hardware"],
      ["rag.status"],
      ["system.doctor"],
      ["models.dirs"],
      ["models.planPack"],
      ["models.planDir"],
    ],
  ],
  [/^agents-test$/, () => [["system.settings"]]],
  [/^push$/, () => [["xray.status"], ["xray.folders"], ["xray.search"]]],
  [/^pull$/, () => [["xray.search"]]],
];

export function keysOfPaths(paths: string[]): Prefix[] {
  const out: Prefix[] = [];
  for (const path of paths)
    for (const [re, keys] of PATHS) {
      const m = path.match(re);
      if (m) {
        out.push(...keys(m));
        break;
      }
    }
  return out;
}

export function keysOfKind(kind: string): Prefix[] {
  return KINDS.flatMap(([re, keys]) => {
    const m = kind.match(re);
    return m ? keys(m) : [];
  });
}
