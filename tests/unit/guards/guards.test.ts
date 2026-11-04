import { describe, expect, it } from "vitest";
import { GUARDS, type GuardName, show } from "./scan.ts";

// ponytail: a ratchet — each guard may only go down; at 0 everywhere they are blocking (GOAL-V3, wave 5)
const LIMITS: Record<GuardName, number> = {
  "N1a unknown or dynamic command names in src/ui": 0,
  "N1b value imports from src/core or src/shared/run in src/ui": 0,
  "N1c fetch, EventSource or browser storage outside lib/data and lib/prefs": 0,
  "N1d routes served by faces/http.ts outside the known list": 0,
  "N2 bare button, input, textarea, select or contentEditable outside components/ui": 0,
  "N2 old kit files left in components/legacy": 0,
  "N4a literal colours or px sizes outside tokens.stylex.ts": 0,
  "N4c CSS files (other than fonts) and raw HTML in src/ui": 0,
  "N4d inline styles with only constant values": 0,
  "N7 child_process, process.kill or taskkill outside src/shared/run/process.ts": 0,
  "N7 setTimeout or setInterval in src/core": 0,
};

describe("architecture guards (GOAL-V3 N1, N2, N4, N7)", () => {
  for (const [name, scan] of Object.entries(GUARDS) as [GuardName, () => unknown][])
    it(`${name}: at most ${LIMITS[name]}`, async () => {
      const found = (await scan()) as { file: string; line: number; text: string }[];
      expect(found.length, `${found.length} found:\n${show(found)}`).toBeLessThanOrEqual(LIMITS[name]);
    });
});
