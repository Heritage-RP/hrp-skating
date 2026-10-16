/**
 * The beta-test bounties this resource ships (`bounties.json`, declared by `hrp_bounty_file` in the manifest) — the
 * shape hrp-bounty reads (docs/dev/bounties.md). hrp-bounty validates the full schema at load time and logs
 * `bounty definition ignored`; this catches the mistakes before a deploy.
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
// the FiveM resource name is the folder name (package.json `name` is not always set)
const self = basename(root);

interface Objective {
  id: string;
  label: string;
  optional?: boolean;
  log?: Record<string, unknown>;
  metric?: { query: string; min?: number; max?: number };
}

interface Bounty {
  id: string;
  version: number;
  title: string;
  summary: string;
  steps: string[];
  resources: string[];
  objectives: Objective[];
  kit?: { items?: { name: string; count?: number }[] };
}

const file = JSON.parse(readFileSync(resolve(root, 'bounties.json'), 'utf8')) as { bounties: Bounty[] };

describe('bounties.json', () => {
  it('is declared in the manifest', () => {
    expect(readFileSync(resolve(root, 'scripts/build.js'), 'utf8')).toContain("hrp_bounty_file: 'bounties.json'");
  });

  it('has at least one bounty, ids unique', () => {
    expect(file.bounties.length).toBeGreaterThan(0);
    expect(new Set(file.bounties.map((b) => b.id)).size).toBe(file.bounties.length);
  });

  it.each(file.bounties.map((b) => [b.id, b] as const))('%s is a complete bounty', (_id, bounty) => {
    expect(bounty.id).toMatch(/^[a-z0-9-]+$/);
    expect(Number.isInteger(bounty.version) && bounty.version >= 1).toBe(true);
    expect(bounty.title.length).toBeGreaterThan(0);
    expect(bounty.title.length).toBeLessThanOrEqual(80);
    expect(bounty.summary.length).toBeLessThanOrEqual(500);
    expect(bounty.steps.length).toBeGreaterThan(0);
    for (const step of bounty.steps) expect(step.length).toBeLessThanOrEqual(300);
    // the bounty tests this resource: its errors during the test are anomalies
    expect(bounty.resources).toContain(self);
    expect(bounty.objectives.length).toBeGreaterThan(0);
    expect(bounty.objectives.length).toBeLessThanOrEqual(20);
    expect(new Set(bounty.objectives.map((o) => o.id)).size).toBe(bounty.objectives.length);
    expect(bounty.objectives.some((o) => !o.optional)).toBe(true);
    for (const objective of bounty.objectives) {
      expect(objective.label.length).toBeGreaterThan(0);
      // exactly one proof: a log record or a metric
      expect(Boolean(objective.log) !== Boolean(objective.metric)).toBe(true);
      if (objective.metric) expect(objective.metric.min ?? objective.metric.max).toBeDefined();
    }
    for (const item of bounty.kit?.items ?? []) expect(item.name).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
