// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBase64, uploadImage } from "../../../../src/ui/lib/files.ts";
import { api, fakeFetch } from "../../ui-desktop-helpers.tsx";

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
    api.routes["tests.storeImage"] = (input) => ({ image: { file: `images/${input.name}` } });
    const im = await uploadImage("t1", new File(["a"], "Shot.JPEG", { type: "image/jpeg" }));
    expect(im).toEqual({ file: "images/Shot.JPEG" });
    expect(api.calls[0].input).toMatchObject({ id: "t1", name: "Shot.JPEG", ext: "jpg", dataBase64: "YQ==" });
  });

  it("names a pasted image from its type, or png, and takes a bare image answer", async () => {
    fakeFetch();
    api.routes["tests.storeImage"] = (input) => ({ file: `images/${input.name}` });
    expect(await uploadImage("t1", new File(["a"], "", { type: "image/webp" }))).toEqual({
      file: "images/paste.webp",
    });
    expect(await uploadImage("t1", new File(["a"], "", { type: "" }))).toEqual({ file: "images/paste.png" });
    expect(api.calls.map((c) => c.input.ext)).toEqual(["webp", "png"]);
  });
});
