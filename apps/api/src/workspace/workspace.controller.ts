import { LIMITS } from '@holocron/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
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
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { spentThisMonth } from '../extract/spend.js';
import { clientIp } from '../net/client-ip.js';
import { uploadsToday } from '../uploads/upload-limits.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { WorkspaceService } from './workspace.service.js';

export const NO_WORKSPACE_MESSAGE = 'There is no workspace yet.';
const NO_SUCH_REOPEN_LINK = 'This reopen link is not right.';

@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  async get(@Req() req: Request) {
    const payload = this.readCookie(req);
    const ws = payload?.workspaceId ? await this.workspaces.find(payload.workspaceId) : null;
    if (!ws) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }
    return { id: ws.id, createdAt: ws.createdAt };
  }

  // What the settings screen shows: when this workspace started, the secret
  // that reopens it on another browser, and how much of today's uploads and
  // this month's model spend it has used. The secret becomes a link on the
  // screen itself: the API and the web app sit on different ports in local
  // dev, so only the browser knows the address a person should actually use.
  @Get('settings')
  async settings(@Req() req: Request) {
    const payload = this.readCookie(req);
    const ws = payload?.workspaceId ? await this.workspaces.find(payload.workspaceId) : null;
    if (!ws) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }

    const [used, spent] = await Promise.all([
      uploadsToday(this.db, ws.id),
      spentThisMonth(this.db),
    ]);

    return {
      createdAt: ws.createdAt,
      reopenSecret: ws.reopenSecret,
      uploads: { usedToday: used, perDay: LIMITS.uploadsPerWorkspacePerDay },
      spend: { usedThisMonthUsd: spent, capUsd: LIMITS.monthlyModelSpendUsd },
    };
  }

  // Opens the workspace a reopen link points at on this browser, the same as
  // if it had created it. The link itself is the secret: whoever holds it can
  // see this workspace's documents, the way a bookkeeper's own copy would.
  @Post('reopen')
  @HttpCode(200)
  async reopen(
    @Req() req: Request,
    @Body('secret') secret: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; createdAt: Date }> {
    const ws = typeof secret === 'string' ? await this.workspaces.findByReopenSecret(secret) : null;
    if (!ws) {
      throw new HttpException(NO_SUCH_REOPEN_LINK, HttpStatus.NOT_FOUND);
    }
    setWorkspaceCookie(res, { ...this.readCookie(req), workspaceId: ws.id });
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
