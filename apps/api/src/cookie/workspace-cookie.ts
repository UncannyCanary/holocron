import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';

// The one cookie the site sets. Before a workspace exists it only carries
// "unlocked"; once one exists it also carries the workspace id. Signed so a
// visitor can read it but never forge or edit it.
export const WORKSPACE_COOKIE_NAME = 'hc_ws';

export type WorkspaceCookiePayload = {
  unlocked?: boolean;
  workspaceId?: string;
};

function secret(): string {
  const value = process.env.COOKIE_SECRET;
  if (!value) {
    throw new Error('COOKIE_SECRET is not set');
  }
  return value;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function signWorkspaceCookie(payload: WorkspaceCookiePayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${data}.${sign(data)}`;
}

// Returns the payload only if the signature is untouched. Any other reason to
// reject (missing cookie, wrong shape, bad JSON) reads the same as "no
// cookie" rather than an error, since a visitor's browser sends no cookie at
// all just as often as it sends a stale one.
export function verifyWorkspaceCookie(raw: string | undefined): WorkspaceCookiePayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const data = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  const expected = sign(data);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function setWorkspaceCookie(res: Response, payload: WorkspaceCookiePayload): void {
  res.cookie(WORKSPACE_COOKIE_NAME, signWorkspaceCookie(payload), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure only when the request itself came over https. Behind Caddy that
    // is read from the forwarded header, so it is on for the real site and
    // off on plain http://localhost, where Safari would otherwise drop it.
    secure: Boolean(res.req?.secure),
    path: '/',
    // A year. The workspace itself, not the cookie, is what expires: the
    // nightly job removes it after 14 days untouched.
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
}

// No cookie-parser middleware is wired in, so this reads the raw header
// itself. There is nothing here beyond splitting name=value pairs.
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

// The workspace this browser already has, or nothing. Every route that acts
// on a workspace's own documents starts here.
export function workspaceIdFromCookieHeader(header: string | undefined): string | null {
  const payload = verifyWorkspaceCookie(parseCookieHeader(header)[WORKSPACE_COOKIE_NAME]);
  return payload?.workspaceId ?? null;
}
