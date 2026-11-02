import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {}, ipcMain: {}, Notification: class {}, shell: {} }));

const { checkArgs, httpsUrl, insideAny, senderRole } = await import("../../../src/desktop/bridge.ts");

const ok = (name: string, ...args: unknown[]) => {
  const r = checkArgs(name, args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const refused = (name: string, ...args: unknown[]) => !checkArgs(name, args).ok;

describe("bridge argument checks", () => {
  it("pickFolder takes a title and an optional absolute default path", () => {
    expect(ok("pickFolder", { title: "Open a project" })).toEqual({ title: "Open a project", defaultPath: undefined });
    expect(ok("pickFolder", { title: "Open", defaultPath: "D:\\Projects", extra: 1 })).toEqual({
      title: "Open",
      defaultPath: "D:\\Projects",
    });
    expect(refused("pickFolder")).toBe(true);
    expect(refused("pickFolder", { title: "" })).toBe(true);
    expect(refused("pickFolder", { title: "x".repeat(201) })).toBe(true);
    expect(refused("pickFolder", { title: "a\u0007b" })).toBe(true);
    expect(refused("pickFolder", { title: "Open", defaultPath: "relative\\dir" })).toBe(true);
    expect(refused("pickFolder", { title: "Open", defaultPath: "\\\\?\\C:\\x" })).toBe(true);
  });

  it("pickFiles takes filters by extension and multiple", () => {
    const v = ok("pickFiles", {
      title: "Add documents",
      filters: [{ name: "Documents", extensions: ["docx", "pdf"] }],
      multiple: true,
    });
    expect(v).toEqual({
      title: "Add documents",
      filters: [{ name: "Documents", extensions: ["docx", "pdf"] }],
      multiple: true,
    });
    expect(ok("pickFiles", { title: "Claude", filters: [], multiple: false })).toMatchObject({ multiple: false });
    expect(refused("pickFiles", { title: "x", filters: [{ name: "x", extensions: [".docx"] }], multiple: true })).toBe(
      true,
    );
    expect(refused("pickFiles", { title: "x", filters: [{ name: "x", extensions: [] }], multiple: true })).toBe(true);
    expect(refused("pickFiles", { title: "x", filters: [{ name: "x", extensions: ["d/x"] }], multiple: true })).toBe(
      true,
    );
    expect(refused("pickFiles", { title: "x", filters: "docx", multiple: true })).toBe(true);
    expect(refused("pickFiles", { title: "x", filters: [], multiple: "yes" })).toBe(true);
  });

  it("reveal takes an absolute path", () => {
    expect(ok("reveal", "D:\\proj\\tests\\a\\test.md")).toBe("D:\\proj\\tests\\a\\test.md");
    expect(refused("reveal", "tests\\a")).toBe(true);
    expect(refused("reveal", 42)).toBe(true);
    expect(refused("reveal", "D:\\a\0b")).toBe(true);
  });

  it("openExternal opens https only", () => {
    expect(ok("openExternal", "https://id.atlassian.com/manage-profile/security/api-tokens")).toBe(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
    );
    for (const u of [
      "http://example.com",
      "file:///C:/Windows/notepad.exe",
      "javascript:alert(1)",
      "ms-settings:",
      "https://a:b@x.com",
      "",
      5,
    ])
      expect(refused("openExternal", u)).toBe(true);
    expect(httpsUrl("https://claude.ai/docs")).toBe("https://claude.ai/docs");
  });

  it("setProgress takes a fraction or null", () => {
    expect(ok("setProgress", 0.3)).toBe(0.3);
    expect(ok("setProgress", null)).toBeNull();
    for (const v of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5", undefined])
      expect(refused("setProgress", v)).toBe(true);
  });

  it("notify takes a title and a body", () => {
    expect(ok("notify", { title: "Generate tests", body: "12 tests written" })).toEqual({
      title: "Generate tests",
      body: "12 tests written",
    });
    expect(ok("notify", { title: "Done" })).toEqual({ title: "Done", body: "" });
    expect(refused("notify", { body: "x" })).toBe(true);
    expect(refused("notify", { title: "x", body: "y".repeat(1001) })).toBe(true);
  });

  it("refuses an unknown call", () => {
    expect(refused("exec", "calc.exe")).toBe(true);
    expect(ok("version")).toBeUndefined();
  });
});

describe("reveal is limited to known folders", () => {
  const roots = ["D:\\Projects\\LFRPS12", "C:\\Users\\u\\AppData\\Roaming\\Testimus"];
  it("allows a path inside a known project or a data folder, any case", () => {
    expect(insideAny("D:\\Projects\\LFRPS12\\tests\\a\\test.md", roots)).toBe(true);
    expect(insideAny("d:\\projects\\lfrps12", roots)).toBe(true);
    expect(insideAny("C:\\Users\\u\\AppData\\Roaming\\Testimus\\settings.json", roots)).toBe(true);
  });
  it("refuses a sibling, a parent or a .. escape", () => {
    expect(insideAny("D:\\Projects\\LFRPS12-other\\x", roots)).toBe(false);
    expect(insideAny("D:\\Projects", roots)).toBe(false);
    expect(insideAny("D:\\Projects\\LFRPS12\\..\\Secret\\x", roots)).toBe(false);
    expect(insideAny("C:\\Windows\\System32", roots)).toBe(false);
    expect(insideAny("D:\\x", ["", "D:\\y"])).toBe(false);
  });
});

describe("who may call the bridge", () => {
  const ORIGIN = "http://127.0.0.1:53211";
  const ERROR = "file:///D:/Projects/Testimus/dist/desktop/pages/error.html";
  it("the main window's top frame on the core origin gets the bridge", () => {
    expect(senderRole({ isMain: true, isTop: true, url: `${ORIGIN}/#/documents` }, ORIGIN, ERROR)).toBe("bridge");
  });
  it("the error page gets the shell calls only", () => {
    expect(senderRole({ isMain: true, isTop: true, url: `${ERROR}?x#y` }, ORIGIN, ERROR)).toBe("shell");
    expect(
      senderRole(
        { isMain: true, isTop: true, url: "file:///D:/Projects/Testimus/dist/desktop/pages/splash.html" },
        ORIGIN,
        ERROR,
      ),
    ).toBeNull();
  });
  it("a child window, a sub-frame or another origin gets nothing", () => {
    expect(senderRole({ isMain: false, isTop: true, url: `${ORIGIN}/files/x.png` }, ORIGIN, ERROR)).toBeNull();
    expect(senderRole({ isMain: true, isTop: false, url: `${ORIGIN}/` }, ORIGIN, ERROR)).toBeNull();
    expect(senderRole({ isMain: true, isTop: true, url: "https://evil.example/" }, ORIGIN, ERROR)).toBeNull();
    expect(senderRole({ isMain: true, isTop: true, url: `${ORIGIN}/` }, null, ERROR)).toBeNull();
    expect(senderRole({ isMain: true, isTop: true, url: "" }, ORIGIN, ERROR)).toBeNull();
  });
});
