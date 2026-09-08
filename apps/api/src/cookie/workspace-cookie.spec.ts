import { beforeAll, describe, expect, it } from 'vitest';
import {
  parseCookieHeader,
  signWorkspaceCookie,
  verifyWorkspaceCookie,
} from './workspace-cookie.js';

describe('workspace cookie', () => {
  beforeAll(() => {
    process.env.COOKIE_SECRET = 'test-cookie-secret';
  });

  it('round trips a payload', () => {
    const raw = signWorkspaceCookie({ unlocked: true, workspaceId: 'ws-1' });
    expect(verifyWorkspaceCookie(raw)).toEqual({ unlocked: true, workspaceId: 'ws-1' });
  });

  it('rejects a cookie with the wrong signature', () => {
    const raw = signWorkspaceCookie({ unlocked: true });
    const tampered = `${raw.split('.')[0]}.not-the-real-signature`;
    expect(verifyWorkspaceCookie(tampered)).toBeNull();
  });

  it('rejects a cookie whose payload was edited after signing', () => {
    const raw = signWorkspaceCookie({ unlocked: false });
    const [, signature] = raw.split('.');
    const editedPayload = Buffer.from(JSON.stringify({ unlocked: true })).toString('base64url');
    expect(verifyWorkspaceCookie(`${editedPayload}.${signature}`)).toBeNull();
  });

  it('reads nothing from a missing cookie', () => {
    expect(verifyWorkspaceCookie(undefined)).toBeNull();
  });

  it('parses a cookie header with several cookies', () => {
    const raw = signWorkspaceCookie({ unlocked: true });
    const header = `other=1; hc_ws=${raw}; another=two`;
    expect(parseCookieHeader(header).hc_ws).toBe(raw);
  });
});
