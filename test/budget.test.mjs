import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESERVE_LUA } from "../lib/ledger.mjs";

const run = promisify(execFile);
test("real Redis atomically stops concurrent model attempts below the $5 allowance", async (t) => {
  try { await run("redis-server", ["--version"]); } catch { return t.skip("redis-server is required for the real atomic-budget check"); }
  const directory = await mkdtemp(join(tmpdir(), "privacy-budget-"));
  const socket = join(directory, "redis.sock");
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const exited = new Promise((resolve) => server.once("exit", resolve));
  const cli = async (...args) => (await run("redis-cli", ["-s", socket, "--raw", ...args])).stdout.trim();
  t.after(async () => { server.kill("SIGTERM"); await exited; await rm(directory, { recursive: true, force: true }); });
  for (let n = 0; n < 50; n++) {
    try { if (await cli("PING") === "PONG") break; } catch { /* Wait for the isolated test server. */ }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    cli("EVAL", RESERVE_LUA, "1", "budget", "70000", "5000000")));
  assert.equal(results.filter((result) => Number(result) >= 0).length, 71);
  assert.equal(await cli("GET", "budget"), "4970000");
  assert.equal(await cli("TTL", "budget"), "-1", "budget must not reset on a timer");
  assert.equal(await cli("EVAL", RESERVE_LUA, "1", "budget", "70000", "5000000"), "-1");
});
