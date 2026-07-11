import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { TelegramController } from "./telegram.controller.js";
import { TelegramBotApiService } from "./telegram-bot-api.service.js";
import { TelegramService } from "./telegram.service.js";

@Module({
  imports: [AiModule, WorkflowsModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramBotApiService],
  exports: [TelegramService, TelegramBotApiService],
})
export class TelegramModule {}
