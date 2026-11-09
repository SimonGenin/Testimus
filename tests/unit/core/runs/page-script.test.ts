import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { marksStatus, type StepMark } from "../../../../src/core/lib/runs.ts";
import { call, fixtureCopy } from "../registry.ts";

type Win = Window & typeof globalThis & Record<string, any>;
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: object) => { window: Win };
};

const RUN = "recette-j5-sectionneurs";
let project = "";
let out = "";

beforeAll(async () => {
  project = fixtureCopy("page-script");
  out = join(mkdtempSync(join(tmpdir(), "testimus-page-")), "pages");
  await call("runs.export", { run: RUN, dir: out }, project);
});
afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(join(out, ".."), { recursive: true, force: true });
});

// ponytail: the exported page as a browser without a server opens it — index.html and its run.js, in jsdom
function page(setup?: (w: Win) => void): Win {
  const script = readFileSync(join(out, "run.js"), "utf8");
  const html = readFileSync(join(out, "index.html"), "utf8").replace(
    '<script src="run.js"></script>',
    () => `<script>${script}</script>`,
  );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://pages.test/index.html",
    beforeParse: (w: Win) => setup?.(w),
  });
  return dom.window;
}

const button = (w: Window, name: string, within?: string) =>
  [...(within ? w.document.querySelector(`[aria-label="${within}"]`) : w.document)!.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.textContent?.includes(name),
  ) as HTMLButtonElement;
const settle = () => new Promise((ok) => setTimeout(ok, 20));
const checked = (w: Window) =>
  [...w.document.querySelectorAll('[role="radiogroup"] [role="radio"]')].find(
    (b) => b.getAttribute("aria-checked") === "true",
  )?.textContent;

describe("the exported page", () => {
  it("sets the result from the marks by the same rule as the core", () => {
    const w = page();
    const marks: (boolean | null)[] = [true, false, null];
    const lists: StepMark[][] = [[]];
    for (let n = 1; n <= 3; n++)
      for (const l of lists.filter((x) => x.length === n - 1)) for (const ok of marks) lists.push([...l, { ok }]);
    expect(lists).toHaveLength(40);
    for (const steps of lists) expect(w.marksStatus(steps), JSON.stringify(steps)).toBe(marksStatus(steps));
  });

  it("a change of the marks sets the result, a recorded one too; a result picked stands until the next mark", async () => {
    const w = page();
    await settle();
    expect(checked(w)).toContain("Passed");
    button(w, "NOK", "Step 2").click();
    await settle();
    expect(button(w, "NOK", "Step 2").getAttribute("aria-pressed")).toBe("true");
    expect(checked(w)).toContain("Problem");

    button(w, "LFRPS12-1398").click();
    button(w, "NOK", "Step 1").click();
    await settle();
    expect(checked(w)).toContain("Problem");
    button(w, "NOK", "Step 1").click();
    await settle();
    expect(checked(w)).toContain("Not run");
  });

  it("says the results are not kept when the browser refuses to keep them", async () => {
    const w = page((win) => {
      win.Storage.prototype.setItem = () => {
        throw new Error("QuotaExceededError");
      };
    });
    await settle();
    button(w, "OK", "Step 1").click();
    await settle();
    expect(w.document.getElementById("saved")?.textContent).toBe("Not kept — press « Save run.json » now");
  });

  it("keeps a screenshot only in the page until Save run.json, and says so", async () => {
    const w = page();
    await settle();
    const input = w.document.querySelector('input[aria-label="Screenshot of step 1"]') as HTMLInputElement;
    const file = new w.File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new w.Event("change"));
    await settle();
    expect(w.document.getElementById("saved")?.textContent).toMatch(
      /Kept in this browser · .* — 1 screenshot only in this page: press « Save run\.json » before closing it/,
    );
    const kept = Object.values({ ...w.localStorage }).join("\n");
    expect(kept).toContain('"LFRPS12-1420"');
    expect(kept).not.toContain("data:");
  });
});
