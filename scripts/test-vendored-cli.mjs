#!/usr/bin/env node
// Run the reviewed upstream tests against the CLI bytes actually bundled by
// Windows. npm's published payload intentionally omits test/, so obtain it
// from the matching Git checkout (included in the Windows handoff bundle).
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let temporary;
try {
  assert.equal(process.argv[2], "--tests-from", "Usage: node scripts/test-vendored-cli.mjs --tests-from <CLI checkout>");
  assert.equal(process.argv.length, 4);
  const source = resolve(process.argv[3]);
  const vendored = join(appRoot, "src-tauri/resources/cli");
  const metadata = JSON.parse(readFileSync(join(vendored, ".vibe-usage-source.json"), "utf8"));
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "--short=12", "HEAD"), metadata.commit, "CLI test source commit must match the bundled snapshot");
  assert.equal(git("status", "--porcelain"), "", "CLI test checkout must be clean");
  const tests = readdirSync(join(source, "test")).filter(name => name.endsWith(".test.js")).sort();
  assert.ok(tests.length > 0, "No upstream tests found; zero tests is not success");
  temporary = mkdtempSync(join(tmpdir(), "vibe-vendored-cli-tests-"));
  for (const name of ["bin", "src", "package.json"]) {
    cpSync(join(vendored, name), join(temporary, name), { recursive: true });
  }
  cpSync(join(source, "test"), join(temporary, "test"), { recursive: true });
  console.log(`Testing bundled CLI ${metadata.version} (${metadata.commit}) with ${tests.length} upstream test files`);
  const result = spawnSync(process.execPath, ["--test", ...tests.map(name => join("test", name))], {
    cwd: temporary, stdio: "inherit", timeout: 300_000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
