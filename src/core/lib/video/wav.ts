import { closeSync, openSync, readSync, statSync, writeSync } from "node:fs";

export type Wav = { rate: number; bytesPerSecond: number; dataAt: number; dataBytes: number; duration: number };

const HEAD = 44;

// ponytail: the sound of a video is one 16-bit mono WAV on disk (ffmpeg writes it, 115 MB an hour); nothing ever holds
// it whole — a passage of speech is read from its byte range and sent with a header of its own
export function header(rate: number, dataBytes: number): Buffer {
  const b = Buffer.alloc(HEAD);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

// ponytail: ffmpeg may write a LIST chunk before « data », and leaves the sizes at 0xFFFFFFFF when its output was cut
// short — the data then runs to the end of the file
export function readWav(file: string): Wav {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 4096));
    readSync(fd, head, 0, head.length, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE")
      throw new Error(`Not a WAV file: ${file}`);
    let rate = 16000;
    let bytesPerSecond = 32000;
    for (let p = 12; p + 8 <= head.length; ) {
      const id = head.toString("ascii", p, p + 4);
      const len = head.readUInt32LE(p + 4);
      if (id === "fmt ") {
        rate = head.readUInt32LE(p + 12);
        bytesPerSecond = head.readUInt32LE(p + 16);
      }
      if (id === "data") {
        const dataAt = p + 8;
        const dataBytes = Math.min(len, size - dataAt);
        return { rate, bytesPerSecond, dataAt, dataBytes, duration: dataBytes / bytesPerSecond };
      }
      p += 8 + len + (len % 2);
    }
    throw new Error(`No sound data in ${file}`);
  } finally {
    closeSync(fd);
  }
}

// ponytail: the sound between two moments, as a WAV of its own; cut on whole samples
export function slice(file: string, wav: Wav, from: number, to: number): Buffer {
  const frame = wav.bytesPerSecond / wav.rate;
  const at = (s: number) => Math.min(wav.dataBytes, Math.max(0, Math.floor(s * wav.rate) * frame));
  const a = at(from);
  const b = Math.max(a, at(to));
  const out = Buffer.alloc(HEAD + (b - a));
  header(wav.rate, b - a).copy(out);
  const fd = openSync(file, "r");
  try {
    readSync(fd, out, HEAD, b - a, wav.dataAt + a);
  } finally {
    closeSync(fd);
  }
  return out;
}

// ponytail: a piece of the sound as a file (the voice detector reads a file), copied a megabyte at a time
export function sliceTo(file: string, wav: Wav, from: number, to: number, out: string): void {
  const frame = wav.bytesPerSecond / wav.rate;
  const at = (s: number) => Math.min(wav.dataBytes, Math.max(0, Math.floor(s * wav.rate) * frame));
  const a = at(from);
  const b = Math.max(a, at(to));
  const src = openSync(file, "r");
  const dst = openSync(out, "w");
  try {
    writeSync(dst, header(wav.rate, b - a));
    const chunk = Buffer.alloc(1 << 20);
    for (let p = a; p < b; ) {
      const n = readSync(src, chunk, 0, Math.min(chunk.length, b - p), wav.dataAt + p);
      if (n <= 0) break;
      writeSync(dst, chunk, 0, n);
      p += n;
    }
  } finally {
    closeSync(src);
    closeSync(dst);
  }
}
