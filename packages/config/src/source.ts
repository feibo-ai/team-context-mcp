// packages/config/src/source.ts
export interface ConfigSource {
  /** Get a non-secret config value. Returns undefined if not set. */
  get<T = unknown>(key: string): T | undefined;

  /** Get a secret value. Async because may hit network. Cached internally. */
  getSecret(key: string): Promise<string | undefined>;

  /** Get current config version (for sanity check). */
  version(): number;

  /** Subscribe to config changes. Returns unsubscribe fn. */
  onChange(callback: (changedKey: string) => void): () => void;

  /** Start any background work (poll/WS). */
  start?(): Promise<void>;

  /** Cleanup. */
  stop?(): Promise<void>;
}
