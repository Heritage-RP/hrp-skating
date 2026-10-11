import { loadConfig } from '@heritage-rp/lib/config';
import type StaticConfig from '~/static/config.json';

let config = loadConfig<typeof StaticConfig>();

$BROWSER: {
  config = await config;
}

export default config;
