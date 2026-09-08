import { LIMITS, MESSAGES } from '@holocron/shared';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { clientIp } from '../net/client-ip.js';

const WINDOW_MS = 60_000;

// 60 requests a minute per IP, in memory, one window per address. This is
// the outer limit against abuse; the workspace and upload limits below it are
// about fairness between visitors, not about traffic.
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly windows = new Map<string, { count: number; windowStart: number }>();

  use(req: Request, res: Response, next: NextFunction): void {
    const ip = clientIp(req);
    const now = Date.now();
    const record = this.windows.get(ip);

    if (!record || now - record.windowStart >= WINDOW_MS) {
      this.windows.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    if (record.count >= LIMITS.requestsPerIpPerMinute) {
      res.status(429).json({ message: MESSAGES.tooManyRequests });
      return;
    }

    record.count += 1;
    next();
  }
}
