export interface TelegramBotProfile {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

interface TelegramMessage {
  message_id: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramBotApiClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiBase = "https://api.telegram.org",
    private readonly timeoutMs = 10_000,
  ) {}

  getMe(botToken: string) {
    return this.call<TelegramBotProfile>(botToken, "getMe");
  }

  setWebhook(input: {
    botToken: string;
    url: string;
    secretToken: string;
    allowedUpdates: string[];
  }) {
    return this.call<boolean>(input.botToken, "setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates,
      drop_pending_updates: false,
    });
  }

  getWebhookInfo(botToken: string) {
    return this.call<TelegramWebhookInfo>(botToken, "getWebhookInfo");
  }

  deleteWebhook(botToken: string) {
    return this.call<boolean>(botToken, "deleteWebhook", { drop_pending_updates: false });
  }

  sendMessage(input: { botToken: string; chatId: string; text: string }) {
    return this.call<TelegramMessage>(input.botToken, "sendMessage", {
      chat_id: input.chatId,
      text: input.text,
    });
  }

  private async call<T>(botToken: string, method: string, payload: Record<string, unknown> = {}) {
    const token = botToken.trim();
    if (!token) throw new Error("Telegram bot token is required.");

    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error("Telegram is temporarily unavailable. Please try again.");
    }

    let body: TelegramResponse<T>;
    try {
      body = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new Error("Telegram returned an invalid response.");
    }

    if (!response.ok || !body.ok || body.result === undefined) {
      throw new Error(body.description?.trim() || "Telegram rejected the request.");
    }
    return body.result;
  }
}
