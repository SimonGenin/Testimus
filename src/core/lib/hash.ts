import { createHash } from "node:crypto";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function testHash(testMd: string): string {
  const text = testMd.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const m = text.match(/^[ \t]*---[ \t]*\n[\s\S]*?\n[ \t]*---[ \t]*\n/);
  return sha256(m ? text.slice(m[0].length) : text).slice(0, 16);
}
