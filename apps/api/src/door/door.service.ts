import { createHash, timingSafeEqual } from 'node:crypto';
import { LIMITS, MESSAGES } from '@holocron/shared';
import { Injectable } from '@nestjs/common';
import type { WorkspaceCookiePayload } from '../cookie/workspace-cookie.js';

type Attempts = { count: number; lockedUntil: number | null };

export type DoorResult = { ok: true } | { ok: false; status: 401 | 429; message: string };

// One shared access code from ACCESS_CODE. Unset means the site is open.
// Wrong guesses are counted per IP, in memory: one process, one server, and
// the count only needs to survive until the lockout expires anyway.
@Injectable()
export class DoorService {
  private readonly attempts = new Map<string, Attempts>();

  isRequired(): boolean {
    return Boolean(process.env.ACCESS_CODE);
  }

  isUnlocked(payload: WorkspaceCookiePayload | null): boolean {
    return !this.isRequired() || Boolean(payload?.unlocked);
  }

  tryCode(ip: string, code: string): DoorResult {
    const now = Date.now();
    const record = this.attempts.get(ip);

    if (record?.lockedUntil && record.lockedUntil > now) {
      return { ok: false, status: 429, message: MESSAGES.doorLocked };
    }

    if (this.matches(code)) {
      this.attempts.delete(ip);
      return { ok: true };
    }

    const count = (record?.lockedUntil ? 0 : (record?.count ?? 0)) + 1;
    if (count >= LIMITS.wrongCodeAttemptsBeforeLockout) {
      this.attempts.set(ip, { count, lockedUntil: now + LIMITS.lockoutMinutes * 60_000 });
      return { ok: false, status: 429, message: MESSAGES.doorLocked };
    }

    this.attempts.set(ip, { count, lockedUntil: null });
    return { ok: false, status: 401, message: MESSAGES.doorWrongCode };
  }

  // Hashes both sides to a fixed length first so the comparison always takes
  // the same time, whatever length the guess is.
  private matches(code: string): boolean {
    const accessCode = process.env.ACCESS_CODE ?? '';
    const a = createHash('sha256').update(code).digest();
    const b = createHash('sha256').update(accessCode).digest();
    return timingSafeEqual(a, b);
  }
}
