import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credsDir, credsStatus, jiraCreds, saveCreds, xrayCreds } from "../../src/core/lib/creds.ts";
import { sha256, testHash } from "../../src/core/lib/hash.ts";
import { DEFAULT_SETTINGS, readJson, resolveProjectDir, writeSettings } from "../../src/core/lib/project.ts";
import { addImage, findingCounts, readCheck, testDir } from "../../src/core/lib/store.ts";
import { parseTest, serializeTest } from "../../src/core/lib/testfile.ts";
import { readZip, writeZip } from "../../src/core/lib/zip.ts";
import { dropCol, dropRow, tablesIn } from "../../src/shared/table.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "testimus-covmisc-"));
describe("hash", () => {
  it("hashes a test without frontmatter as a whole", () => {
    expect(testHash("body")).toBe(sha256("body").slice(0, 16));
    expect(testHash("---\nkey: X\n---\nbody")).toBe(sha256("body").slice(0, 16));
  });
});

describe("zip", () => {
  it("round-trips stored and deflated entries and skips directories", () => {
    const big = new TextEncoder().encode("a".repeat(2000));
    const zip = writeZip([
      { name: "dir/", data: new Uint8Array() },
      { name: "dir/a.txt", data: big },
      { name: "b.bin", data: new Uint8Array([1, 2, 3]) },
    ]);
    const out = readZip(zip);
    expect([...out.keys()]).toEqual(["dir/a.txt", "b.bin"]);
    expect(out.get("dir/a.txt")).toEqual(big);
  });

  it("refuses a buffer that is not a zip, and a corrupt central directory", () => {
    expect(() => readZip(new Uint8Array(10))).toThrow("Not a zip file");
    const zip = writeZip([{ name: "a", data: new Uint8Array([1]) }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = zip.length - 22;
    const cd = view.getUint32(eocd + 16, true);
    view.setUint32(cd, 0, true);
    expect(() => readZip(zip)).toThrow("Corrupt zip central directory.");
  });
});

describe("table", () => {
  it("reads a row without its closing pipe, and drops the first row", () => {
    const text = "|a|b\n|c|d|";
    const [t] = tablesIn(text);
    expect(t.rows[0].cells.map((c) => c.text)).toEqual(["a", "b"]);
    expect(dropRow(text, t, 0)).toBe("|c|d|");
  });

  it("drops a column that a short row does not have, and the last column of a head row", () => {
    const text = "||h1||h2||\n|x|";
    const [t] = tablesIn(text);
    expect(dropCol(text, t, 1)).toBe("||h1||\n|x|");
  });

  it("dropping the only column drops the table", () => {
    const text = "before\n\n|a|\n|b|\n\nafter";
    const [t] = tablesIn(text);
    expect(dropCol(text, t, 0)).toBe("before\n\n\n\nafter");
  });
});

describe("testfile", () => {
  it("ignores kept sections that are not a list, or not JSON", () => {
    const { test } = parseTest("---\nkey: P-1\n---\n\n## Step 1\n\n### Action\n\na\n");
    expect(serializeTest({ ...test, extra: { "#sections": "{}" } })).not.toContain("## Odd");
    expect(serializeTest({ ...test, extra: { "#sections": "not json" } })).toContain("### Action");
  });

  it("keeps a quoted value that is not valid JSON as written", () => {
    const { test } = parseTest('---\nkey: P-1\nsummary: "a\\x"\n---\n');
    expect(test.summary).toBe('"a\\x"');
  });

  it("keeps a sub-heading outside a step as plain text", () => {
    const { test, warnings } = parseTest("---\nkey: P-1\n---\n## Description\n\n### Note\n\ntext\n");
    expect(test.description).toBe("### Note\n\ntext");
    expect(warnings).toContain('Kept unknown heading "### Note" as plain text');
  });

  it("keeps text before the first section as the description, with a warning", () => {
    const { test, warnings } = parseTest("---\nkey: P-1\n---\nhello\n## Step 1\n### Action\nx\n");
    expect(test.description).toBe("hello");
    expect(warnings).toContain("Text before the first section was kept as the description");
  });
});

describe("store", () => {
  it("reads an unreadable check.json as none, counts findings of a check without any, and names an image without extension png", () => {
    const project = tmp();
    mkdirSync(testDir(project, "local-00000001"), { recursive: true });
    writeFileSync(join(testDir(project, "local-00000001"), "check.json"), "{oops");
    expect(readCheck(project, "local-00000001")).toBeNull();
    expect(findingCounts({ testHash: "x" } as never, "md")).toEqual({ errors: 0, warnings: 0, infos: 0, stale: true });
    const im = addImage(project, "local-00000001", new Uint8Array([1]), "");
    expect(im.file).toMatch(/^images\/img-[0-9a-f]{8}\.png$/);
  });
});

describe("project", () => {
  const saved = process.env.TESTIMUS_PROJECT;
  const cwd = process.cwd();
  afterEach(() => {
    if (saved === undefined) delete process.env.TESTIMUS_PROJECT;
    else process.env.TESTIMUS_PROJECT = saved;
    process.chdir(cwd);
    writeSettings(structuredClone(DEFAULT_SETTINGS));
  });

  it("reads an invalid JSON file as its fallback", () => {
    const file = join(tmp(), "x.json");
    writeFileSync(file, "{nope");
    expect(readJson(file, { a: 1 })).toEqual({ a: 1 });
  });

  it("resolves the project from the flag, the environment, the folder, then the last one used", () => {
    expect(resolveProjectDir("rel")).toBe(resolve("rel"));
    process.env.TESTIMUS_PROJECT = "envdir";
    expect(resolveProjectDir()).toBe(resolve("envdir"));
    delete process.env.TESTIMUS_PROJECT;

    const here = tmp();
    writeFileSync(join(here, "project.json"), "{}");
    process.chdir(here);
    expect(resolveProjectDir()).toBe(process.cwd());

    const elsewhere = tmp();
    process.chdir(elsewhere);
    expect(resolveProjectDir()).toBeNull();
    writeSettings({ ...structuredClone(DEFAULT_SETTINGS), lastProject: here });
    expect(resolveProjectDir()).toBe(here);
    writeSettings({ ...structuredClone(DEFAULT_SETTINGS), lastProject: elsewhere });
    expect(resolveProjectDir()).toBeNull();
  });
});

describe("creds", () => {
  const write = (name: string, text: string) => {
    mkdirSync(credsDir(), { recursive: true });
    writeFileSync(join(credsDir(), name), text);
  };
  afterEach(() => {
    rmSync(credsDir(), { recursive: true, force: true });
  });

  it("refuses invalid JSON, incomplete Jira access, missing or incomplete Xray access", () => {
    write("credentials.json", "{bad");
    expect(() => jiraCreds()).toThrow("~/.atlassian/credentials.json is not valid JSON.");
    write("credentials.json", JSON.stringify({ baseUrl: "https://x", email: 5 }));
    expect(() => jiraCreds()).toThrow("needs baseUrl, email and token");
    expect(() => xrayCreds()).toThrow("Missing ~/.atlassian/xray_credentials.json.");
    write("xray_credentials.json", JSON.stringify({ clientId: "a" }));
    expect(() => xrayCreds()).toThrow("needs clientId and clientSecret");
    write("xray_credentials.json", JSON.stringify({ clientId: "a", clientSecret: "b", apiBase: "https://eu.x/" }));
    expect(xrayCreds().apiBase).toBe("https://eu.x");
  });

  it("reports invalid files as present but incomplete", () => {
    write("credentials.json", "{bad");
    write("xray_credentials.json", "{bad");
    const s = credsStatus();
    expect(s.jira).toMatchObject({ exists: true, complete: false, baseUrl: undefined, email: undefined });
    expect(s.xray).toMatchObject({ exists: true, complete: false });
    rmSync(credsDir(), { recursive: true });
    expect(credsStatus().jira.exists).toBe(false);
  });

  it("saving over an invalid file replaces it, and an empty patch writes nothing", () => {
    write("credentials.json", "{bad");
    saveCreds({ email: "a@b", token: " " }, {});
    expect(JSON.parse(readFileSync(join(credsDir(), "credentials.json"), "utf8"))).toEqual({ email: "a@b" });
    saveCreds({}, { clientId: "" });
    expect(() => readFileSync(join(credsDir(), "xray_credentials.json"))).toThrow();
  });
});
