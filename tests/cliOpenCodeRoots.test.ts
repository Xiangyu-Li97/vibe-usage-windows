import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("Windows OpenCode fallback preserves default precedence, overrides and extra roots", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-opencode-windows-"));
  try {
    const moduleURL = pathToFileURL(resolve("src-tauri/resources/cli/src/opencode-roots.js")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import os from 'node:os';
      import { syncBuiltinESMExports } from 'node:module';
      import { mkdirSync, realpathSync } from 'node:fs';
      import { join } from 'node:path';
      const root = process.argv[1];
      // Isolate this subprocess from real user stores while exercising the
      // Windows branch on either host platform.
      os.homedir = () => root;
      syncBuiltinESMExports();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.LOCALAPPDATA = join(root, 'local-app-data');
      delete process.env.VIBE_USAGE_OPENCODE_DIRS;
      const local = join(process.env.LOCALAPPDATA, 'opencode', 'storage', 'message');
      const extra = join(root, 'extra');
      const extraMessages = join(extra, 'storage', 'message');
      mkdirSync(local, { recursive: true });
      mkdirSync(extraMessages, { recursive: true });
      const { getOpenCodeStores } = await import(process.argv[2]);
      assert.deepEqual(getOpenCodeStores({ extraRoots: [extra] }).map(s => s.path),
        [realpathSync(local), realpathSync(extraMessages)]);
      const xdg = join(root, '.local', 'share', 'opencode', 'storage', 'message');
      mkdirSync(xdg, { recursive: true });
      assert.deepEqual(getOpenCodeStores().map(s => s.path), [realpathSync(xdg)]);
      process.env.VIBE_USAGE_OPENCODE_DIRS = extra;
      assert.deepEqual(getOpenCodeStores().map(s => s.path), [realpathSync(extraMessages)]);
    `, root, moduleURL], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
