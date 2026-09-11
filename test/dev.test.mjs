import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const token = "test-only-access-token-at-least-32-characters";

async function startServer(t) {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH, PORT: String(port), DEMO_ACCESS_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Dev server startup timed out")), 5000);
    child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return {
    port, url: `http://127.0.0.1:${port}`,
    healthy: () => assert.equal(child.exitCode, null, stderr)
  };
}

function rawRequest(port, request, abort = false) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    socket.setTimeout(3000, () => socket.destroy(new Error("Request timed out")));
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    socket.on("close", () => resolve(response));
    socket.on("connect", () => {
      socket.write(request);
      if (abort) setTimeout(() => socket.destroy(), 50);
    });
  });
}

for (const target of ["//[", "http://[invalid"]) {
  test(`dev server rejects malformed target ${target} without exiting`, { timeout: 10000 }, async (t) => {
    const server = await startServer(t);
    const response = await rawRequest(server.port,
      `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    assert.match(response, /^HTTP\/1\.1 400 /);
    assert.equal((await fetch(server.url)).status, 200);
    server.healthy();
  });
}

test("dev server survives interrupted bodies and invalid chunk framing", { timeout: 10000 }, async (t) => {
  const server = await startServer(t);
  for (const [request, abort] of [
    ["POST /api/analyze HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{", true],
    ["POST /api/analyze HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nZ\r\nbad\r\n", false]
  ]) {
    await rawRequest(server.port, request, abort);
    await delay(50);
    server.healthy();
    assert.equal((await fetch(server.url)).status, 200);
  }
});

test("dev server preserves static containment, API authentication, and body limits", { timeout: 10000 }, async (t) => {
  const server = await startServer(t);
  assert.match(await (await fetch(server.url)).text(), /Privacy Choices/);
  const asset = await fetch(`${server.url}/catalog.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(server.url, { method: "HEAD" })).status, 200);
  for (const path of ["/%2e%2e%2fpackage.json", "/%zz", "/api%2fanalyze"]) {
    assert.equal((await fetch(server.url + path)).status, 404);
  }
  const api = `${server.url}/api/analyze`;
  assert.equal((await fetch(api)).status, 405);
  assert.equal((await fetch(`${api}?x=1`)).status, 405);
  assert.equal((await fetch(api, { method: "OPTIONS" })).status, 204);
  const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"serviceId":"maps"}' };
  assert.equal((await fetch(api, request)).status, 401);
  request.headers.Authorization = `Bearer ${token}`;
  assert.equal((await fetch(api, request)).status, 503);
  assert.equal((await fetch(api, { ...request, body: "{" })).status, 400);
  assert.equal((await fetch(api, { ...request, body: "x".repeat(513) })).status, 413);
  assert.equal((await fetch(server.url)).status, 200);
  server.healthy();
});
