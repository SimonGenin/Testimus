import type {} from "../bridge-types.ts";

const shellPage = window.testimusShell;
const el = (id: string) => document.getElementById(id) as HTMLElement;
const restart = el("restart") as HTMLButtonElement;
const logs = el("logs") as HTMLButtonElement;

if (shellPage) {
  shellPage.details().then((d) => {
    el("message").textContent = d.message;
    el("lines").textContent = d.lines.length ? d.lines.join("\n") : "(the log is empty)";
    el("where").textContent = d.logDir;
  });
  restart.addEventListener("click", () => {
    restart.disabled = true;
    shellPage.restart();
  });
  logs.addEventListener("click", () => shellPage.openLogs());
  restart.focus();
} else {
  restart.disabled = true;
  logs.disabled = true;
}
