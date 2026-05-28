// packages/remote/src/auth.ts — Plan 5 M-16
//
// Per-user bearer auth. Tokens are validated against multica `/api/me`
// (workspace-agnostic) via MulticaControlPlaneClient. Successful validations
// are cached in-memory for 5 minutes so a chatty client doesn't re-hit
// multica on every MCP request.
//
// Exports two shapes:
//   - `authenticate(headers, multicaUrl)` — raw async function, returns
//     `{ email }` or throws `AuthError`. Suitable for non-express transports
//     (e.g. the StreamableHTTP transport may want to call this directly).
//   - `createAuthMiddleware(multicaUrl)` — express middleware factory.
//     Attaches `req.userEmail` on success, responds 401 on failure.
//
// M-19 wires the middleware into `server.ts`. We deliberately don't touch
// `server.ts` here.

import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';
import { MulticaControlPlaneClient } from '@tcmcp/config';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface CacheEntry {
  email: string;
  validatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;

/** Exposed for tests — clears the in-memory token cache between cases. */
export function _clearAuthCache(): void {
  cache.clear();
}

/**
 * Validate a bearer token against multica `/api/me`. Returns the
 * authenticated user's email. Throws `AuthError` (status 401) on missing
 * header, malformed header, or invalid token.
 *
 * Cached for 5 minutes per token — the second call within the window does
 * not hit multica.
 */
export async function authenticate(
  headers: IncomingHttpHeaders,
  multicaUrl: string,
): Promise<{ email: string }> {
  const auth = headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AuthError('missing bearer token');
  }
  const token = auth.substring(7).trim();
  if (!token) {
    throw new AuthError('missing bearer token');
  }

  const cached = cache.get(token);
  if (cached && Date.now() - cached.validatedAt < TTL_MS) {
    return { email: cached.email };
  }

  const client = new MulticaControlPlaneClient({
    serverUrl: multicaUrl,
    serviceToken: token,
    // /api/me is workspace-agnostic — empty string is fine. The header is
    // still sent (it's a no-op on the server side for this route).
    workspaceId: '',
  });

  let me: { id: string; email: string };
  try {
    me = await client.me();
  } catch (err) {
    throw new AuthError(
      `token invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!me?.email) {
    throw new AuthError('token invalid: no email in /api/me response');
  }

  cache.set(token, { email: me.email, validatedAt: Date.now() });
  return { email: me.email };
}

/**
 * Express middleware factory. On success: attaches `req.userEmail` and
 * calls `next()`. On failure: responds 401 with a JSON body. Never throws
 * synchronously into express's error pipeline.
 */
export function createAuthMiddleware(multicaUrl: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const { email } = await authenticate(req.headers, multicaUrl);
      (req as { userEmail?: string }).userEmail = email;
      next();
    } catch (err) {
      const message =
        err instanceof AuthError ? err.message : 'authentication failed';
      const status = err instanceof AuthError ? err.status : 401;
      res.status(status).json({ error: message });
    }
  };
}

// Module augmentation — makes `req.userEmail` typed for downstream handlers
// without forcing a cast at every call site. We augment `express` itself
// (rather than `express-serve-static-core`) because @tcmcp/remote's pnpm
// graph only declares `@types/express` directly.
declare module 'express' {
  interface Request {
    userEmail?: string;
  }
}
