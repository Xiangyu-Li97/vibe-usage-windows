#!/usr/bin/env node
/**
 * Subprocess entry point for the vendored OpenCode root-resolution tests.
 *
 * `src/opencode-roots.js` derives its candidate roots from ambient state —
 * `homedir()`, `process.env.LOCALAPPDATA`, `process.env.VIBE_USAGE_OPENCODE_DIRS`
 * and `process.platform`. The regression tests must control all four without
 * looking at the developer's real profile, so resolution runs in a spawned
 * process with a rewritten environment instead of inside vitest.
 *
 *   node run-opencode-roots-probe.mjs [platform]
 *
 * `platform` overrides `process.platform` before the module is called; `-` keeps
 * the real one. `VIBE_USAGE_OPENCODE_ROOTS_PATH` overrides the module under test,
 * which the guard test uses to prove the suite fails against an unpatched module
 * without touching the shipped snapshot.
 */

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const platformOverride = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
if (platformOverride) {
  Object.defineProperty(process, 'platform', { value: platformOverride, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.VIBE_USAGE_OPENCODE_ROOTS_PATH?.trim()
  || join(here, '..', 'src-tauri', 'resources', 'cli', 'src', 'opencode-roots.js');

const out = { ok: false, modulePath };
try {
  const mod = await import(pathToFileURL(modulePath).href);
  const warnings = [];
  const stores = mod.getOpenCodeStores({ onWarning: (message) => warnings.push(message) });
  out.ok = true;
  out.platform = process.platform;
  out.home = homedir();
  out.localAppData = process.env.LOCALAPPDATA ?? null;
  out.stores = stores;
  out.warnings = warnings;
} catch (error) {
  out.error = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  };
}

process.stdout.write(JSON.stringify(out) + '\n');
