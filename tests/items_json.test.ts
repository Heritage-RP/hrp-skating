/**
 * `items.json` declares the inventory items of this resource (PRODUCTION-SERVER#464, hrp-docs dev/items.md): the
 * hrp_inventory fork reads it through the fxmanifest metadata `hrp_inventory_items` (modules/items/declared.lua), so the
 * inventory's base items name no pack or lore resource. This keeps the file loadable and true to the sources: same
 * rules as the fork's loader, every export it names is one of this resource's exports, the client can read the file.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
// the FiveM resource name is the folder name (package.json `name` is not always set)
const self = basename(root);

interface Prop {
  model: string;
  pos?: number[];
  rot?: number[];
}

interface Item {
  label: string;
  weight?: number;
  consume?: number;
  stack?: boolean;
  close?: boolean;
  allowArmed?: boolean;
  description?: string;
  client?: { export?: string; image?: string; prop?: Prop; propTwo?: Prop; [key: string]: unknown };
  server?: { export?: string; [key: string]: unknown };
  buttons?: { label: string; export: string; group?: string }[];
  [key: string]: unknown;
}

interface ItemsFile {
  images?: string;
  items: Record<string, Item>;
}

const file: ItemsFile = JSON.parse(readFileSync(join(root, 'items.json'), 'utf8'));
const items = Object.entries(file.items ?? {});

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

function exportsOf(item: Item): string[] {
  return [item.client?.export, item.server?.export, ...(item.buttons ?? []).map((b) => b.export)].filter(
    (e): e is string => e !== undefined,
  );
}

describe('items.json', () => {
  it('lists items under "items", with an optional images folder of the resource', () => {
    expect(typeof file.items).toBe('object');
    expect(items.length).toBeGreaterThan(0);
    for (const key of Object.keys(file)) expect(['images', 'items']).toContain(key);
    if (file.images !== undefined) {
      expect(file.images).toMatch(/^static\/[\w\-/]+$/); // under static/: build.js puts static/** in the fxmanifest files
      expect(file.images).not.toContain('..');
      expect(existsSync(join(root, file.images))).toBe(true);
    }
  });

  it.each(items)('%s has a name, a label and valid fields', (name, item) => {
    expect(name).toMatch(/^[a-z0-9_]+$/);
    expect(typeof item.label).toBe('string');
    expect(item.label.length).toBeGreaterThan(0);
    if (item.weight !== undefined) expect(item.weight).toBeGreaterThanOrEqual(0);
    if (item.consume !== undefined) expect(item.consume).toBeGreaterThanOrEqual(0);
    for (const key of ['stack', 'close', 'allowArmed'] as const) {
      if (item[key] !== undefined) expect(typeof item[key]).toBe('boolean');
    }
    for (const prop of [item.client?.prop, item.client?.propTwo]) {
      if (!prop) continue;
      expect(typeof prop.model).toBe('string');
      for (const vector of [prop.pos, prop.rot]) if (vector) expect(vector).toHaveLength(3);
    }
    for (const button of item.buttons ?? []) expect(button.label.length).toBeGreaterThan(0);
  });

  it.each(items)('%s calls exports of this resource that exist in src/', (_name, item) => {
    for (const named of exportsOf(item)) {
      const [resource, fn] = named.split('.');
      expect(named).toMatch(/^[^.]+\.[^.]+$/);
      expect(resource).toBe(self);
      expect(src).toMatch(new RegExp(`exports\\(\\s*'${fn}'`));
    }
  });

  it.each(items)('%s shows an image of this resource that exists', (name, item) => {
    // every item has its icon in the images folder (PRODUCTION-SERVER#242: no empty slot in the inventory)
    expect(file.images).toBeDefined();
    const image = item.client?.image;
    if (image && /^[a-z]+:\/\//.test(image)) return;
    expect(existsSync(join(root, file.images ?? '', image ?? `${name}.png`))).toBe(true);
  });

  it('is named by the fxmanifest and readable by the client', () => {
    const build = readFileSync(join(root, 'scripts', 'build.js'), 'utf8');
    expect(build).toMatch(/hrp_inventory_items:\s*'items\.json'/);
    expect(build).toMatch(/'items\.json'/);
    const manifest = join(root, 'fxmanifest.lua');
    if (existsSync(manifest)) {
      const text = readFileSync(manifest, 'utf8');
      expect(text).toContain("hrp_inventory_items 'items.json'");
      expect(text).toContain("'items.json'");
    }
  });
});
