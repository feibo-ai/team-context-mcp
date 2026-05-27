import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MulticaConfig } from './lib/multica.js';

export interface AppConfig {
  multica: MulticaConfig;
  teamContextRepo: string;
}

export async function loadConfig(): Promise<AppConfig> {
  // 1. env vars (highest priority)
  let serverUrl = process.env.MULTICA_SERVER_URL;
  let token = process.env.MULTICA_TOKEN;
  let workspaceId = process.env.MULTICA_WORKSPACE_ID;

  // 2. ~/.multica/config.json (default profile)
  if (!serverUrl || !token || !workspaceId) {
    try {
      const path = join(homedir(), '.multica', 'config.json');
      const file = JSON.parse(await readFile(path, 'utf-8'));
      serverUrl ||= file.server_url;
      token ||= file.token;
      workspaceId ||= file.workspace_id;
    } catch {
      // ignore — env may still be partial
    }
  }

  if (!serverUrl || !token || !workspaceId) {
    throw new Error(
      'multica config missing. Set MULTICA_SERVER_URL/MULTICA_TOKEN/MULTICA_WORKSPACE_ID or run `multica login`.'
    );
  }

  const teamContextRepo =
    process.env.TEAM_CONTEXT_REPO || join(homedir(), 'team-context');

  return {
    multica: { serverUrl, token, workspaceId },
    teamContextRepo,
  };
}
