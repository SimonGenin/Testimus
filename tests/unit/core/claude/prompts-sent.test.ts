import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triage } from "../../../../src/core/claude/actions.ts";
import { checkOne } from "../../../../src/core/claude/check.ts";
import { describeFigures } from "../../../../src/core/claude/figures.ts";
import { fixTest } from "../../../../src/core/claude/fix.ts";
import { claudeHeaders } from "../../../../src/core/claude/headers.ts";
import { analyseLot } from "../../../../src/core/claude/media.ts";
import { contextDir, docRunLines } from "../../../../src/core/claude/prompt.ts";
import { checkSignedIn, resetProbe } from "../../../../src/core/claude/status.ts";
import { checkConversion, studyDoc } from "../../../../src/core/claude/study.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { readDoc } from "../../../../src/core/lib/docs.ts";
import { claudeLoginCheck } from "../../../../src/core/lib/doctor.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import type { Chunk } from "../../../../src/core/types.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { call } from "../registry.ts";
import { dir, fake, result, seen } from "./run-fakes.ts";

// ponytail: what each Claude run is sent, word for word, for one fixed input — recorded before the prompts became
// templates (claude.prompts), so the refactor is proven to send the same text; a deliberate prompt change updates the
// files (vitest -u) and the diff shows it

const D3 = "SOSIE_211_D401-1_3";
const TEST = "LFRPS12-1420";
const plan =
  '```test-plan\n{"tests": [{"summary": "Ouvrir le sectionneur", "technique": "state", "sections": ["SOSIE_211_D401-1_3#§5.6.6"]}]}\n```';

const sent = () =>
  seen
    .map((s) => s.stdin)
    .join("\n=====\n")
    .replaceAll(dir.replaceAll("\\", "/"), "<project>")
    .replaceAll(dir, "<project>")
    .replace(/run-\d{14}-[0-9a-f]{6}/g, "<runId>")
    .replace(/act-\d{14}-[0-9a-f]{6}/g, "<actionId>");

function setup() {
  resetProbe();
  const spec = contextDir(dir, "spec");
  writeContextMd(spec, { name: "Spec notes", paths: ["D:/specs"], notes: "Some notes" });
  mkdirSync(join(spec, "files"), { recursive: true });
  writeFileSync(join(spec, "files", "a.pdf"), "");
  fake((s) =>
    s.stdin.includes("Use the generate-tests skill") && !s.stdin.includes("This is test")
      ? { lines: () => [result(plan)] }
      : {},
  );
}

const file = (name: string) => `./prompts-sent/${name}.txt`;
const RUN = { note: "Use the 2024 wording.", conversation: "Q: which test?\nA: LFRPS12-1420." };

describe("the prompts the Claude runs send", () => {
  it("claude.run on a step, a test, several tests and the project", async () => {
    setup();
    const ask = { prompt: "Rephrase in house style", contexts: ["spec"], ...RUN };
    await call("claude.run", { scope: { kind: "step", testId: TEST, step: 2 }, ...ask }, dir);
    await call("claude.run", { scope: { kind: "test", testId: TEST }, ...ask }, dir);
    await call("claude.run", { scope: { kind: "tests", testIds: [TEST, "LFRPS12-1398"] }, ...ask }, dir);
    await call("claude.run", { scope: { kind: "project" }, ...ask }, dir);
    await expect(sent()).toMatchFileSnapshot(file("claude-run"));
  });

  it("a generation, planned then written one test per run", async () => {
    setup();
    await call(
      "gen.tests",
      { request: "Le sectionneur", docs: [D3], check: false, contexts: ["spec"], note: RUN.note, folder: "/Traction" },
      dir,
    );
    await expect(sent()).toMatchFileSnapshot(file("generate"));
  });

  it("the semantic check and the fix of a test", async () => {
    setup();
    await checkOne(quietCtx(dir), dir, TEST, true);
    await fixTest(quietCtx(dir), dir, "LFRPS12-1398", { note: "Step 2 must name the commands.", semantic: false });
    await expect(sent()).toMatchFileSnapshot(file("check-fix"));
  });

  it("a question on the documents, and a question on a problem", async () => {
    setup();
    await call("chat.ask", { question: "Quand le sectionneur s'ouvre-t-il ?", contexts: ["spec"], ...RUN }, dir);
    await call(
      "chat.ask",
      { question: "Why?", problem: { where: "Documents", text: "The index is missing." }, contexts: ["spec"] },
      dir,
    );
    await expect(sent()).toMatchFileSnapshot(file("chat"));
  });

  it("a comment draft and the smart columns", async () => {
    setup();
    await call("claude.draftComment", { key: TEST, ask: "Say step 2 is fixed", contexts: ["spec"] }, dir);
    await call("columns.suggest", { ask: "Add a requirement column", contexts: ["spec"] }, dir);
    await expect(sent()).toMatchFileSnapshot(file("comment-columns"));
  });

  it("a Claude action and a triage", async () => {
    setup();
    const a = await call<{ id: string }>(
      "actions.propose",
      {
        where: `test:${TEST}`,
        problem: "Step 2 has no source.",
        title: "Add the missing source",
        why: "The passage is in §5.6.6.",
        plan: ["Find the passage", "Add the source line"],
        scope: { kind: "step", testId: TEST, step: 2 },
        model: "sonnet",
        effort: "low",
      },
      dir,
    );
    await call("actions.run", { id: a.id, contexts: ["spec"], ...RUN }, dir);
    await call("actions.triage", { docId: D3, note: RUN.note }, dir);
    await triage(
      quietCtx(dir),
      dir,
      [{ where: `doc:${D3}`, text: "Figure 41 has no picture." }],
      `the document ${D3}`,
      {},
      "import",
      docRunLines(dir, D3, { note: RUN.note, contexts: ["spec"] }),
    );
    await expect(sent()).toMatchFileSnapshot(file("actions"));
  });

  it("the document runs: study, conversion check, figures, headers, photos", async () => {
    setup();
    const doc = readDoc(dir, D3);
    const claude = { note: RUN.note, contexts: ["spec"] };
    await studyDoc(quietCtx(dir), dir, doc, { pages: 12, headings: 30 }, claude);
    await checkConversion(quietCtx(dir), dir, { ...doc, conversion: { reader: "tagged" } }, claude);
    await describeFigures(dir, D3, quietCtx(dir), { force: true, ...claude });
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, claudeHeaders: true } });
    const chunk = (id: string, text: string) =>
      ({ id, docId: D3, anchor: "§5.6.6", path: "5.6.6 Sectionneur", header: `${D3} › 5.6.6`, text }) as Chunk;
    await claudeHeaders(
      doc,
      [chunk(`${D3}#§5.6.6`, "Le sectionneur s'ouvre."), chunk(`${D3}#§5.6.7`, "x".repeat(1300))],
      new AbortController().signal,
      dir,
      { note: RUN.note },
    );
    await analyseLot(dir, D3, "recette-tco-12-10", quietCtx(dir), { force: true, ...claude });
    await expect(sent()).toMatchFileSnapshot(file("documents"));
  });

  it("the sign-in checks", async () => {
    setup();
    await checkSignedIn();
    await claudeLoginCheck(5000);
    await expect(sent()).toMatchFileSnapshot(file("sign-in"));
  });
});
