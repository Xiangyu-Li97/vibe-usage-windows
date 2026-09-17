const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');
const { resolve, join } = require('node:path');

module.exports = {
  hooks: {
    updateConfig(config) {
      if (config.rawConfig?.['virtual-store-dir'] != null ||
          config.cliOptions?.['virtual-store-dir'] != null ||
          (config.virtualStoreDir && config.virtualStoreDir !== 'node_modules/.pnpm')) {
        return config;
      }
      if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return config;
      const workspace = realpathSync.native(resolve(config.lockfileDir || config.workspaceDir || __dirname));
      const id = createHash('sha256').update(workspace.replaceAll('\\', '/').toLowerCase()).digest('hex').slice(0, 20);
      return { ...config, virtualStoreDir: join(process.env.LOCALAPPDATA, 'vbu-pnpm-vstore', id) };
    },
  },
};
