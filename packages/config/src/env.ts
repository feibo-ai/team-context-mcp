// packages/config/src/env.ts
import type { ConfigSource } from './source.js';

export interface EnvSourceOptions {
  prefix?: string;  // e.g. "TCMCP_" to scope
}

export class EnvConfigSource implements ConfigSource {
  constructor(private opts: EnvSourceOptions = {}) {}
  get<T = unknown>(key: string): T | undefined {
    const v = process.env[(this.opts.prefix ?? '') + key];
    return v as T | undefined;
  }
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[(this.opts.prefix ?? '') + key];
  }
  version(): number { return 1; }
  onChange(): () => void { return () => {}; }
}
