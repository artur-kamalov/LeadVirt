import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { WebhookModule } from "../webhook/webhook.module.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationRequestsService } from "./integration-requests.service.js";
import { IntegrationsService } from "./integrations.service.js";

@Module({
  imports: [ChannelsModule, TelegramModule, WebhookModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationRequestsService, RolesGuard],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
