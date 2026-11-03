import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "hang";
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
process.stdout.write(`${JSON.stringify({ child: process.pid, grandchild: grandchild.pid })}\n`);

if (mode === "exit") process.exit(0);
if (mode === "fail") {
  process.stderr.write("it went wrong\n");
  process.exit(3);
}
if (mode === "echo") {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => {
    for (const line of d.split("\n")) if (line) process.stdout.write(`echo:${line}\n`);
  });
  process.stdin.on("end", () => process.exit(0));
} else setInterval(() => {}, 1000);
