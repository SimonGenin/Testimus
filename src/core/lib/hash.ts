import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function testHash(testMd: string): string {
  const text = testMd.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const m = text.match(/^[ \t]*---[ \t]*\n[\s\S]*?\n[ \t]*---[ \t]*\n/);
  return sha256(m ? text.slice(m[0].length) : text).slice(0, 16);
}

// ponytail: a file is hashed as it streams, never held whole (a video passes 2 GiB), and the hashing never holds the
// process: the server keeps answering while a large file is read
export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024, signal }))
    h.update(chunk as Buffer);
  return h.digest("hex");
}
