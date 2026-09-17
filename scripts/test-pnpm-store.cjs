const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { hooks } = require('../.pnpmfile.cjs');

test('checkout-specific virtual store is stable and respects explicit settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'vbu-store-'));
  const previous = process.env.LOCALAPPDATA;
  try {
    const a = join(root, 'a'), b = join(root, 'b');
    mkdirSync(a); mkdirSync(b);
    process.env.LOCALAPPDATA = join(root, 'cache');
    const input = { lockfileDir: a, rawConfig: {}, virtualStoreDir: 'node_modules/.pnpm' };
    const first = hooks.updateConfig(input);
    if (process.platform === 'win32') {
      assert.notEqual(first.virtualStoreDir, hooks.updateConfig({ ...input, lockfileDir: b }).virtualStoreDir);
      assert.equal(first.virtualStoreDir, hooks.updateConfig({ ...input, lockfileDir: resolve(a, '.') }).virtualStoreDir);
      assert.equal(first.virtualStoreDir, hooks.updateConfig({ ...input, lockfileDir: realpathSync(a) }).virtualStoreDir);
      assert.match(first.virtualStoreDir, /vbu-pnpm-vstore[/\\][a-f0-9]{20}$/);
    } else {
      assert.equal(first, input);
    }
    for (const explicit of [
      { ...input, rawConfig: { 'virtual-store-dir': 'node_modules/.pnpm' } },
      { ...input, cliOptions: { 'virtual-store-dir': 'custom' } },
      { ...input, virtualStoreDir: join(root, 'custom') },
    ]) assert.equal(hooks.updateConfig(explicit), explicit);
    assert.equal(input.virtualStoreDir, 'node_modules/.pnpm');
    delete process.env.LOCALAPPDATA;
    assert.equal(hooks.updateConfig(input), input);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
