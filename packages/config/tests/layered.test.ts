// packages/config/tests/layered.test.ts
import { describe, it, expect, vi } from 'vitest';
import { LayeredConfigSource } from '../src/layered.js';
import type { ConfigSource } from '../src/source.js';

function makeSource(opts: {
  values?: Record<string, unknown>;
  secrets?: Record<string, string>;
  version?: number;
  hooks?: { start?: () => Promise<void>; stop?: () => Promise<void> };
}): ConfigSource & { listeners: Set<(k: string) => void> } {
  const listeners = new Set<(k: string) => void>();
  const src: ConfigSource & { listeners: Set<(k: string) => void> } = {
    listeners,
    get: <T = unknown>(key: string) => (opts.values?.[key] as T | undefined),
    getSecret: async (key: string) => opts.secrets?.[key],
    version: () => opts.version ?? 1,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    start: opts.hooks?.start,
    stop: opts.hooks?.stop,
  };
  return src;
}

describe('LayeredConfigSource', () => {
  it('get(): primary source wins when value present', () => {
    const primary = makeSource({ values: { FOO: 'primary-foo' } });
    const fallback = makeSource({ values: { FOO: 'fallback-foo' } });
    const layered = new LayeredConfigSource([primary, fallback]);
    expect(layered.get('FOO')).toBe('primary-foo');
  });

  it('get(): falls through to next source when primary returns undefined', () => {
    const primary = makeSource({ values: {} });
    const fallback = makeSource({ values: { FOO: 'fallback-foo' } });
    const layered = new LayeredConfigSource([primary, fallback]);
    expect(layered.get('FOO')).toBe('fallback-foo');
  });

  it('get(): returns undefined when no source has the key', () => {
    const a = makeSource({ values: {} });
    const b = makeSource({ values: {} });
    const layered = new LayeredConfigSource([a, b]);
    expect(layered.get('MISSING')).toBeUndefined();
  });

  it('getSecret(): primary wins', async () => {
    const primary = makeSource({ secrets: { TOKEN: 'primary-token' } });
    const fallback = makeSource({ secrets: { TOKEN: 'fallback-token' } });
    const layered = new LayeredConfigSource([primary, fallback]);
    expect(await layered.getSecret('TOKEN')).toBe('primary-token');
  });

  it('getSecret(): falls through to next source', async () => {
    const primary = makeSource({ secrets: {} });
    const fallback = makeSource({ secrets: { TOKEN: 'fallback-token' } });
    const layered = new LayeredConfigSource([primary, fallback]);
    expect(await layered.getSecret('TOKEN')).toBe('fallback-token');
  });

  it('getSecret(): returns undefined when no source has the secret', async () => {
    const a = makeSource({ secrets: {} });
    const b = makeSource({ secrets: {} });
    const layered = new LayeredConfigSource([a, b]);
    expect(await layered.getSecret('MISSING')).toBeUndefined();
  });

  it('version(): returns first source version', () => {
    const primary = makeSource({ version: 42 });
    const fallback = makeSource({ version: 1 });
    const layered = new LayeredConfigSource([primary, fallback]);
    expect(layered.version()).toBe(42);
  });

  it('version(): returns 0 when no sources', () => {
    const layered = new LayeredConfigSource([]);
    expect(layered.version()).toBe(0);
  });

  it('onChange(): subscribes to every source, returned unsub unsubscribes from all', () => {
    const a = makeSource({});
    const b = makeSource({});
    const layered = new LayeredConfigSource([a, b]);
    const cb = vi.fn();
    const unsub = layered.onChange(cb);
    expect(a.listeners.size).toBe(1);
    expect(b.listeners.size).toBe(1);

    // Fire on each source — callback invoked twice
    for (const l of a.listeners) l('FOO');
    for (const l of b.listeners) l('BAR');
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    expect(a.listeners.size).toBe(0);
    expect(b.listeners.size).toBe(0);
  });

  it('start()/stop(): forwarded to every source that implements them', async () => {
    const startA = vi.fn(async () => {});
    const stopA = vi.fn(async () => {});
    const startB = vi.fn(async () => {});
    const a = makeSource({ hooks: { start: startA, stop: stopA } });
    const b = makeSource({ hooks: { start: startB } });          // no stop hook
    const c = makeSource({});                                     // no hooks at all
    const layered = new LayeredConfigSource([a, b, c]);
    await layered.start();
    await layered.stop();
    expect(startA).toHaveBeenCalledTimes(1);
    expect(startB).toHaveBeenCalledTimes(1);
    expect(stopA).toHaveBeenCalledTimes(1);
  });
});
