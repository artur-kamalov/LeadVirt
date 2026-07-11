import { Injectable } from "@nestjs/common";
import { TelegramBotApiClient } from "@leadvirt/integrations";

@Injectable()
export class TelegramBotApiService {
  private readonly client = new TelegramBotApiClient();

  getMe(botToken: string) {
    return this.client.getMe(botToken);
  }

  setWebhook(input: Parameters<TelegramBotApiClient["setWebhook"]>[0]) {
    return this.client.setWebhook(input);
  }

  getWebhookInfo(botToken: string) {
    return this.client.getWebhookInfo(botToken);
  }

  deleteWebhook(botToken: string) {
    return this.client.deleteWebhook(botToken);
  }
}
