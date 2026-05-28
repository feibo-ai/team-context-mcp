// packages/remote/tests/auth.test.ts — Plan 5 M-16
//
// Covers the four cases called out in the plan:
//   1. no Authorization header → 401
//   2. invalid token (multica returns 401) → 401
//   3. valid token → email attached, next() called
//   4. cache hit within TTL → only one /api/me call total
//
// Uses undici MockAgent to fake multica responses — no real network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
} from 'undici';
import type { Dispatcher } from 'undici';
import type { IncomingHttpHeaders } from 'node:http';
import {
  authenticate,
  createAuthMiddleware,
  AuthError,
  _clearAuthCache,
} from '../src/auth.js';

const MULTICA = 'http://multica.test';

let savedDispatcher: Dispatcher;
let mockAgent: MockAgent;

beforeEach(() => {
  savedDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  _clearAuthCache();
});

afterEach(async () => {
  await mockAgent.close();
  setGlobalDispatcher(savedDispatcher);
});

function fakeRes() {
  const res: {
    statusCode?: number;
    body?: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  } = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe('authenticate (raw)', () => {
  it('throws 401 when Authorization header is missing', async () => {
    const headers: IncomingHttpHeaders = {};
    await expect(authenticate(headers, MULTICA)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(authenticate(headers, MULTICA)).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('missing'),
    });
  });

  it('throws 401 when multica /api/me returns 401', async () => {
    const pool = mockAgent.get(MULTICA);
    pool
      .intercept({ path: '/api/me', method: 'GET' })
      .reply(401, { error: 'invalid token' });

    await expect(
      authenticate({ authorization: 'Bearer bad-token' }, MULTICA),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns email on valid token', async () => {
    const pool = mockAgent.get(MULTICA);
    pool
      .intercept({ path: '/api/me', method: 'GET' })
      .reply(200, { id: 'user-1', email: 'alice@example.com' });

    const result = await authenticate(
      { authorization: 'Bearer good-token' },
      MULTICA,
    );
    expect(result).toEqual({ email: 'alice@example.com' });
  });

  it('caches valid tokens for 5 minutes — second call does NOT hit multica', async () => {
    const pool = mockAgent.get(MULTICA);
    // Only one interceptor — if a second request fires, MockAgent throws
    // because netConnect is disabled.
    pool
      .intercept({ path: '/api/me', method: 'GET' })
      .reply(200, { id: 'user-1', email: 'alice@example.com' });

    const first = await authenticate(
      { authorization: 'Bearer cached-token' },
      MULTICA,
    );
    const second = await authenticate(
      { authorization: 'Bearer cached-token' },
      MULTICA,
    );

    expect(first.email).toBe('alice@example.com');
    expect(second.email).toBe('alice@example.com');
    // pending interceptors: if there's an unused one we set up, that's fine;
    // the test passes as long as no second request was attempted.
    // MockAgent has no public counter, so we assert by closing the agent:
    // any extra request would have thrown above.
  });
});

describe('createAuthMiddleware (express adapter)', () => {
  it('responds 401 when Authorization header is missing', async () => {
    const middleware = createAuthMiddleware(MULTICA);
    const req = { headers: {} } as Parameters<typeof middleware>[0];
    const res = fakeRes() as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('responds 401 when multica rejects the token', async () => {
    const pool = mockAgent.get(MULTICA);
    pool.intercept({ path: '/api/me', method: 'GET' }).reply(401, {});

    const middleware = createAuthMiddleware(MULTICA);
    const req = {
      headers: { authorization: 'Bearer wrong' },
    } as Parameters<typeof middleware>[0];
    const res = fakeRes() as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('on valid token: attaches req.userEmail and calls next()', async () => {
    const pool = mockAgent.get(MULTICA);
    pool
      .intercept({ path: '/api/me', method: 'GET' })
      .reply(200, { id: 'u', email: 'bob@example.com' });

    const middleware = createAuthMiddleware(MULTICA);
    const req = {
      headers: { authorization: 'Bearer ok' },
    } as Parameters<typeof middleware>[0] & { userEmail?: string };
    const res = fakeRes() as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userEmail).toBe('bob@example.com');
  });
});
