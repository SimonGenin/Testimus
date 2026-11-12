import { describe, expect, it } from "vitest";
import { GUARDS, type GuardName, show } from "./scan.ts";

// ponytail: a ratchet — each guard may only go down; at 0 everywhere they are blocking
const LIMITS: Record<GuardName, number> = {
  "N1a unknown or dynamic command names in src/ui": 0,
  "N1b value imports from src/core or src/shared/run in src/ui": 0,
  "N1c fetch, EventSource or browser storage outside lib/data and lib/prefs": 0,
  "N1d routes served by faces/http.ts outside the known list": 0,
  "N1e src/core modules a face imports beyond the registry and its plumbing": 0,
  "N1f src/desktop importing src/core": 0,
  "N2 bare button, input, textarea, select or contentEditable outside components/ui": 0,
  "N2 old kit files left in components/legacy": 0,
  "N4a literal colours or px sizes outside tokens.stylex.ts": 0,
  "N4c CSS files (other than fonts) and raw HTML in src/ui": 0,
  "N4d inline styles with only constant values": 0,
  "N7 child_process, process.kill or taskkill outside src/shared/run/process.ts": 0,
  "N7 setTimeout or setInterval in src/core": 0,
  "N7 synchronous whole-file read or copy where the core handles the user's files": 0,
  // ponytail: 42 EXTRA + 4 CONTAINERS + 7 BREAKPOINTS (design-system audit n° 14): asked of the design sessions, never more
  "G8 token values written by scripts/tokens.ts, not read from design/tokens.css": 53,
  "G8 vocabulary colour aliases of tokens.css never read in src/ui": 0,
  "G1 font size, weight, line height, letter spacing or face picked outside the kit": 0,
  "G2 the browser's own select, option or datalist list in src/ui": 0,
  // ponytail: picture frames (DocText, DocReading, ImageBlock's figure and picture, StepOrphans), the dock, the drop veil,
  // and three panels still to move to the kit (ConnectClaude, PackStep's machine, WasView): never more
  "G2 framed boxes (edge and rounded corners) drawn outside the kit": 10,
  "G3 a Claude block's Context built by hand instead of useRunContext": 0,
};

describe("architecture guards", () => {
  for (const [name, scan] of Object.entries(GUARDS) as [GuardName, () => unknown][])
    it(`${name}: at most ${LIMITS[name]}`, async () => {
      const found = (await scan()) as { file: string; line: number; text: string }[];
      expect(found.length, `${found.length} found:\n${show(found)}`).toBeLessThanOrEqual(LIMITS[name]);
    });
});
