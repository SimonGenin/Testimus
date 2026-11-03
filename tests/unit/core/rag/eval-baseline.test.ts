import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import type { EvalReport } from "../../../../src/core/rag/eval.ts";
import { call, fixtureCopy } from "../registry.ts";

// ponytail: the numbers rag.eval gave on the fixture project before the core-rag rewrite (GOAL-V3 wave 2); the same
// call must give the same numbers after it. bm25 is the lexical mode (no model); hybrid runs on the --mock runtime.
let dir: string;
const realMock = env.mock;

beforeEach(() => {
  dir = fixtureCopy("eval-baseline");
  env.mock = true;
});

afterEach(() => {
  env.mock = realMock;
  rmSync(dir, { recursive: true, force: true });
});

function numbers(r: EvalReport) {
  return {
    setting: r.setting,
    provisional: r.provisional,
    chunker: r.config.chunker,
    corpus: r.config.corpus,
    set: { hash: r.config.set.hash, behaviors: r.config.set.behaviors },
    retrieval: r.config.retrieval,
    policies: r.policies.map((p) => ({ name: p.name, available: p.available, totals: p.totals })),
    behaviors: r.behaviors.map((b) => ({
      id: b.id,
      must: b.must,
      rank: b.rank,
      policies: Object.fromEntries(
        Object.entries(b.policies).map(([name, s]) => [
          name,
          { atK: s?.atK, roles: s?.roles, found: s?.found, ndcg10: s?.ndcg10, mrr: s?.mrr, rank: s?.rank },
        ]),
      ),
    })),
  };
}

