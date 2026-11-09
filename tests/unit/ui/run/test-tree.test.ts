import { describe, expect, it } from "vitest";
import {
  keepTests,
  leavesOf,
  NO_PICK_FILTER,
  type PickTest,
  pickOptions,
  testTree,
  treeOrder,
} from "../../../../src/ui/screens/run/testTree.ts";

const t = (id: string, folder: string, o: Partial<PickTest> = {}): PickTest => ({
  id,
  summary: `Summary ${id}`,
  folder,
  labels: [],
  review: "validated",
  ...o,
});

const T = [
  t("local-b", "/Traction/Sectionneurs", { review: "draft", labels: ["j5"] }),
  t("K-10", "/Traction/Sectionneurs", { key: "K-10", labels: ["j5", "tk"] }),
  t("K-2", "/Traction/Disjoncteurs", { key: "K-2" }),
  t("root", "/", { summary: "Démarrage" }),
  t("K-9", "/Signal", { key: "K-9", review: "to-fix" }),
];

describe("New run's tree of tests", () => {
  it("files the tests by folder, subfolders first then tests, each level in natural order", () => {
    const tree = testTree(T);
    expect(tree.map((n) => n.key)).toEqual(["/Signal", "/Traction", "root"]);
    const traction = tree[1];
    expect(traction.kind === "branch" && traction.children.map((n) => n.key)).toEqual([
      "/Traction/Disjoncteurs",
      "/Traction/Sectionneurs",
    ]);
    expect(leavesOf(traction)).toEqual(["K-2", "K-10", "local-b"]);
    expect(treeOrder(tree)).toEqual(["K-9", "K-2", "K-10", "local-b", "root"]);
  });

  it("keeps by words (accents aside), folder and below, label and review state", () => {
    const ids = (f: Partial<typeof NO_PICK_FILTER>) => keepTests(T, { ...NO_PICK_FILTER, ...f }).map((x) => x.id);
    expect(ids({ words: "demarrage" })).toEqual(["root"]);
    expect(ids({ words: "k-10" })).toEqual(["K-10"]);
    expect(ids({ folders: ["/Traction"] })).toEqual(["local-b", "K-10", "K-2"]);
    expect(ids({ folders: ["/Traction/Sect"] })).toEqual([]);
    expect(ids({ labels: ["tk", "nope"] })).toEqual(["K-10"]);
    expect(ids({ reviews: ["draft", "to-fix"] })).toEqual(["local-b", "K-9"]);
    expect(ids({ folders: ["/Traction"], reviews: ["validated"] })).toEqual(["K-10", "K-2"]);
  });

  it("each menu counts what it would show with the other filters on, its own left out", () => {
    const o = pickOptions(T, { ...NO_PICK_FILTER, reviews: ["validated"] });
    expect(o.folders).toEqual([
      { value: "/Signal", label: "/Signal", count: 0 },
      { value: "/Traction", label: "/Traction", count: 2 },
      { value: "/Traction/Disjoncteurs", label: "/Traction/Disjoncteurs", count: 1 },
      { value: "/Traction/Sectionneurs", label: "/Traction/Sectionneurs", count: 1 },
    ]);
    expect(o.labels).toEqual([
      { value: "j5", label: "j5", count: 1 },
      { value: "tk", label: "tk", count: 1 },
    ]);
    expect(o.reviews.map((r) => [r.value, r.count])).toEqual([
      ["validated", 3],
      ["draft", 1],
      ["to-fix", 1],
    ]);
  });
});
