import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DoorController } from './door.controller.js';
import { DoorGuard } from './door.guard.js';
import { DoorService } from './door.service.js';

@Module({
  controllers: [DoorController],
  providers: [DoorService, { provide: APP_GUARD, useClass: DoorGuard }],
})
export class DoorModule {}
