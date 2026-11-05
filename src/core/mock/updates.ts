import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "../../shared/run/work.ts";
import { installationAt, updater } from "../lib/updates.ts";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };

function fakeRelease(dir: string, version: string, notes: string): void {
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "package.json"), JSON.stringify({ name: "testimus", version }));
  writeFileSync(join(dir, "install.ps1"), "# --mock release\n");
  writeFileSync(join(dir, "release.json"), JSON.stringify({ version, built: "2026-11-05T09:00:00.000Z", notes }));
}

// ponytail: TESTIMUS_MOCK_UPDATES puts newer releases in a fake team folder (comma-separated versions, e.g. 0.9.0);
// `unreachable` points the installation at a folder that is gone; unset, the folder holds only the running version.
// The sandbox is an installed copy, and an update writes the new version's folder and current.txt without PowerShell
export function setupUpdatesMock(root: string): void {
  const spec = (process.env.TESTIMUS_MOCK_UPDATES ?? "").trim();
  const home = join(root, "install");
  const channel = join(root, "share", "Testimus");
  fakeRelease(join(channel, `testimus-${pkg.version}-win-x64`), pkg.version, "");
  if (spec !== "unreachable")
    for (const v of spec
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean))
      fakeRelease(
        join(channel, `testimus-${v}-win-x64`),
        v,
        `Testimus ${v}: a sample of release notes.\nThe tests list can be split in two panes.`,
      );
  fakeRelease(join(home, pkg.version), pkg.version, "");
  writeFileSync(join(home, "current.txt"), pkg.version);
  writeFileSync(
    join(home, "install.json"),
    JSON.stringify({
      version: pkg.version,
      from: join(channel, `testimus-${pkg.version}-win-x64`),
      channel: spec === "unreachable" ? join(root, "gone", "Testimus") : channel,
      options: {},
    }),
  );
  updater.installation = () => installationAt(join(home, pkg.version));
  updater.install = async (ctx, release, inst) => {
    for (const step of [`copying ${release.version} to ${join(inst.root, release.version)}`, "checking the copy"]) {
      ctx.progress({ message: step });
      await sleep(Number(process.env.TESTIMUS_MOCK_UPDATE_MS ?? 600), ctx.signal);
    }
    fakeRelease(join(inst.root, release.version), release.version, release.notes);
    writeFileSync(join(inst.root, "current.txt"), release.version);
    ctx.progress({ message: `current = ${release.version}` });
  };
}
