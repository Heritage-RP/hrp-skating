//@ts-check

import { getFiles } from './utils.js';
import { createBuilder, createFxmanifest } from '@communityox/fx-utils';

const watch = process.argv.includes('--watch');
const dropLabels = ['$BROWSER'];

if (!watch) dropLabels.push('$DEV');

createBuilder(
  watch,
  {
    keepNames: true,
    legalComments: 'inline',
    bundle: true,
    treeShaking: true,
  },
  [
    {
      name: 'server',
      options: {
        platform: 'node',
        target: ['node22'],
        format: 'cjs',
        dropLabels: [...dropLabels, '$CLIENT'],
      },
    },
    {
      name: 'client',
      options: {
        platform: 'browser',
        target: ['es2021'],
        format: 'iife',
        dropLabels: [...dropLabels, '$SERVER'],
      },
    },
  ],
  async (outfiles) => {
    const files = await getFiles('static', 'locales');
    await createFxmanifest({
      client_scripts: ['@hrp-metrics/lib/log.js', outfiles.client],
      server_scripts: ['@hrp-metrics/lib/log.js', outfiles.server],
      files,
      dependencies: ['/server:13068', '/onesync', 'ox_lib', 'ox_inventory'],
      metadata: {
        node_version: '22',
      },
    });
  },
);
