// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBase64, uploadImage } from "../../src/ui/lib/files.ts";
import { loadRequirements, parseCsvRows } from "../../src/ui/lib/requirements.ts";
import { api, fakeFetch } from "./ui-desktop-helpers.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toBase64", () => {
  it("reads a blob as base64 without the data url prefix", async () => {
    expect(await toBase64(new Blob(["hi"], { type: "text/plain" }))).toBe("aGk=");
  });

  it("rejects with the reader error, or a default one", async () => {
    const boom = new Error("disk gone");
    let err: Error | null = boom;
    vi.stubGlobal(
      "FileReader",
      class {
        error: Error | null = err;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          setTimeout(() => this.onerror?.(), 0);
        }
      },
    );
    await expect(toBase64(new Blob(["x"]))).rejects.toBe(boom);
    err = null;
    await expect(toBase64(new Blob(["x"]))).rejects.toThrow("Could not read the file");
  });
});

describe("uploadImage", () => {
  it("sends the file under its name and extension and unwraps an { image } answer", async () => {
    fakeFetch();
    api.routes["tests.addImage"] = (input) => ({ image: { file: `images/${input.name}` } });
    const im = await uploadImage("t1", new File(["a"], "Shot.JPEG", { type: "image/jpeg" }));
    expect(im).toEqual({ file: "images/Shot.JPEG" });
    expect(api.calls[0].input).toMatchObject({ id: "t1", name: "Shot.JPEG", ext: "jpg", dataBase64: "YQ==" });
  });

  it("names a pasted image from its type, or png, and takes a bare image answer", async () => {
    fakeFetch();
    api.routes["tests.addImage"] = (input) => ({ file: `images/${input.name}` });
    expect(await uploadImage("t1", new File(["a"], "", { type: "image/webp" }))).toEqual({
      file: "images/paste.webp",
    });
    expect(await uploadImage("t1", new File(["a"], "", { type: "" }))).toEqual({ file: "images/paste.png" });
    expect(api.calls.map((c) => c.input.ext)).toEqual(["webp", "png"]);
  });
});

describe("parseCsvRows", () => {
  it("splits on commas, keeps quoted separators and doubled quotes, skips blank rows", () => {
    expect(parseCsvRows('id,text\r\nA,"one, ""two"""\n\n,\nB,x')).toEqual([
      ["id", "text"],
      ["A", 'one, "two"'],
      ["B", "x"],
    ]);
  });

  it("picks the semicolon when the header has more of them, and handles a lone \\r", () => {
    expect(parseCsvRows("id;text;doc\rA;b,c;D\r")).toEqual([
      ["id", "text", "doc"],
      ["A", "b,c", "D"],
    ]);
  });
});

type Route = (url: string, body: Record<string, unknown>) => Response | Promise<Response>;

const stubFetch = (route: Route) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) =>
      route(String(url), init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}),
    ),
  );

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

describe("loadRequirements", () => {
  it("merges the CSV with the ids found in documents, sorted numerically", async () => {
    stubFetch((url, body) => {
      if (url.startsWith("/files/")) return new Response("﻿ID;Text;Doc\nREQ_10;Ten;D1\nREQ_2; Two ;D1\n;x;y\n");
      if (url === "/api/docs/list") return json([{ id: "D1" }, { id: "D2" }, { id: "D3" }]);
      if (body.id === "D1") return json({ requirements: ["REQ_2", "REQ_3"] });
      if (body.id === "D2") return new Response(JSON.stringify({ error: "gone" }), { status: 500 });
      return json({});
    });
    expect(await loadRequirements()).toEqual([
      { id: "REQ_2", text: "Two", doc: "D1" },
      { id: "REQ_3", text: "", doc: "D1" },
      { id: "REQ_10", text: "Ten", doc: "D1" },
    ]);
  });

  it("reads a CSV with only an id column and empty answers from the documents", async () => {
    stubFetch((url) => {
      if (url.startsWith("/files/")) return new Response("id\nR1\nR2,extra\n");
      return json(null);
    });
    expect(await loadRequirements()).toEqual([
      { id: "R1", text: "", doc: "" },
      { id: "R2", text: "", doc: "" },
    ]);
  });

  it("ignores a CSV without an id column, a missing CSV and failing calls", async () => {
    stubFetch((url) => {
      if (url.startsWith("/files/")) return new Response("name,text\nA,b\n");
      throw new Error("offline");
    });
    expect(await loadRequirements()).toEqual([]);
    stubFetch((url) => {
      if (url.startsWith("/files/")) return new Response("", { status: 404 });
      if (url === "/api/docs/list") return json([{ id: "D1" }]);
      return json({ requirements: ["X1"] });
    });
    expect(await loadRequirements()).toEqual([{ id: "X1", text: "", doc: "D1" }]);
    stubFetch(() => {
      throw new Error("offline");
    });
    expect(await loadRequirements()).toEqual([]);
  });

  it("reads an empty CSV file", async () => {
    stubFetch((url) => (url.startsWith("/files/") ? new Response("") : json([])));
    expect(await loadRequirements()).toEqual([]);
  });
});
