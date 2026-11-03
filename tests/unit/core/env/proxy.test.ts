import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loopbackProxyGap } from "../../../../src/core/shell.ts";
import { coreEnv } from "../../../../src/desktop/core.ts";
import { withLoopback } from "../../../../src/shared/loopback.ts";

let proxy: Server;
let target: Server;
let proxyHits: string[] = [];
let targetPort = 0;
let proxyUrl = "";
const dir = mkdtempSync(join(tmpdir(), "testimus-proxy-"));
const app = join(dir, "app.mjs");

beforeAll(async () => {
  proxy = createServer((req, res) => {
    proxyHits.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    res.writeHead(502).end("proxy");
  });
  target = createServer((_req, res) => res.end("local"));
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => target.listen(0, "::", r));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  targetPort = (target.address() as AddressInfo).port;
  writeFileSync(
    app,
    `const out = [];
for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
  const r = await fetch("http://" + host + ":" + process.argv[2] + "/health", { headers: { authorization: "Bearer SECRET" } });
  out.push(host + "=" + (await r.text()));
}
console.log(out.join(" "));`,
  );
});

afterAll(() => {
  proxy.close();
  target.close();
});

function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (/^(no_proxy|https?_proxy|node_use_env_proxy)$/i.test(k)) delete env[k];
  return { ...env, ...extra };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done, fail) => {
    const c = spawn(command, args, { env, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => {
      out += d;
    });
    c.stderr.on("data", (d) => {
      out += d;
    });
    c.on("error", fail);
    c.on("exit", () => done(out.trim()));
  });
}

const fetchThrough = (env: NodeJS.ProcessEnv) => run(process.execPath, [app, String(targetPort)], env);

describe("loopback calls under NODE_USE_ENV_PROXY=1 (real Node fetch)", () => {
  it("without NO_PROXY, Node sends 127.0.0.1 to the proxy with the bearer key (the defect)", async () => {
    proxyHits = [];
    const out = await fetchThrough(cleanEnv({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl }));
    expect(out).toBe("127.0.0.1=proxy localhost=proxy [::1]=proxy");
    expect(proxyHits.length).toBe(3);
    expect(proxyHits[0]).toContain("Bearer SECRET");
  });

  it("with the loopback names appended to the user's NO_PROXY, nothing reaches the proxy", async () => {
    proxyHits = [];
    const vars = cleanEnv({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl });
    vars.NO_PROXY = withLoopback("corp.example");
    expect(loopbackProxyGap(vars)).toBeNull();
    expect(await fetchThrough(vars)).toBe("127.0.0.1=local localhost=local [::1]=local");
    expect(proxyHits).toEqual([]);
  });

  it("the environment the desktop shell gives the core keeps loopback off the proxy", async () => {
    proxyHits = [];
    const vars = coreEnv(cleanEnv({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: "corp.example" }), {
      shellVersion: "0.2.0",
      packaged: true,
      exeDir: dir,
    });
    expect(vars.NO_PROXY).toBe("corp.example,localhost,127.0.0.1,::1");
    expect(await fetchThrough(vars)).toBe("127.0.0.1=local localhost=local [::1]=local");
    expect(proxyHits).toEqual([]);
  });

  it.runIf(process.platform === "win32")("the testimus.cmd shim keeps loopback off the proxy", async () => {
    const shim = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "scripts", "testimus.cmd"), "utf8");
    expect(shim).toContain('"%~dp0node\\node.exe" "%~dp0app\\testimus.mjs" %*');
    const cmd = join(dir, "testimus.cmd");
    writeFileSync(
      cmd,
      shim.replace('"%~dp0node\\node.exe" "%~dp0app\\testimus.mjs"', `"${process.execPath}" "${app}"`),
      "utf8",
    );
    for (const before of [undefined, "corp.example"]) {
      proxyHits = [];
      const vars = cleanEnv({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ...(before ? { NO_PROXY: before } : {}) });
      const out = await run("cmd.exe", ["/d", "/c", cmd, String(targetPort)], vars);
      expect(out).toBe("127.0.0.1=local localhost=local [::1]=local");
      expect(proxyHits).toEqual([]);
    }
  });
});

describe("NO_PROXY helpers", () => {
  it("appends the loopback names, never replaces the user's value", () => {
    expect(withLoopback(undefined)).toBe("localhost,127.0.0.1,::1");
    expect(withLoopback("")).toBe("localhost,127.0.0.1,::1");
    expect(withLoopback("corp.example")).toBe("corp.example,localhost,127.0.0.1,::1");
    expect(withLoopback("LOCALHOST,127.0.0.1")).toBe("LOCALHOST,127.0.0.1,::1");
    expect(withLoopback("localhost,127.0.0.1,::1")).toBe("localhost,127.0.0.1,::1");
  });

  it("sees the gap only when fetch uses an HTTP proxy and NO_PROXY misses a loopback name", () => {
    expect(loopbackProxyGap({ HTTP_PROXY: "http://p:1" })).toBeNull();
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://p:1" })).toBeNull();
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://p:1" })).toMatch(
      /localhost, 127.0.0.1, ::1/,
    );
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", http_proxy: "http://p:1", NO_PROXY: "127.0.0.1" })).toMatch(
      /localhost, ::1/,
    );
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://p:1", no_proxy: "*" })).toBeNull();
  });
});
