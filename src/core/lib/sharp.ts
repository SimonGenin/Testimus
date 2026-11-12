import os from "node:os";

type Sharp = typeof import("sharp").default;

let loaded: Sharp | null = null;

// ponytail: sharp is loaded once and kept modest — it works in the core's own process, where the page is answered: a
// quarter of the cores per picture (it took 66 threads and more than a core on a video's frames), and no cache of
// pictures or open files (a frame is read once; on Windows a cached file stays locked)
export async function sharpOf(): Promise<Sharp> {
  if (loaded) return loaded;
  const sharp = (await import("sharp")).default;
  sharp.concurrency(Math.max(1, Math.floor(os.availableParallelism() / 4)));
  sharp.cache(false);
  loaded = sharp;
  return sharp;
}
