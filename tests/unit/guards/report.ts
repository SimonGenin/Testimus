import { GUARDS, show } from "./scan.ts";

const detail = process.argv.includes("--detail");
for (const [name, scan] of Object.entries(GUARDS)) {
  const found = await scan();
  process.stdout.write(`${String(found.length).padStart(5)}  ${name}\n`);
  if (detail && found.length) process.stdout.write(`${show(found)}\n\n`);
}
