import { findPackageJSON, registerHooks } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ponytail: onnxruntime-node ships no macOS x64 binary after 1.23 — on an Intel Mac, every file of onnxruntime-node
// and onnxruntime-common (by name or by path, as vitest imports them) is served from the onnxruntime-node-darwin-x64
// alias (1.23.2) and its own onnxruntime-common instead; elsewhere nothing changes
export const LEGACY_ORT = "onnxruntime-node-darwin-x64";

export function legacyOrt(): boolean {
  return process.platform === "darwin" && process.arch === "x64";
}

export async function onnxVersion(): Promise<string> {
  const ort = (await import("onnxruntime-node")) as { env?: { versions?: { node?: string } } };
  return ort.env?.versions?.node ?? "loaded";
}

function root(specifier: string, base: string): string {
  const json = findPackageJSON(specifier, base);
  if (!json) throw new Error(`${specifier} not found`);
  return `${pathToFileURL(dirname(json)).href}/`;
}

function register(): void {
  let swaps: [string, string][];
  try {
    const legacy = root(LEGACY_ORT, import.meta.url);
    swaps = [
      [root("onnxruntime-node", import.meta.url), legacy],
      [root("onnxruntime-common", import.meta.url), root("onnxruntime-common", legacy)],
    ];
  } catch {
    return;
  }
  registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      const swap = swaps.find(([from]) => r.url.startsWith(from));
      return swap ? { ...r, url: swap[1] + r.url.slice(swap[0].length) } : r;
    },
  });
}

if (legacyOrt()) register();
