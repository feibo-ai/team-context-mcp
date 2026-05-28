import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseFrontmatter,
  findSection,
  replaceSection,
  upsertSection,
} from '../src/markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '../fixtures/plan-sample.md');
const sample = readFileSync(samplePath, 'utf-8');

describe('parseFrontmatter', () => {
  it('extracts layer and dri', () => {
    const fm = parseFrontmatter(sample);
    expect(fm.layer).toBe('project');
    expect(fm.dri).toBe('alice');
  });
});

describe('findSection', () => {
  it('returns Goal section body', () => {
    expect(findSection(sample, 'Goal')).toBe('Reduce p99 to <400ms.');
  });

  it('returns null for missing section', () => {
    expect(findSection(sample, 'Nonexistent')).toBeNull();
  });
});

describe('replaceSection', () => {
  it('replaces existing section content', () => {
    const out = replaceSection(sample, 'Goal', 'New goal text.');
    expect(findSection(out, 'Goal')).toBe('New goal text.');
    expect(findSection(out, 'Approach')).toBe('Tune the cache.');
  });
});

describe('upsertSection', () => {
  it('inserts new section at the end if missing', () => {
    const out = upsertSection(sample, 'Current State', 'fresh');
    expect(findSection(out, 'Current State')).toBe('fresh');
    expect(findSection(out, 'Goal')).toBe('Reduce p99 to <400ms.');
  });

  it('replaces if section exists', () => {
    const out = upsertSection(sample, 'Goal', 'totally new');
    expect(findSection(out, 'Goal')).toBe('totally new');
  });
});