describe("rag.eval on the fixture project gives the numbers it gave before the rewrite", () => {
  it("in bm25 mode", async () => {
    const r = await call<EvalReport>("rag.eval", { mode: "bm25" }, dir, { wait: true });
    expect(numbers(r)).toMatchInlineSnapshot(`
      {
        "behaviors": [
          {
            "id": "sectionneur-sans-tk-menu",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "exception": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 5131,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 5131,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 5131,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "exception": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "sectionneur-proprietes",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 1973,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 3416,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 3416,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 3416,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "sectionneur-symbole",
            "must": 2,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2073,
                    "complete": true,
                    "items": 6,
                    "precision": 0.3333333333333333,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2073,
                    "complete": true,
                    "items": 6,
                    "precision": 0.3333333333333333,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2073,
                    "complete": true,
                    "items": 6,
                    "precision": 0.3333333333333333,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 5053,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 5053,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 5053,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "menus-disjoncteur-signal",
            "must": 2,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 1854,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 1854,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 1854,
                    "complete": true,
                    "items": 5,
                    "precision": 0.4,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 2,
                      "20": 2,
                      "50": 2,
                    },
                    "n": 2,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 3385,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 3385,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 3385,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 2,
                      "20": 2,
                      "50": 2,
                    },
                    "n": 2,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "tco-deux-rangs",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 1410,
                    "complete": true,
                    "items": 2,
                    "precision": 0.5,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 1410,
                    "complete": true,
                    "items": 2,
                    "precision": 0.5,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 1410,
                    "complete": true,
                    "items": 2,
                    "precision": 0.5,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 2905,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2905,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2905,
                    "complete": true,
                    "items": 5,
                    "precision": 0.2,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
        ],
        "chunker": "3d49c9729806d737",
        "corpus": "d5b8509deafc876e",
        "policies": [
          {
            "available": true,
            "name": "search",
            "totals": {
              "atK": {
                "10": {
                  "chars": 1856.6,
                  "complete": 1,
                  "precision": 0.3666666666666667,
                  "recall": 1,
                },
                "20": {
                  "chars": 1856.6,
                  "complete": 1,
                  "precision": 0.3666666666666667,
                  "recall": 1,
                },
                "50": {
                  "chars": 1856.6,
                  "complete": 1,
                  "precision": 0.3666666666666667,
                  "recall": 1,
                },
              },
              "byRole": {
                "definition": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "exception": {
                  "n": 1,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "figure": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "rule": {
                  "n": 3,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
              },
              "mrr": 1,
              "n": 5,
              "ndcg10": 1,
            },
          },
          {
            "available": true,
            "name": "search+graph",
            "totals": {
              "atK": {
                "10": {
                  "chars": 3978,
                  "complete": 1,
                  "precision": 0.26857142857142857,
                  "recall": 1,
                },
                "20": {
                  "chars": 3978,
                  "complete": 1,
                  "precision": 0.26857142857142857,
                  "recall": 1,
                },
                "50": {
                  "chars": 3978,
                  "complete": 1,
                  "precision": 0.26857142857142857,
                  "recall": 1,
                },
              },
              "byRole": {
                "definition": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "exception": {
                  "n": 1,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "figure": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "rule": {
                  "n": 3,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
              },
              "mrr": 1,
              "n": 5,
              "ndcg10": 1,
            },
          },
        ],
        "provisional": true,
        "retrieval": {
          "bm25Weights": [
            1,
            1,
            5,
          ],
          "candidates": 50,
          "expand": "none",
          "rerank": {
            "mode": "topk",
            "top": 30,
          },
          "rrfK": 60,
        },
        "set": {
          "behaviors": 5,
          "hash": "c61229ad1b2bc23c",
        },
        "setting": "bge-m3-q8-bm25",
      }
    `);
  });

  it("in hybrid mode on the mock runtime", async () => {
    const r = await call<EvalReport>("rag.eval", {}, dir, { wait: true });
    expect(numbers(r)).toMatchInlineSnapshot(`
      {
        "behaviors": [
          {
            "id": "sectionneur-sans-tk-menu",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "exception": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 5983,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 5983,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 5983,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "exception": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "sectionneur-proprietes",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 4268,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 4268,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 4268,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "sectionneur-symbole",
            "must": 2,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 5364,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 5364,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 5364,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#fig:40",
                    "SOSIE_211_D401-1_3#§5.6.6",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                  "figure": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "menus-disjoncteur-signal",
            "must": 2,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 2,
                      "20": 2,
                      "50": 2,
                    },
                    "n": 2,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 4370,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 4370,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 4370,
                    "complete": true,
                    "items": 7,
                    "precision": 0.2857142857142857,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5.6.7",
                    "SOSIE_211_D401-1_4#§4.2",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "rule": {
                    "found": {
                      "10": 2,
                      "20": 2,
                      "50": 2,
                    },
                    "n": 2,
                  },
                },
              },
            },
            "rank": 1,
          },
          {
            "id": "tco-deux-rangs",
            "must": 1,
            "policies": {
              "search": {
                "atK": {
                  "10": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 2231,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
              "search+graph": {
                "atK": {
                  "10": {
                    "chars": 4958,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "20": {
                    "chars": 4958,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                  "50": {
                    "chars": 4958,
                    "complete": true,
                    "items": 7,
                    "precision": 0.14285714285714285,
                    "recall": 1,
                  },
                },
                "found": {
                  "10": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "20": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                  "50": [
                    "SOSIE_211_D401-1_3#§5",
                  ],
                },
                "mrr": 1,
                "ndcg10": 1,
                "rank": 1,
                "roles": {
                  "definition": {
                    "found": {
                      "10": 1,
                      "20": 1,
                      "50": 1,
                    },
                    "n": 1,
                  },
                },
              },
            },
            "rank": 1,
          },
        ],
        "chunker": "3d49c9729806d737",
        "corpus": "d5b8509deafc876e",
        "policies": [
          {
            "available": true,
            "name": "search",
            "totals": {
              "atK": {
                "10": {
                  "chars": 2231,
                  "complete": 1,
                  "precision": 0.22857142857142856,
                  "recall": 1,
                },
                "20": {
                  "chars": 2231,
                  "complete": 1,
                  "precision": 0.22857142857142856,
                  "recall": 1,
                },
                "50": {
                  "chars": 2231,
                  "complete": 1,
                  "precision": 0.22857142857142856,
                  "recall": 1,
                },
              },
              "byRole": {
                "definition": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "exception": {
                  "n": 1,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "figure": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "rule": {
                  "n": 3,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
              },
              "mrr": 1,
              "n": 5,
              "ndcg10": 1,
            },
          },
          {
            "available": true,
            "name": "search+graph",
            "totals": {
              "atK": {
                "10": {
                  "chars": 4988.6,
                  "complete": 1,
                  "precision": 0.2571428571428571,
                  "recall": 1,
                },
                "20": {
                  "chars": 4988.6,
                  "complete": 1,
                  "precision": 0.2571428571428571,
                  "recall": 1,
                },
                "50": {
                  "chars": 4988.6,
                  "complete": 1,
                  "precision": 0.2571428571428571,
                  "recall": 1,
                },
              },
              "byRole": {
                "definition": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "exception": {
                  "n": 1,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "figure": {
                  "n": 2,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
                "rule": {
                  "n": 3,
                  "recall": {
                    "10": 1,
                    "20": 1,
                    "50": 1,
                  },
                },
              },
              "mrr": 1,
              "n": 5,
              "ndcg10": 1,
            },
          },
        ],
        "provisional": true,
        "retrieval": {
          "bm25Weights": [
            1,
            1,
            5,
          ],
          "candidates": 50,
          "expand": "none",
          "rerank": {
            "mode": "topk",
            "top": 30,
          },
          "rrfK": 60,
        },
        "set": {
          "behaviors": 5,
          "hash": "c61229ad1b2bc23c",
        },
        "setting": "bge-m3-q8-hybrid",
      }
    `);
  });
});
