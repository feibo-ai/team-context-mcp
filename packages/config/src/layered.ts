// packages/config/src/layered.ts
import type { ConfigSource } from './source.js';

export class LayeredConfigSource implements ConfigSource {
  constructor(private sources: ConfigSource[]) {}
  get<T = unknown>(key: string): T | undefined {
    for (const s of this.sources) {
      const v = s.get<T>(key);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  async getSecret(key: string): Promise<string | undefined> {
    for (const s of this.sources) {
      const v = await s.getSecret(key);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  version(): number {
    return this.sources[0]?.version() ?? 0;
  }
  onChange(cb: (k: string) => void): () => void {
    const unsubs = this.sources.map((s) => s.onChange(cb));
    return () => unsubs.forEach((u) => u());
  }
  async start(): Promise<void> { for (const s of this.sources) await s.start?.(); }
  async stop():  Promise<void> { for (const s of this.sources) await s.stop?.();  }
}
