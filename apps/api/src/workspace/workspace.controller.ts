import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  parseCookieHeader,
  setWorkspaceCookie,
  verifyWorkspaceCookie,
  WORKSPACE_COOKIE_NAME,
  type WorkspaceCookiePayload,
} from '../cookie/workspace-cookie.js';
import { clientIp } from '../net/client-ip.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { WorkspaceService } from './workspace.service.js';

export const NO_WORKSPACE_MESSAGE = 'There is no workspace yet.';

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get()
  async get(@Req() req: Request) {
    const payload = this.readCookie(req);
    const ws = payload?.workspaceId ? await this.workspaces.find(payload.workspaceId) : null;
    if (!ws) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }
    return { id: ws.id, createdAt: ws.createdAt };
  }

  // The first real action a browser takes past the door. A workspace is
  // created here, not on page load, so a bot only fetching the page never
  // makes one.
  @Post()
  @HttpCode(200)
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const payload = this.readCookie(req);

    if (payload?.workspaceId) {
      const existing = await this.workspaces.find(payload.workspaceId);
      if (existing) {
        await this.workspaces.touch(existing.id);
        return { id: existing.id, createdAt: existing.createdAt };
      }
    }

    const allowed = this.workspaces.checkCreationRate(clientIp(req));
    if (!allowed.ok) {
      throw new HttpException(allowed.message, HttpStatus.TOO_MANY_REQUESTS);
    }

    const ws = await this.workspaces.create();
    setWorkspaceCookie(res, { ...payload, workspaceId: ws.id });
    return { id: ws.id, createdAt: ws.createdAt };
  }

  private readCookie(req: Request): WorkspaceCookiePayload | null {
    return verifyWorkspaceCookie(parseCookieHeader(req.headers.cookie)[WORKSPACE_COOKIE_NAME]);
  }
}
