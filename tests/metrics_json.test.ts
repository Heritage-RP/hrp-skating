/**
 * `metrics.json` declares the metrics of this resource to the server tooling (PRODUCTION-SERVER#459, hrp-docs
 * dev/metriques-metier.md): its business metrics — what happens in the game, read by `just business` and the Grafana
 * recording rules — and how its work counters are read by `just waste` (`work.useful`, `work.notWork`). Devtools
 * validates every file at the server level; this keeps the file true to the sources of this resource: every declared
 * name is emitted here, under the resource's prefix.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
// the FiveM resource name is the folder name (package.json `name` is not always set)
const self = basename(root);

interface Metric {
  name: string;
  kind?: 'counter' | 'gauge' | 'histogram';
  selector?: string;
}

interface MetricsFile {
  business: Metric[];
  notBusiness?: string[];
  work?: { useful?: Record<string, string[]>; notWork?: string[] };
  prefixes?: string[];
  clientOnly?: boolean;
}

const file: MetricsFile = JSON.parse(readFileSync(join(root, 'metrics.json'), 'utf8'));
// `hrp-item-clothes` → `hrp_item_`: the first segment of the name, unless the file says otherwise
const defaultPrefix = `hrp_${self.replace(/^hrp-/, '').split('-')[0].split('_')[0].toLowerCase()}_`;
const prefixes = file.prefixes ?? [defaultPrefix];

function sources(dir: string): string {
  let text = '';
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) text += sources(path);
    else if (entry.endsWith('.ts')) text += `${readFileSync(path, 'utf8')}\n`;
  }
  return text;
}

const src = sources(join(root, 'src'));
const declared = [
  ...file.business.map((m) => m.name),
  ...(file.notBusiness ?? []).filter((n) => !n.endsWith('*')),
  ...Object.keys(file.work?.useful ?? {}),
  ...(file.work?.notWork ?? []),
];

describe('metrics.json (PRODUCTION-SERVER#459)', () => {
  it('has the shape Devtools reads', () => {
    expect(Array.isArray(file.business)).toBe(true);
    for (const metric of file.business) {
      expect(metric.name).toMatch(/^hrp_[a-z0-9]+(_[a-z0-9]+)+$/);
      const kind = metric.kind ?? 'counter';
      expect(['counter', 'gauge', 'histogram']).toContain(kind);
      expect(metric.name.endsWith('_total'), `${metric.name}: a counter ends with _total, nothing else does`).toBe(
        kind === 'counter',
      );
      if (metric.selector !== undefined) expect(metric.selector).toMatch(/^[a-z_]+(=|!=|=~|!~)".+"$/);
    }
    for (const values of Object.values(file.work?.useful ?? {})) expect(values.length).toBeGreaterThan(0);
    if (file.clientOnly) expect(file.business).toEqual([]);
    else expect(file.business.length, 'a server resource declares at least one business metric').toBeGreaterThan(0);
  });

  it('declares only metrics of this resource, under its prefixes, each once', () => {
    for (const name of [...declared, ...(file.notBusiness ?? [])]) {
      expect(
        prefixes.some((p) => name.startsWith(p)),
        `${name} is not under ${prefixes.join(', ')}`,
      ).toBe(true);
    }
    expect(new Set(file.business.map((m) => m.name)).size).toBe(file.business.length);
  });

  it('every declared name is emitted by the sources', () => {
    const missing = declared.filter((name) => !src.includes(`'${name}'`) && !src.includes(`"${name}"`));
    expect(missing).toEqual([]);
  });
});
