import { MESSAGES } from '@holocron/shared';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  parseCookieHeader,
  verifyWorkspaceCookie,
  WORKSPACE_COOKIE_NAME,
} from '../cookie/workspace-cookie.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { DoorService } from './door.service.js';

// Runs in front of every route except health and the door itself. When
// ACCESS_CODE is unset it lets everything through.
@Injectable()
export class DoorGuard implements CanActivate {
  constructor(private readonly door: DoorService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path === '/api/health' || req.path.startsWith('/api/door')) {
      return true;
    }

    const cookie = parseCookieHeader(req.headers.cookie)[WORKSPACE_COOKIE_NAME];
    const payload = verifyWorkspaceCookie(cookie);
    if (this.door.isUnlocked(payload)) {
      return true;
    }

    throw new HttpException(MESSAGES.doorRequired, HttpStatus.UNAUTHORIZED);
  }
}
