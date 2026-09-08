import type { Request } from 'express';

// The address every per-IP limit is keyed on. Caddy sits in front in
// production, so main.ts trusts the proxy and req.ip already reflects the
// real visitor rather than Caddy itself.
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
