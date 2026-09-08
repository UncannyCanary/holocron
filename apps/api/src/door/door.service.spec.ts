import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorService } from './door.service.js';

describe('DoorService', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = 'sesame';
  });

  it('is not required when ACCESS_CODE is unset', () => {
    delete process.env.ACCESS_CODE;
    const door = new DoorService();
    expect(door.isRequired()).toBe(false);
    expect(door.isUnlocked(null)).toBe(true);
  });

  it('accepts the right code and unlocks', () => {
    const door = new DoorService();
    const result = door.tryCode('1.2.3.4', 'sesame');
    expect(result).toEqual({ ok: true });
    expect(door.isUnlocked({ unlocked: true })).toBe(true);
    expect(door.isUnlocked({ unlocked: false })).toBe(false);
    expect(door.isUnlocked(null)).toBe(false);
  });

  it('rejects a wrong code with a plain message', () => {
    const door = new DoorService();
    const result = door.tryCode('1.2.3.4', 'wrong');
    expect(result).toEqual({ ok: false, status: 401, message: 'That code is not right.' });
  });

  it('locks the address out after 5 wrong guesses', () => {
    const door = new DoorService();
    const ip = '5.5.5.5';

    for (let i = 0; i < 4; i += 1) {
      expect(door.tryCode(ip, 'wrong').ok).toBe(false);
    }

    const fifth = door.tryCode(ip, 'wrong');
    expect(fifth).toEqual({
      ok: false,
      status: 429,
      message: 'Too many wrong codes. Wait 15 minutes and try again.',
    });

    // Locked out even with the right code now.
    const sixth = door.tryCode(ip, 'sesame');
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.status).toBe(429);
  });

  it('keeps the lockout per address', () => {
    const door = new DoorService();
    for (let i = 0; i < 5; i += 1) {
      door.tryCode('9.9.9.9', 'wrong');
    }
    expect(door.tryCode('9.9.9.9', 'sesame').ok).toBe(false);
    expect(door.tryCode('8.8.8.8', 'sesame').ok).toBe(true);
  });

  it('lets a fresh guess through again once the lockout expires', () => {
    vi.useFakeTimers();
    const door = new DoorService();
    const ip = '7.7.7.7';
    for (let i = 0; i < 5; i += 1) {
      door.tryCode(ip, 'wrong');
    }
    expect(door.tryCode(ip, 'sesame').ok).toBe(false);

    vi.advanceTimersByTime(15 * 60_000 + 1);

    expect(door.tryCode(ip, 'sesame')).toEqual({ ok: true });
    vi.useRealTimers();
  });
});
