import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { ChannelsController } from "./channels.controller.js";
import { ChannelsService } from "./channels.service.js";

@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService, RolesGuard],
  exports: [ChannelsService],
})
export class ChannelsModule {}
