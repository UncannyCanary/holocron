import { Body, Controller, Get, HttpCode, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  parseCookieHeader,
  setWorkspaceCookie,
  verifyWorkspaceCookie,
  WORKSPACE_COOKIE_NAME,
} from '../cookie/workspace-cookie.js';
import { clientIp } from '../net/client-ip.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { DoorService } from './door.service.js';

@Controller('door')
export class DoorController {
  constructor(private readonly door: DoorService) {}

  @Get()
  status(@Req() req: Request) {
    const payload = verifyWorkspaceCookie(
      parseCookieHeader(req.headers.cookie)[WORKSPACE_COOKIE_NAME],
    );
    return { required: this.door.isRequired(), unlocked: this.door.isUnlocked(payload) };
  }

  @Post()
  @HttpCode(200)
  unlock(
    @Body() body: { code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.door.isRequired()) {
      return { unlocked: true };
    }

    const result = this.door.tryCode(clientIp(req), body?.code ?? '');
    if (!result.ok) {
      throw new HttpException(result.message, result.status);
    }

    const existing = verifyWorkspaceCookie(
      parseCookieHeader(req.headers.cookie)[WORKSPACE_COOKIE_NAME],
    );
    setWorkspaceCookie(res, { ...existing, unlocked: true });
    return { unlocked: true };
  }
}
